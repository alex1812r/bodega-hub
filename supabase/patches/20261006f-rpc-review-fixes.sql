-- =============================================================================
-- 20261006f — Correcciones de la revision de RPC de stock y dinero (STK-516)
-- Proyecto: BodegaHub (plan stock-integrity, fase 5)
-- Requiere: 20261006a, b, c y e; 20260904b-cash-lifecycle.sql
-- Origen: .notes/stock-integrity-gtm/rpc-review.md (hallazgos R1, R2, R3, R5, R6, R9)
--
-- Redefine completas, partiendo de su version vigente y con el cambio minimo:
--   cancel_sale, create_sale y create_sale_with_payments (20261006b),
--   cancel_purchase, return_purchase, create_purchase y register_payment
--   (20261006c) y record_cash_close_difference (20260904b). Ninguna firma cambia.
--
--   R1  cancel_sale repone por producto lo vendido - ya devuelto con movimientos
--       devolucion_cliente ligados a la venta (igual que return_sale). Antes
--       reponia la linea completa: una devolucion parcial + cancelar duplicaba
--       unidades.
--   R2  record_cash_close_difference deja de ser ejecutable por /rpc (solo la
--       llaman close_cash_session y auto_close_stale_cash_sessions) y ademas
--       valida por dentro: sesion abierta de la tienda indicada y, si hay
--       usuario, su tienda, que sea admin o quien abrio la caja (la misma regla
--       de close_cash_session) y que el responsable sea el mismo. Tambien pierden
--       el execute de authenticated auto_close_stale_cash_sessions (el BFF la
--       llama con service_role) y ensure_store_vault (solo la usan otras RPC).
--   R3  cancel_purchase / return_purchase rechazan (PT409) la compra con pagos
--       activos: primero se anulan los pagos con cancel_payment, igual que en
--       cancel_sale. No se anulan aqui a proposito: quien cancela / devuelve
--       compras (admin, almacen) no es quien mueve el dinero del baul (admin,
--       contador), y devolver la mercancia no significa que el proveedor ya
--       haya devuelto el dinero (docs/cuadre-baul.md: el baul solo se mueve con
--       un asiento que describe dinero real).
--   R5  register_payment bloquea la sesion de caja (for share) antes de
--       escribir en cash_movements y revalida que siga abierta. Un cobro que
--       llegaba durante close_cash_session entraba en la sesion ya cerrada y
--       quedaba fuera del cierre. Orden de bloqueo: documento -> productos ->
--       pago -> sesion de caja -> baul.
--   R6  create_sale, create_sale_with_payments y create_purchase validan la
--       forma de cada item / pago antes de convertirlo (uuid, enteros, montos,
--       metodo de pago), rechazan descuento / impuesto negativos y traducen el
--       numero de documento repetido (PT409) y los montos fuera de rango
--       (PT400). Antes salian 22P02 / 22003 / 23514 / 23505 crudos.
--   R9  register_payment compara el rol con coalesce (rol nulo = no autorizado).
--
-- Idempotente, una sola transaccion. Ejecutar en SQL Editor o via db-up.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. cancel_sale — copia de 20261006b + R1 (repone vendido - ya devuelto)
-- -----------------------------------------------------------------------------

create or replace function public.cancel_sale(p_sale_id uuid)
returns public.sales
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_sale public.sales;
  v_line record;
  v_product public.products;
  v_product_ids uuid[];
  v_active_payments integer;
  v_active_ves numeric(14,2);
  v_already_returned integer;
  v_quantity integer;
begin
  v_store_id := public.assert_store_context();

  if coalesce(public.current_user_role()::text, '') not in ('admin', 'vendedor') then
    raise exception using errcode = 'PT403', message = 'No autorizado para cancelar ventas';
  end if;

  select * into v_sale
  from public.sales
  where id = p_sale_id
    and store_id = v_store_id
  for update;

  if not found then
    raise exception using errcode = 'PT404', message = 'Venta no encontrada';
  end if;

  if v_sale.status in ('cancelada', 'devuelta') then
    raise exception using errcode = 'PT409', message = 'La venta ya fue cancelada o devuelta';
  end if;

  -- El dinero se saca por `cancel_payment`, no por aqui: cancelar una venta con pagos
  -- vivos dejaba el efectivo en caja y bloqueaba la anulacion del pago para siempre.
  select count(*), coalesce(sum(amount_ves), 0)
  into v_active_payments, v_active_ves
  -- Sin filtro por store_id a proposito: la venta ya quedo alcanzada arriba y aqui
  -- interesa no dejar fuera ningun pago vivo colgado de ella.
  from public.payments
  where sale_id = p_sale_id
    and status = 'activo';

  if v_active_payments > 0 then
    raise exception using
      errcode = 'PT409',
      message = format(
        'La venta %s tiene %s pago(s) activo(s) por Bs %s. Anula primero los pagos y luego cancela la venta.',
        v_sale.invoice_number, v_active_payments, round(v_active_ves, 2)
      );
  end if;

  -- Todos los productos de la venta, en orden fijo, antes del bucle.
  select array_agg(distinct product_id)
  into v_product_ids
  from public.sale_items
  where sale_id = p_sale_id;

  perform 1
  from public.products
  where id = any(v_product_ids)
    and store_id = v_store_id
  order by id
  for update;

  -- R1 — por producto: lo vendido menos lo ya devuelto con movimientos
  -- devolucion_cliente ligados a esta venta (la misma cuenta de return_sale).
  for v_line in
    select product_id, sum(quantity)::integer as sold
    from public.sale_items
    where sale_id = p_sale_id
    group by product_id
    order by product_id
  loop
    select * into v_product
    from public.products
    where id = v_line.product_id
      and store_id = v_store_id
    for update;

    if not found then
      raise exception using
        errcode = 'PT404',
        message = format(
          'Producto no encontrado en tu tienda (%s): no se puede reponer el stock de la venta %s',
          v_line.product_id, v_sale.invoice_number
        );
    end if;

    select coalesce(sum(quantity_delta), 0)::integer
    into v_already_returned
    from public.stock_movements
    where sale_id = p_sale_id
      and product_id = v_line.product_id
      and type = 'devolucion_cliente';

    v_quantity := v_line.sold - v_already_returned;

    if v_quantity > 0 then
      insert into public.stock_movements (
        product_id,
        type,
        quantity_delta,
        sale_id,
        reason,
        created_by,
        store_id
      )
      values (
        v_line.product_id,
        'ajuste_entrada',
        v_quantity,
        p_sale_id,
        'Cancelacion ' || v_sale.invoice_number,
        auth.uid(),
        v_store_id
      );
    end if;
  end loop;

  update public.sales
  set status = 'cancelada'
  where id = p_sale_id
  returning * into v_sale;

  return v_sale;
end;
$$;

revoke all on function public.cancel_sale(uuid) from public, anon;
grant execute on function public.cancel_sale(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. record_cash_close_difference — copia de 20260904b + R2
--    Funcion interna: la llaman close_cash_session (usuario) y
--    auto_close_stale_cash_sessions (service_role, sin auth.uid()). Por eso la
--    guarda de usuario solo aplica cuando hay usuario; la de sesion, siempre.
-- -----------------------------------------------------------------------------

create or replace function public.record_cash_close_difference(
  p_store_id uuid,
  p_session_id uuid,
  p_counted_ves numeric,
  p_counted_ref numeric,
  p_theoretical_ves numeric,
  p_theoretical_ref numeric,
  p_actor uuid,
  p_reason text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_over_ves numeric(14,2) := greatest(round(coalesce(p_counted_ves, 0) - coalesce(p_theoretical_ves, 0), 2), 0);
  v_over_ref numeric(14,2) := greatest(round(coalesce(p_counted_ref, 0) - coalesce(p_theoretical_ref, 0), 2), 0);
  v_short_ves numeric(14,2) := greatest(round(coalesce(p_theoretical_ves, 0) - coalesce(p_counted_ves, 0), 2), 0);
  v_short_ref numeric(14,2) := greatest(round(coalesce(p_theoretical_ref, 0) - coalesce(p_counted_ref, 0), 2), 0);
  v_reason text := coalesce(nullif(trim(p_reason), ''), 'Cuadre de cierre de caja');
  v_session public.cash_sessions;
begin
  if p_actor is null then
    raise exception 'No se puede asentar la diferencia de cierre sin un responsable';
  end if;

  -- R2 — con usuario (cierre manual): su tienda es la del asiento y el
  -- responsable es el mismo. El autocierre corre sin usuario (service_role).
  if auth.uid() is not null then
    if p_store_id is distinct from public.assert_store_context()
       or p_actor is distinct from auth.uid() then
      raise exception using
        errcode = 'PT403',
        message = 'No autorizado para asentar la diferencia de cierre de esta caja';
    end if;
  end if;

  -- La sesion es de la tienda indicada y sigue abierta. Quien llama ya la tiene
  -- bloqueada; aqui se vuelve a tomar el bloqueo en la misma transaccion.
  select * into v_session
  from public.cash_sessions
  where id = p_session_id
    and store_id = p_store_id
  for update;

  if not found then
    raise exception using errcode = 'PT404', message = 'Sesión de caja no encontrada';
  end if;

  if v_session.status <> 'open' then
    raise exception using errcode = 'PT409', message = 'La sesión de caja ya está cerrada';
  end if;

  -- La misma regla de close_cash_session: admin o quien abrio la caja.
  if auth.uid() is not null
     and coalesce(public.current_user_role()::text, '') <> 'admin'
     and v_session.opened_by is distinct from auth.uid() then
    raise exception using
      errcode = 'PT403',
      message = 'Solo quien abrió la caja o un administrador puede cerrarla';
  end if;

  -- Sobrante: en la gaveta hay más de lo que explican los movimientos.
  if v_over_ves > 0 or v_over_ref > 0 then
    insert into public.cash_movements (
      store_id, session_id, type, amount_ves, amount_ref, notes, created_by
    ) values (
      p_store_id, p_session_id, 'adjustment', v_over_ves, v_over_ref,
      v_reason || format(' — sobrante: lo contado supera el teórico en Bs %s / REF %s', v_over_ves, v_over_ref),
      p_actor
    );
  end if;

  -- Faltante: salió efectivo de la gaveta sin operación registrada.
  if v_short_ves > 0 or v_short_ref > 0 then
    insert into public.cash_movements (
      store_id, session_id, type, amount_ves, amount_ref, notes, created_by
    ) values (
      p_store_id, p_session_id, 'transfer_out', v_short_ves, v_short_ref,
      v_reason || format(' — faltante: lo contado queda por debajo del teórico en Bs %s / REF %s', v_short_ves, v_short_ref),
      p_actor
    );
  end if;
end;
$$;

-- R2 — funciones internas de caja / baul que mueven dinero: sin execute por
-- PostgREST. Las RPC security definer las siguen llamando como propietario.
-- 20260904b solo revocaba a PUBLIC; el grant directo de authenticated (default
-- privileges de Supabase) seguia vivo.
revoke all on function public.record_cash_close_difference(uuid, uuid, numeric, numeric, numeric, numeric, uuid, text)
  from public, anon, authenticated;
grant execute on function public.record_cash_close_difference(uuid, uuid, numeric, numeric, numeric, numeric, uuid, text)
  to service_role;

-- El cron del BFF la llama con la service role key (createAdminSupabaseClient).
revoke all on function public.auto_close_stale_cash_sessions() from public, anon, authenticated;
grant execute on function public.auto_close_stale_cash_sessions() to service_role;

-- Crea / toca el baul de la tienda que se le pase: solo para las RPC de caja.
revoke all on function public.ensure_store_vault(uuid) from public, anon, authenticated;
grant execute on function public.ensure_store_vault(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 3. cancel_purchase — copia de 20261006c + R3 (PT409 si hay pagos activos)
-- -----------------------------------------------------------------------------

create or replace function public.cancel_purchase(p_purchase_id uuid)
returns public.purchases
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_purchase public.purchases;
  v_line record;
  v_product public.products;
  v_product_ids uuid[];
  v_already_returned integer;
  v_quantity integer;
  v_active_payments integer;
  v_active_ves numeric(14,2);
begin
  v_store_id := public.assert_store_context();

  if coalesce(public.current_user_role()::text, '') not in ('admin', 'almacen') then
    raise exception using errcode = 'PT403', message = 'No autorizado para cancelar compras';
  end if;

  select * into v_purchase
  from public.purchases
  where id = p_purchase_id
    and store_id = v_store_id
  for update;

  if not found then
    raise exception using errcode = 'PT404', message = 'Compra no encontrada';
  end if;

  if v_purchase.status in ('cancelado', 'devuelto') then
    raise exception using errcode = 'PT409', message = 'La compra ya fue cancelada o devuelta';
  end if;

  -- R3 — el dinero se saca por cancel_payment, no por aqui: con pagos vivos la
  -- compra quedaba cancelada con el dinero fuera del baul y el pago ya no se podia
  -- anular. La compra esta bloqueada: register_payment espera y luego la ve
  -- cancelada (C8).
  select count(*), coalesce(sum(amount_ves), 0)
  into v_active_payments, v_active_ves
  from public.payments
  where purchase_id = p_purchase_id
    and status = 'activo';

  if v_active_payments > 0 then
    raise exception using
      errcode = 'PT409',
      message = format(
        'La compra %s tiene %s pago(s) activo(s) por Bs %s. Anula primero los pagos y luego cancela la compra.',
        v_purchase.purchase_number, v_active_payments, round(v_active_ves, 2)
      );
  end if;

  if v_purchase.status = 'recibido' then
    select array_agg(distinct product_id)
    into v_product_ids
    from public.purchase_items
    where purchase_id = p_purchase_id;

    perform 1
    from public.products
    where id = any(v_product_ids)
      and store_id = v_store_id
    order by id
    for update;

    for v_line in
      select product_id, sum(quantity)::integer as received
      from public.purchase_items
      where purchase_id = p_purchase_id
      group by product_id
      order by product_id
    loop
      select * into v_product
      from public.products
      where id = v_line.product_id
        and store_id = v_store_id
      for update;

      if not found then
        raise exception using
          errcode = 'PT404',
          message = format(
            'Producto no encontrado en tu tienda (%s): no se puede revertir el stock de la compra %s',
            v_line.product_id, v_purchase.purchase_number
          );
      end if;

      -- C15 — lo ya devuelto al proveedor con movimientos ligados a esta compra.
      select coalesce(-sum(quantity_delta), 0)::integer
      into v_already_returned
      from public.stock_movements
      where purchase_id = p_purchase_id
        and product_id = v_line.product_id
        and type = 'devolucion_proveedor';

      v_quantity := v_line.received - v_already_returned;

      if v_quantity > 0 then
        if v_product.current_stock - v_quantity < 0 then
          raise exception using
            errcode = 'PT409',
            message = 'No hay stock suficiente para revertir la compra';
        end if;

        insert into public.stock_movements (
          product_id,
          type,
          quantity_delta,
          purchase_id,
          reason,
          created_by,
          store_id
        )
        values (
          v_line.product_id,
          'ajuste_salida',
          -v_quantity,
          p_purchase_id,
          'Cancelacion ' || v_purchase.purchase_number,
          auth.uid(),
          v_store_id
        );
      end if;
    end loop;
  end if;

  update public.purchases
  set status = 'cancelado'
  where id = p_purchase_id
  returning * into v_purchase;

  return v_purchase;
end;
$$;

revoke all on function public.cancel_purchase(uuid) from public, anon;
grant execute on function public.cancel_purchase(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. return_purchase — copia de 20261006c + R3 (PT409 si hay pagos activos)
-- -----------------------------------------------------------------------------

create or replace function public.return_purchase(p_purchase_id uuid)
returns public.purchases
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_purchase public.purchases;
  v_line record;
  v_product public.products;
  v_product_ids uuid[];
  v_already_returned integer;
  v_quantity integer;
  v_active_payments integer;
  v_active_ves numeric(14,2);
begin
  v_store_id := public.assert_store_context();

  if coalesce(public.current_user_role()::text, '') not in ('admin', 'almacen') then
    raise exception using errcode = 'PT403', message = 'No autorizado para devolver compras';
  end if;

  select * into v_purchase
  from public.purchases
  where id = p_purchase_id
    and store_id = v_store_id
  for update;

  if not found then
    raise exception using errcode = 'PT404', message = 'Compra no encontrada';
  end if;

  if v_purchase.status in ('cancelado', 'devuelto') then
    raise exception using errcode = 'PT409', message = 'La compra ya fue cancelada o devuelta';
  end if;

  -- R3 — el dinero se saca por cancel_payment, no por aqui: con pagos vivos la
  -- compra quedaba devuelta con el dinero fuera del baul y el pago ya no se podia
  -- anular. La compra esta bloqueada: register_payment espera y luego la ve
  -- devuelta (C8).
  select count(*), coalesce(sum(amount_ves), 0)
  into v_active_payments, v_active_ves
  from public.payments
  where purchase_id = p_purchase_id
    and status = 'activo';

  if v_active_payments > 0 then
    raise exception using
      errcode = 'PT409',
      message = format(
        'La compra %s tiene %s pago(s) activo(s) por Bs %s. Anula primero los pagos y luego devuelve la compra.',
        v_purchase.purchase_number, v_active_payments, round(v_active_ves, 2)
      );
  end if;

  -- C14 — solo se devuelve lo que entro: un pedido nunca recibido se cancela.
  if v_purchase.status <> 'recibido' then
    raise exception using errcode = 'PT409', message = 'Solo se pueden devolver compras recibidas';
  end if;

  select array_agg(distinct product_id)
  into v_product_ids
  from public.purchase_items
  where purchase_id = p_purchase_id;

  perform 1
  from public.products
  where id = any(v_product_ids)
    and store_id = v_store_id
  order by id
  for update;

  for v_line in
    select product_id, sum(quantity)::integer as received
    from public.purchase_items
    where purchase_id = p_purchase_id
    group by product_id
    order by product_id
  loop
    select * into v_product
    from public.products
    where id = v_line.product_id
      and store_id = v_store_id
    for update;

    if not found then
      raise exception using
        errcode = 'PT404',
        message = format(
          'Producto no encontrado en tu tienda (%s): no se puede revertir el stock de la compra %s',
          v_line.product_id, v_purchase.purchase_number
        );
    end if;

    -- C15 — lo ya devuelto al proveedor con movimientos ligados a esta compra.
    select coalesce(-sum(quantity_delta), 0)::integer
    into v_already_returned
    from public.stock_movements
    where purchase_id = p_purchase_id
      and product_id = v_line.product_id
      and type = 'devolucion_proveedor';

    v_quantity := v_line.received - v_already_returned;

    if v_quantity > 0 then
      if v_product.current_stock - v_quantity < 0 then
        raise exception using
          errcode = 'PT409',
          message = 'No hay stock suficiente para revertir la compra';
      end if;

      insert into public.stock_movements (
        product_id,
        type,
        quantity_delta,
        purchase_id,
        reason,
        created_by,
        store_id
      )
      values (
        v_line.product_id,
        'devolucion_proveedor',
        -v_quantity,
        p_purchase_id,
        'Devolucion ' || v_purchase.purchase_number,
        auth.uid(),
        v_store_id
      );
    end if;
  end loop;

  update public.purchases
  set status = 'devuelto'
  where id = p_purchase_id
  returning * into v_purchase;

  return v_purchase;
end;
$$;

revoke all on function public.return_purchase(uuid) from public, anon;
grant execute on function public.return_purchase(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 5. register_payment — copia de 20261006c + R5 (bloqueo de la sesion de caja)
--    y R9 (rol con coalesce). Misma firma de 12 argumentos.
-- -----------------------------------------------------------------------------

create or replace function public.register_payment(
  p_sale_id uuid default null,
  p_purchase_id uuid default null,
  p_method public.payment_method default 'efectivo_ves',
  p_amount numeric default 0,
  p_bank_name text default null,
  p_phone text default null,
  p_reference_code text default null,
  p_notes text default null,
  p_change_method public.payment_method default null,
  p_change_amount numeric default 0,
  p_received_denominations jsonb default null,
  p_change_denominations jsonb default null
) returns public.payments language plpgsql security definer set search_path = public as $$
declare
  v_store_id uuid; v_sale public.sales; v_purchase public.purchases; v_payment public.payments;
  v_direction public.payment_direction; v_contact_id uuid; v_rate numeric(14,4);
  v_currency public.payment_currency; v_amount_ves numeric(14,2); v_amount_ref numeric(14,2);
  v_paid_ves numeric(14,2); v_paid_ref numeric(14,2); v_session public.cash_sessions;
  v_vault public.store_vaults; v_movement_ves numeric(14,2); v_movement_ref numeric(14,2);
  v_is_bank boolean;
  v_change_method public.payment_method; v_change_amount numeric(14,2);
  v_change_ves numeric(14,2) := 0; v_change_ref numeric(14,2) := 0;
  v_change_is_bank boolean := false; v_net_ves numeric(14,2);
  v_change_notes text;
  v_outstanding_ves numeric(14,2); v_overpay_tolerance numeric(14,2);
  v_cash_ves numeric(14,2); v_cash_ref numeric(14,2);
begin
  v_store_id := public.assert_store_context();
  if p_amount is null or p_amount <= 0 then
    raise exception 'El monto del pago debe ser mayor a cero' using errcode = 'PT400';
  end if;
  if (p_sale_id is null and p_purchase_id is null) or (p_sale_id is not null and p_purchase_id is not null) then
    raise exception 'Debe asociar el pago a una venta o a una compra' using errcode = 'PT400';
  end if;
  if p_method = 'pago_movil' then
    if p_bank_name is null or length(trim(p_bank_name)) = 0 then
      raise exception 'Pago Móvil requiere banco' using errcode = 'PT400';
    end if;
    if p_phone is null or length(trim(p_phone)) = 0 then
      raise exception 'Pago Móvil requiere teléfono' using errcode = 'PT400';
    end if;
    if p_reference_code is null or p_reference_code !~ '^[0-9]{4}$' then
      raise exception 'Pago Móvil requiere referencia de 4 dígitos' using errcode = 'PT400';
    end if;
  end if;
  if p_method = 'transferencia' then
    if p_bank_name is null or length(trim(p_bank_name)) = 0 then
      raise exception 'Transferencia requiere banco' using errcode = 'PT400';
    end if;
    if p_reference_code is null or length(trim(p_reference_code)) = 0 then
      raise exception 'Transferencia requiere número de transferencia' using errcode = 'PT400';
    end if;
  end if;

  -- Validación del vuelto (solo aplica a ventas).
  v_change_amount := round(coalesce(p_change_amount, 0), 2);
  if v_change_amount < 0 then
    raise exception 'El monto del vuelto no puede ser negativo' using errcode = 'PT400';
  end if;
  if p_purchase_id is not null and (p_change_method is not null or v_change_amount > 0) then
    raise exception 'No se puede registrar vuelto en un pago de compra: el vuelto solo aplica a pagos de venta'
      using errcode = 'PT400';
  end if;
  if v_change_amount > 0 and p_change_method is null then
    raise exception 'Debe indicar el método del vuelto' using errcode = 'PT400';
  end if;
  if v_change_amount > 0 then
    v_change_method := p_change_method;
  else
    v_change_method := null;
  end if;
  v_change_is_bank := coalesce(v_change_method in ('pago_movil', 'transferencia', 'punto_venta'), false);

  v_is_bank := p_method in ('pago_movil', 'transferencia', 'punto_venta');

  if p_sale_id is not null then
    if coalesce(public.current_user_role()::text, '') not in ('admin', 'contador', 'vendedor') then
      raise exception 'No autorizado para registrar pagos de ventas' using errcode = 'PT403';
    end if;
    select * into v_sale from public.sales where id = p_sale_id and store_id = v_store_id for update;
    if not found then raise exception 'Venta no encontrada' using errcode = 'PT404'; end if;
    -- C8 — una venta cancelada o devuelta no admite cobros: el pago la devolvia a
    -- pendiente_pago y permitia devolverla (y reponer stock) otra vez.
    if v_sale.status in ('cancelada', 'devuelta') then
      raise exception 'No se puede registrar un pago en una venta cancelada o devuelta' using errcode = 'PT409';
    end if;
    v_direction := 'entrada'; v_contact_id := v_sale.customer_id; v_rate := v_sale.ref_rate_ves;
    if p_method = 'efectivo_usd' then
      v_currency := 'USD'; v_amount_ref := round(p_amount, 2); v_amount_ves := round(p_amount * v_rate, 2);
    else
      v_currency := 'VES'; v_amount_ves := round(p_amount, 2); v_amount_ref := round(p_amount / v_rate, 2);
    end if;

    -- El vuelto se expresa siempre en Bs. a la tasa de la venta.
    if v_change_method is not null then
      if v_change_method = 'efectivo_usd' then
        v_change_ref := v_change_amount;
        v_change_ves := round(v_change_amount * v_rate, 2);
      else
        v_change_ref := 0;
        v_change_ves := round(v_change_amount, 2);
      end if;
      if v_change_ves <= 0 then
        raise exception 'El monto del vuelto debe ser mayor a cero' using errcode = 'PT400';
      end if;
      if v_change_ves > v_amount_ves then
        raise exception 'El vuelto (Bs %) no puede superar el monto recibido en esta línea (Bs %)',
          v_change_ves, v_amount_ves using errcode = 'PT400';
      end if;
    end if;

    -- A la venta se aplica el NETO recibido, no lo entregado por el cliente.
    v_net_ves := round(v_amount_ves - v_change_ves, 2);

    -- F2 — el neto no puede superar el saldo pendiente de la venta.
    --
    -- Sin saldo pendiente no hay nada que cobrar: ahí es donde se colaba el
    -- doble cobro (dos pagos idénticos dejaban `paid_ves` en 2x `total_ves`).
    --
    -- Con saldo pendiente sí hay una holgura legítima: el "redondeo a favor"
    -- (docs/cobro-pos-billetes.md §2). El cliente entrega billetes y el vuelto
    -- exacto casi nunca se puede armar, así que la gaveta se queda con la
    -- diferencia. Ese sobrante nunca supera el billete más pequeño de la moneda
    -- con la que se salda el resto:
    --   · vuelto en Bs. (efectivo o bancario) → Bs 10, el billete más chico;
    --     `greatest(10, 0.01 * rate)` mantiene el piso aun con tasas altas.
    --   · efectivo USD sin vuelto, o vuelto en efectivo USD → el ajuste fino es
    --     de $1 (no hay monedas), o sea `rate` bolívares.
    -- Cualquier exceso mayor es un monto errado, no un redondeo.
    v_outstanding_ves := round(v_sale.total_ves - coalesce(v_sale.paid_ves, 0), 2);
    if v_outstanding_ves <= 0.01 then
      raise exception 'La venta no tiene saldo pendiente: ya está cobrada (saldo pendiente: Bs %)',
        greatest(v_outstanding_ves, 0) using errcode = 'PT400';
    end if;
    v_overpay_tolerance := greatest(10, round(0.01 * v_rate, 2));
    if v_change_method = 'efectivo_usd'
       or (v_change_method is null and p_method = 'efectivo_usd') then
      v_overpay_tolerance := greatest(v_overpay_tolerance, round(v_rate, 2));
    end if;
    if v_net_ves > v_outstanding_ves + v_overpay_tolerance then
      raise exception 'El pago excede el saldo pendiente de la venta. Saldo pendiente: Bs %, neto del pago: Bs %',
        v_outstanding_ves, v_net_ves using errcode = 'PT400';
    end if;

    update public.sales set paid_ves = paid_ves + v_net_ves,
      status = case when paid_ves + v_net_ves >= total_ves then 'pagada'::public.sale_status else 'pendiente_pago'::public.sale_status end
    where id = p_sale_id returning paid_ves into v_paid_ves;
  else
    if coalesce(public.current_user_role()::text, '') not in ('admin', 'contador') then
      raise exception 'No autorizado para registrar pagos a proveedores' using errcode = 'PT403';
    end if;
    select * into v_purchase from public.purchases where id = p_purchase_id and store_id = v_store_id for update;
    if not found then raise exception 'Compra no encontrada' using errcode = 'PT404'; end if;
    -- C8 (rama de compras) — una compra cancelada o devuelta no admite pagos.
    if v_purchase.status in ('cancelado', 'devuelto') then
      raise exception 'No se puede registrar un pago en una compra cancelada o devuelta' using errcode = 'PT409';
    end if;
    v_direction := 'salida'; v_contact_id := v_purchase.supplier_id;
    select rate_ves into v_rate from public.exchange_rates where store_id = v_store_id order by created_at desc limit 1;
    if v_rate is null or v_rate <= 0 then v_rate := v_purchase.ref_rate_ves; end if;
    if p_method = 'efectivo_usd' then
      v_currency := 'USD'; v_amount_ref := round(p_amount, 2); v_amount_ves := round(p_amount * v_rate, 2);
    else
      v_currency := 'VES'; v_amount_ves := round(p_amount, 2); v_amount_ref := round(p_amount / v_rate, 2);
    end if;

    -- F3 — un pago a proveedor no puede superar el saldo pendiente de la factura.
    -- Aquí no hay vuelto ni billetes que redondear: la única holgura es el
    -- centavo de bolívar que puede aportar el redondeo de la conversión.
    v_outstanding_ves := round(v_purchase.total_ves - coalesce(v_purchase.paid_ves, 0), 2);
    if v_amount_ves > v_outstanding_ves + 0.01 then
      raise exception 'El pago excede el saldo pendiente de la compra. Saldo pendiente: Bs %, monto del pago: Bs %',
        v_outstanding_ves, v_amount_ves using errcode = 'PT400';
    end if;

    update public.purchases set paid_ves = paid_ves + v_amount_ves, paid_ref = paid_ref + v_amount_ref
    where id = p_purchase_id returning paid_ves, paid_ref into v_paid_ves, v_paid_ref;
  end if;

  -- F5 — los desgloses de billetes tienen que describir el dinero real.
  if p_received_denominations is not null then
    if p_method not in ('efectivo_ves', 'efectivo_usd') then
      raise exception 'El desglose de billetes recibidos solo aplica a pagos en efectivo'
        using errcode = 'PT400';
    end if;
    perform public.assert_payment_denominations(
      p_received_denominations,
      case when p_method = 'efectivo_usd' then 'USD' else 'VES' end,
      case when p_method = 'efectivo_usd' then v_amount_ref else v_amount_ves end,
      'recibidos'
    );
  end if;

  if p_change_denominations is not null then
    if v_change_method is null then
      raise exception 'No se puede enviar un desglose de billetes del vuelto si no hay vuelto'
        using errcode = 'PT400';
    end if;
    if v_change_method not in ('efectivo_ves', 'efectivo_usd') then
      raise exception 'El desglose de billetes del vuelto solo aplica a vueltos en efectivo'
        using errcode = 'PT400';
    end if;
    perform public.assert_payment_denominations(
      p_change_denominations,
      case when v_change_method = 'efectivo_usd' then 'USD' else 'VES' end,
      case when v_change_method = 'efectivo_usd' then v_change_ref else v_change_ves end,
      'del vuelto'
    );
  end if;

  insert into public.payments (
    direction, sale_id, purchase_id, contact_id, method, currency, amount, amount_ves, amount_ref,
    ref_rate_ves, bank_name, phone, reference_code, notes, created_by, store_id,
    change_method, change_amount, change_ves, change_ref,
    received_denominations, change_denominations
  ) values (
    v_direction, p_sale_id, p_purchase_id, v_contact_id, p_method, v_currency, p_amount, v_amount_ves, v_amount_ref,
    v_rate, nullif(trim(p_bank_name), ''), nullif(trim(p_phone), ''), p_reference_code, p_notes, auth.uid(), v_store_id,
    v_change_method, case when v_change_method is null then 0 else v_change_amount end, v_change_ves, v_change_ref,
    p_received_denominations, p_change_denominations
  ) returning * into v_payment;

  -- Efectivo venta → solo caja (físico).
  if p_method in ('efectivo_ves', 'efectivo_usd') and p_sale_id is not null then
    v_session := public.get_open_cash_session_for_user(auth.uid(), v_store_id);
    if v_session.id is null and public.current_user_role() in ('admin', 'contador') then
      select * into v_session from public.cash_sessions
      where store_id = v_store_id and status = 'open' order by opened_at desc limit 1;
    end if;
    if v_session.id is null then
      raise exception 'No puede registrar un pago en efectivo: no tiene una sesión de caja abierta en su caja asignada'
        using errcode = 'PT400';
    end if;
    -- R5 — la sesion se bloquea antes de escribir en cash_movements y se revalida
    -- que siga abierta: close_cash_session y el autocierre la toman for update,
    -- asi que o el cierre espera a este cobro y lo incluye, o el cobro espera al
    -- cierre y se rechaza. Orden: documento -> productos -> pago -> sesion -> baul.
    select * into v_session from public.cash_sessions
    where id = v_session.id and status = 'open' for share;
    if not found then
      raise exception 'La sesión de caja se cerró mientras se registraba el cobro. Abre la caja y vuelve a intentarlo'
        using errcode = 'PT409';
    end if;
    v_movement_ves := case when p_method = 'efectivo_ves' then v_payment.amount_ves else 0 end;
    v_movement_ref := case when p_method = 'efectivo_usd' then v_payment.amount_ref else 0 end;
    insert into public.cash_movements (store_id, session_id, type, amount_ves, amount_ref, payment_id, notes, created_by)
    values (v_store_id, v_session.id, 'sale_in', v_movement_ves, v_movement_ref, v_payment.id,
      coalesce(nullif(trim(p_notes), ''), 'Pago en efectivo de venta'), auth.uid());

  -- Efectivo compra → baúl efectivo.
  elsif p_method in ('efectivo_ves', 'efectivo_usd') and p_purchase_id is not null then
    perform public.ensure_store_vault(v_store_id);
    select * into v_vault from public.store_vaults where store_id = v_store_id for update;
    v_movement_ves := case when p_method = 'efectivo_ves' then v_payment.amount_ves else 0 end;
    v_movement_ref := case when p_method = 'efectivo_usd' then v_payment.amount_ref else 0 end;
    if (p_method = 'efectivo_ves' and v_vault.balance_efectivo_ves < v_movement_ves)
       or (p_method = 'efectivo_usd' and v_vault.balance_ref < v_movement_ref) then
      if p_method = 'efectivo_ves' then
        raise exception 'Saldo insuficiente en el baul (efectivo). Faltante VES: %',
          greatest(v_movement_ves - v_vault.balance_efectivo_ves, 0) using errcode = 'PT402';
      else
        raise exception 'Saldo insuficiente en el baul. Faltante REF: %',
          greatest(v_movement_ref - v_vault.balance_ref, 0) using errcode = 'PT402';
      end if;
    end if;
    update public.store_vaults
    set balance_efectivo_ves = balance_efectivo_ves - v_movement_ves,
        balance_ref = balance_ref - v_movement_ref
    where id = v_vault.id;
    insert into public.vault_movements (
      store_id, vault_id, type, bucket, amount_ves, amount_ref, payment_id, notes, created_by
    ) values (
      v_store_id, v_vault.id, 'purchase_out', 'efectivo', v_movement_ves, v_movement_ref, v_payment.id,
      coalesce(nullif(trim(p_notes), ''), 'Pago en efectivo a proveedor'), auth.uid()
    );

  -- Cuenta (PM / transferencia / punto) venta → caja account_in + baúl cuenta.
  elsif v_is_bank and p_sale_id is not null then
    v_session := public.get_open_cash_session_for_user(auth.uid(), v_store_id);
    if v_session.id is null and public.current_user_role() in ('admin', 'contador') then
      select * into v_session from public.cash_sessions
      where store_id = v_store_id and status = 'open' order by opened_at desc limit 1;
    end if;
    if v_session.id is null then
      raise exception 'No puede registrar pago móvil/transferencia/punto: no hay sesión de caja abierta'
        using errcode = 'PT400';
    end if;
    -- R5 — la sesion se bloquea antes de escribir en cash_movements y se revalida
    -- que siga abierta: close_cash_session y el autocierre la toman for update,
    -- asi que o el cierre espera a este cobro y lo incluye, o el cobro espera al
    -- cierre y se rechaza. Orden: documento -> productos -> pago -> sesion -> baul.
    select * into v_session from public.cash_sessions
    where id = v_session.id and status = 'open' for share;
    if not found then
      raise exception 'La sesión de caja se cerró mientras se registraba el cobro. Abre la caja y vuelve a intentarlo'
        using errcode = 'PT409';
    end if;
    insert into public.cash_movements (store_id, session_id, type, amount_ves, amount_ref, payment_id, notes, created_by)
    values (v_store_id, v_session.id, 'account_in', v_payment.amount_ves, 0, v_payment.id,
      coalesce(nullif(trim(p_notes), ''), 'Cobro en cuenta (' || p_method::text || ')'), auth.uid());
    perform public.ensure_store_vault(v_store_id);
    select * into v_vault from public.store_vaults where store_id = v_store_id for update;
    update public.store_vaults
    set balance_ves = balance_ves + v_payment.amount_ves
    where id = v_vault.id;
    insert into public.vault_movements (
      store_id, vault_id, type, bucket, amount_ves, amount_ref, payment_id, notes, created_by
    ) values (
      v_store_id, v_vault.id, 'sale_in', 'cuenta', v_payment.amount_ves, 0, v_payment.id,
      coalesce(nullif(trim(p_notes), ''), 'Ingreso a cuenta por venta (' || p_method::text || ')'), auth.uid()
    );

  -- Cuenta compra → baúl cuenta (sin caja).
  elsif v_is_bank and p_purchase_id is not null then
    perform public.ensure_store_vault(v_store_id);
    select * into v_vault from public.store_vaults where store_id = v_store_id for update;
    if v_vault.balance_ves < v_payment.amount_ves then
      raise exception 'Saldo insuficiente en el baul (cuenta). Faltante VES: %',
        greatest(v_payment.amount_ves - v_vault.balance_ves, 0) using errcode = 'PT402';
    end if;
    update public.store_vaults
    set balance_ves = balance_ves - v_payment.amount_ves
    where id = v_vault.id;
    insert into public.vault_movements (
      store_id, vault_id, type, bucket, amount_ves, amount_ref, payment_id, notes, created_by
    ) values (
      v_store_id, v_vault.id, 'purchase_out', 'cuenta', v_payment.amount_ves, 0, v_payment.id,
      coalesce(nullif(trim(p_notes), ''), 'Pago a proveedor desde cuenta (' || p_method::text || ')'), auth.uid()
    );
  end if;

  -- Asiento del vuelto (docs/cobro-pos-billetes.md §3.4 y §6).
  if v_change_method is not null then
    if v_session.id is null then
      raise exception 'No puede registrar el vuelto: no hay sesión de caja abierta' using errcode = 'PT400';
    end if;
    v_change_notes := coalesce(
      nullif(trim(p_notes), ''),
      'Vuelto de venta (' || v_change_method::text || ')'
    );

    if v_change_method in ('efectivo_ves', 'efectivo_usd') then
      -- F1 — el vuelto en efectivo sale de la gaveta: solo se puede entregar lo
      -- que la gaveta tiene. Se recalcula el efectivo físico de la sesión con la
      -- misma fórmula de `close_cash_session` (el `sale_in` de ESTE pago ya está
      -- escrito en esta transacción y, con razón, cuenta como disponible).
      select round(v_session.opening_ves + coalesce(sum(case
               when type in ('sale_in', 'adjustment') then amount_ves
               when type in ('transfer_out', 'refund_out', 'change_out') then -amount_ves else 0 end), 0), 2),
             round(v_session.opening_ref + coalesce(sum(case
               when type in ('sale_in', 'adjustment') then amount_ref
               when type in ('transfer_out', 'refund_out', 'change_out') then -amount_ref else 0 end), 0), 2)
      into v_cash_ves, v_cash_ref
      from public.cash_movements where session_id = v_session.id;

      if v_change_method = 'efectivo_ves' and v_change_ves > v_cash_ves then
        raise exception 'No hay suficiente efectivo en la caja para entregar el vuelto. Disponible: Bs %, vuelto: Bs %',
          v_cash_ves, v_change_ves using errcode = 'PT400';
      end if;
      if v_change_method = 'efectivo_usd' and v_change_ref > v_cash_ref then
        raise exception 'No hay suficiente efectivo en la caja para entregar el vuelto. Disponible: $ %, vuelto: $ %',
          v_cash_ref, v_change_ref using errcode = 'PT400';
      end if;

      -- Sale de la gaveta: en Bs. o en USD. El baúl no se toca.
      insert into public.cash_movements (store_id, session_id, type, amount_ves, amount_ref, payment_id, notes, created_by)
      values (
        v_store_id, v_session.id, 'change_out',
        case when v_change_method = 'efectivo_ves' then v_change_ves else 0 end,
        case when v_change_method = 'efectivo_usd' then v_change_ref else 0 end,
        v_payment.id, v_change_notes, auth.uid()
      );
    elsif v_change_is_bank then
      -- Sale de la cuenta bancaria: caja lo refleja y el baúl (cubeta cuenta) baja.
      insert into public.cash_movements (store_id, session_id, type, amount_ves, amount_ref, payment_id, notes, created_by)
      values (v_store_id, v_session.id, 'account_out', v_change_ves, 0, v_payment.id, v_change_notes, auth.uid());

      perform public.ensure_store_vault(v_store_id);
      select * into v_vault from public.store_vaults where store_id = v_store_id for update;
      if v_vault.balance_ves < v_change_ves then
        raise exception 'Saldo insuficiente en el baul (cuenta) para entregar el vuelto. Faltante VES: %',
          greatest(v_change_ves - v_vault.balance_ves, 0) using errcode = 'PT402';
      end if;
      update public.store_vaults
      set balance_ves = balance_ves - v_change_ves
      where id = v_vault.id;
      insert into public.vault_movements (
        store_id, vault_id, type, bucket, amount_ves, amount_ref, payment_id, notes, created_by
      ) values (
        v_store_id, v_vault.id, 'withdrawal', 'cuenta', v_change_ves, 0, v_payment.id,
        v_change_notes, auth.uid()
      );
    end if;
  end if;

  return v_payment;
end;
$$;

revoke all on function public.register_payment(
  uuid, uuid, public.payment_method, numeric, text, text, text, text,
  public.payment_method, numeric, jsonb, jsonb
) from public, anon;
grant execute on function public.register_payment(
  uuid, uuid, public.payment_method, numeric, text, text, text, text,
  public.payment_method, numeric, jsonb, jsonb
) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 6. create_sale — copia de 20261006b + R6 (validacion de entrada). Misma firma.
-- -----------------------------------------------------------------------------

create or replace function public.create_sale(
  p_customer_id uuid,
  p_items jsonb,
  p_exchange_rate_id uuid default null,
  p_ref_rate_ves numeric default null,
  p_discount_ref numeric default 0,
  p_tax_ref numeric default 0,
  p_notes text default null,
  p_invoice_number text default null,
  p_client_request_id uuid default null
)
returns public.sales
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Banda permitida entre la tasa enviada y la ultima tasa registrada de la tienda.
  -- 0.05 = +-5%. Ver cabecera de 20260904c para la justificacion.
  c_rate_tolerance constant numeric := 0.05;
  v_store_id uuid;
  v_role text;
  v_rate numeric(14,4);
  v_reference_rate numeric(14,4);
  v_sale public.sales;
  v_item jsonb;
  v_product public.products;
  v_product_id uuid;
  v_product_ids uuid[];
  v_quantity integer;
  v_unit_price_ref numeric(12,2);
  v_unit_cost_ref numeric(12,2);
  v_line_subtotal_ref numeric(14,2);
  v_line_subtotal_ves numeric(14,2);
  v_subtotal_ref numeric(14,2) := 0;
  v_total_ref numeric(14,2);
  v_total_ves numeric(14,2);
  v_request_hash text;
  v_invoice_seq bigint;
  v_constraint text;
begin
  v_store_id := public.assert_store_context();
  v_role := coalesce(public.current_user_role()::text, '');

  if v_role not in ('admin', 'vendedor') then
    raise exception using errcode = 'PT403', message = 'No autorizado para crear ventas';
  end if;

  -- C4 — reintento del mismo intento de cobro. El advisory lock serializa dos
  -- peticiones simultaneas con la misma clave: la segunda espera el commit de la
  -- primera y encuentra su venta (nunca llega al indice unico).
  if p_client_request_id is not null then
    perform pg_advisory_xact_lock(
      hashtextextended('sale-request:' || v_store_id::text || ':' || p_client_request_id::text, 0)
    );

    v_request_hash := public.sale_request_hash(p_customer_id, p_items, p_discount_ref, p_tax_ref, '[]'::jsonb);
    v_sale := public.sale_idempotent_replay(v_store_id, p_client_request_id, v_request_hash);

    if v_sale.id is not null then
      return v_sale;
    end if;
  end if;

  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception using errcode = 'PT400', message = 'La venta debe tener al menos un item';
  end if;

  -- R6 — forma de cada linea antes de convertirla: un uuid, un entero o un
  -- precio mal escritos salian como 22P02 / 22003 crudos.
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item) is distinct from 'object'
       or coalesce(v_item ->> 'product_id', '') !~ '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$' then
      raise exception using errcode = 'PT400', message = 'Identificador de producto invalido en item de venta';
    end if;

    if coalesce(v_item ->> 'quantity', '') !~ '^[0-9]{1,9}$' then
      raise exception using errcode = 'PT400', message = 'Cantidad invalida en item de venta';
    end if;

    if (v_item ->> 'unit_price_ref') is not null
       and (v_item ->> 'unit_price_ref') !~ '^-?[0-9]{1,10}([.][0-9]+)?$' then
      raise exception using errcode = 'PT400', message = 'Precio unitario invalido en item de venta';
    end if;
  end loop;

  if coalesce(p_discount_ref, 0) < 0 or coalesce(p_tax_ref, 0) < 0 then
    raise exception using errcode = 'PT400', message = 'El descuento y el impuesto no pueden ser negativos';
  end if;

  if p_exchange_rate_id is not null then
    select rate_ves into v_rate
    from public.exchange_rates
    where id = p_exchange_rate_id
      and store_id = v_store_id;
  else
    v_rate := p_ref_rate_ves;
  end if;

  if v_rate is null or v_rate <= 0 then
    raise exception using errcode = 'PT400', message = 'Debe indicar una tasa ref/VES valida';
  end if;

  -- Tasa vigente de la tienda: ultima fila registrada.
  select rate_ves into v_reference_rate
  from public.exchange_rates
  where store_id = v_store_id
  order by created_at desc
  limit 1;

  if v_reference_rate is not null and v_reference_rate > 0 then
    if v_rate < v_reference_rate * (1 - c_rate_tolerance)
       or v_rate > v_reference_rate * (1 + c_rate_tolerance) then
      raise exception using
        errcode = 'PT400',
        message = format(
          'Tasa ref/VES fuera de rango: se envio %s Bs/REF y la tasa vigente de la tienda es %s Bs/REF (tolerancia +-%s). Actualiza la tasa y vuelve a intentar.',
          round(v_rate, 4),
          round(v_reference_rate, 4),
          trim(trailing '.' from trim(trailing '0' from round(c_rate_tolerance * 100, 2)::text)) || '%'
        );
    end if;
  end if;

  perform public.assert_contact_type(p_customer_id, array['cliente', 'ambos']::public.contact_type[]);

  if not exists (
    select 1
    from public.contacts
    where id = p_customer_id
      and store_id = v_store_id
  ) then
    raise exception using errcode = 'PT400', message = 'Contacto no pertenece a tu tienda';
  end if;

  -- C11 — el numero por defecto sale de una secuencia: dos ventas en el mismo
  -- milisegundo ya no chocan en sales_store_invoice_unique.
  if p_invoice_number is null then
    v_invoice_seq := nextval('public.sales_invoice_seq');
  end if;

  insert into public.sales (
    invoice_number,
    customer_id,
    user_id,
    exchange_rate_id,
    ref_rate_ves,
    discount_ref,
    tax_ref,
    status,
    notes,
    store_id,
    client_request_id,
    client_request_hash
  )
  values (
    coalesce(
      p_invoice_number,
      'V-' || to_char(clock_timestamp(), 'YYYYMMDD') || '-'
        || lpad(v_invoice_seq::text, greatest(6, length(v_invoice_seq::text)), '0')
    ),
    p_customer_id,
    auth.uid(),
    p_exchange_rate_id,
    v_rate,
    coalesce(p_discount_ref, 0),
    coalesce(p_tax_ref, 0),
    'pendiente_pago',
    p_notes,
    v_store_id,
    p_client_request_id,
    case when p_client_request_id is not null then v_request_hash end
  )
  returning * into v_sale;

  -- C10 — documento primero; despues TODOS los productos de la venta en una sola
  -- sentencia y en orden fijo. Dos ventas con las mismas lineas en orden inverso
  -- ya no se bloquean entre si.
  select array_agg(distinct (e.value ->> 'product_id')::uuid)
  into v_product_ids
  from jsonb_array_elements(p_items) as e(value);

  perform 1
  from public.products
  where id = any(v_product_ids)
    and store_id = v_store_id
  order by id
  for update;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_product_id := (v_item ->> 'product_id')::uuid;
    v_quantity := (v_item ->> 'quantity')::integer;

    if v_quantity is null or v_quantity <= 0 then
      raise exception using errcode = 'PT400', message = 'Cantidad invalida en item de venta';
    end if;

    select * into v_product
    from public.products
    where id = v_product_id
      and store_id = v_store_id
      and is_active = true
    for update;

    if not found then
      raise exception using
        errcode = 'PT404',
        message = format('Producto no encontrado o inactivo: %s', v_product_id);
    end if;

    if v_product.current_stock < v_quantity then
      raise exception using
        errcode = 'PT409',
        message = format('Stock insuficiente para producto %s', v_product.sku);
    end if;

    v_unit_price_ref := coalesce((v_item ->> 'unit_price_ref')::numeric, v_product.sale_price_ref);

    if v_unit_price_ref is null or v_unit_price_ref < 0 then
      raise exception using
        errcode = 'PT400',
        message = format('Precio unitario invalido para el producto %s', v_product.sku);
    end if;

    -- Un precio unitario en cero solo se acepta si el producto vale cero de lista.
    if v_unit_price_ref = 0 and coalesce(v_product.sale_price_ref, 0) <> 0 then
      raise exception using
        errcode = 'PT400',
        message = format(
          'Precio unitario en cero no permitido para el producto %s (precio de lista: %s REF)',
          v_product.sku, round(v_product.sale_price_ref, 2)
        );
    end if;

    -- C19 — el vendedor no vende por debajo del precio de lista (el admin si
    -- puede fijar otro precio).
    if v_role = 'vendedor' and v_unit_price_ref < round(coalesce(v_product.sale_price_ref, 0), 2) then
      raise exception using
        errcode = 'PT400',
        message = format(
          'Precio unitario por debajo del precio de lista para el producto %s (precio de lista: %s REF)',
          v_product.sku, round(v_product.sale_price_ref, 2)
        );
    end if;

    v_unit_cost_ref := coalesce(v_product.current_cost_ref, 0);
    v_line_subtotal_ref := round(v_quantity::numeric * v_unit_price_ref, 2);
    v_line_subtotal_ves := round(v_line_subtotal_ref * v_rate, 2);
    v_subtotal_ref := v_subtotal_ref + v_line_subtotal_ref;

    insert into public.sale_items (
      sale_id,
      product_id,
      quantity,
      unit_price_ref,
      unit_cost_ref_snapshot,
      subtotal_ves
    )
    values (
      v_sale.id,
      v_product_id,
      v_quantity,
      v_unit_price_ref,
      v_unit_cost_ref,
      v_line_subtotal_ves
    );

    -- Modo estricto: stock_after lo fija stock_movements_apply(), que tambien
    -- actualiza products.current_stock.
    insert into public.stock_movements (
      product_id,
      type,
      quantity_delta,
      sale_id,
      reason,
      created_by,
      store_id
    )
    values (
      v_product_id,
      'venta',
      -v_quantity,
      v_sale.id,
      'Venta ' || v_sale.invoice_number,
      auth.uid(),
      v_store_id
    );
  end loop;

  -- C19 — el vendedor no deja la venta en cero con el descuento.
  if v_role = 'vendedor'
     and coalesce(p_discount_ref, 0) > 0
     and coalesce(p_discount_ref, 0) >= v_subtotal_ref then
    raise exception using
      errcode = 'PT400',
      message = format(
        'El descuento (%s REF) debe ser menor que el subtotal de la venta (%s REF)',
        round(p_discount_ref, 2), round(v_subtotal_ref, 2)
      );
  end if;

  v_total_ref := greatest(round(v_subtotal_ref - coalesce(p_discount_ref, 0) + coalesce(p_tax_ref, 0), 2), 0);
  v_total_ves := round(v_total_ref * v_rate, 2);

  update public.sales
  set subtotal_ref = v_subtotal_ref,
      total_ref = v_total_ref,
      total_ves = v_total_ves
  where id = v_sale.id
  returning * into v_sale;

  return v_sale;
exception
  -- R6 — tasa, precio x cantidad o totales que no caben en sus columnas.
  when numeric_value_out_of_range then
    raise exception using
      errcode = 'PT400',
      message = 'Alguna cantidad o monto de la venta esta fuera del rango permitido';
  -- R6 — numero de factura repetido en la tienda. Cualquier otro choque sigue igual.
  when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'sales_store_invoice_unique' then
      raise exception using
        errcode = 'PT409',
        message = format('Ya existe una venta con el numero de factura %s', p_invoice_number);
    end if;
    raise;
end;
$$;

revoke all on function public.create_sale(uuid, jsonb, uuid, numeric, numeric, numeric, text, text, uuid) from public, anon;
grant execute on function public.create_sale(uuid, jsonb, uuid, numeric, numeric, numeric, text, text, uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 7. create_sale_with_payments — copia de 20261006b + R6 (validacion de los
--    pagos). Misma firma.
-- -----------------------------------------------------------------------------

create or replace function public.create_sale_with_payments(
  p_customer_id uuid,
  p_items jsonb,
  p_payments jsonb default '[]'::jsonb,
  p_exchange_rate_id uuid default null,
  p_ref_rate_ves numeric default null,
  p_discount_ref numeric default 0,
  p_tax_ref numeric default 0,
  p_notes text default null,
  p_invoice_number text default null,
  p_client_request_id uuid default null
)
returns public.sales
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_sale public.sales;
  v_payment jsonb;
  v_change_amount numeric;
  v_request_hash text;
begin
  v_store_id := public.assert_store_context();

  -- C4 — reintento del mismo intento de cobro: la venta ya quedo registrada.
  -- Solo se devuelve si el contenido (incluidos los pagos) es el mismo, es del
  -- mismo usuario y sigue viva; si no, PT409. Mismo advisory lock que create_sale.
  if p_client_request_id is not null then
    perform pg_advisory_xact_lock(
      hashtextextended('sale-request:' || v_store_id::text || ':' || p_client_request_id::text, 0)
    );

    v_request_hash := public.sale_request_hash(p_customer_id, p_items, p_discount_ref, p_tax_ref, p_payments);
    v_sale := public.sale_idempotent_replay(v_store_id, p_client_request_id, v_request_hash);

    if v_sale.id is not null then
      return v_sale;
    end if;
  end if;

  if p_payments is not null and jsonb_typeof(p_payments) <> 'array' then
    raise exception 'Los pagos de la venta deben venir como lista' using errcode = 'PT400';
  end if;

  -- R6 — forma de cada pago antes de convertirlo (metodo y montos): un metodo
  -- desconocido o un monto mal escrito salian como 22P02 crudo.
  for v_payment in select * from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb))
  loop
    if jsonb_typeof(v_payment) is distinct from 'object' then
      raise exception using errcode = 'PT400', message = 'Cada pago de la venta debe ser un objeto';
    end if;

    if coalesce(v_payment ->> 'method', '') <> all (enum_range(null::public.payment_method)::text[]) then
      raise exception using errcode = 'PT400', message = 'Metodo de pago invalido';
    end if;

    if coalesce(v_payment ->> 'amount', '') !~ '^-?[0-9]{1,10}([.][0-9]+)?$' then
      raise exception using errcode = 'PT400', message = 'Monto de pago invalido';
    end if;

    if (v_payment ->> 'change_amount') is not null
       and (v_payment ->> 'change_amount') !~ '^-?[0-9]{1,10}([.][0-9]+)?$' then
      raise exception using errcode = 'PT400', message = 'Monto del vuelto invalido';
    end if;

    -- El metodo del vuelto solo se usa cuando hay vuelto (igual que abajo).
    if coalesce((v_payment ->> 'change_amount')::numeric, 0) > 0
       and (v_payment ->> 'change_method') is not null
       and (v_payment ->> 'change_method') <> all (enum_range(null::public.payment_method)::text[]) then
      raise exception using errcode = 'PT400', message = 'Metodo del vuelto invalido';
    end if;
  end loop;

  -- create_sale escribe la clave y la huella (sin pagos) en el INSERT.
  v_sale := public.create_sale(
    p_customer_id,
    p_items,
    p_exchange_rate_id,
    p_ref_rate_ves,
    p_discount_ref,
    p_tax_ref,
    p_notes,
    p_invoice_number,
    p_client_request_id
  );

  -- La huella definitiva incluye los pagos de este intento de cobro.
  if p_client_request_id is not null then
    update public.sales
    set client_request_hash = v_request_hash
    where id = v_sale.id;
  end if;

  for v_payment in select * from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb))
  loop
    v_change_amount := coalesce((v_payment ->> 'change_amount')::numeric, 0);

    -- Cualquier excepcion aqui (saldo, vuelto, billetes, caja cerrada, permisos)
    -- aborta la funcion completa y Postgres revierte la venta y el stock.
    perform public.register_payment(
      p_sale_id => v_sale.id,
      p_purchase_id => null,
      p_method => (v_payment ->> 'method')::public.payment_method,
      p_amount => (v_payment ->> 'amount')::numeric,
      p_bank_name => v_payment ->> 'bank_name',
      p_phone => v_payment ->> 'phone',
      p_reference_code => v_payment ->> 'reference_code',
      p_notes => v_payment ->> 'notes',
      p_change_method => case
        when v_change_amount > 0 then (v_payment ->> 'change_method')::public.payment_method
        else null
      end,
      p_change_amount => v_change_amount,
      p_received_denominations => case
        when jsonb_typeof(v_payment -> 'received_denominations') = 'object'
          then v_payment -> 'received_denominations'
        else null
      end,
      p_change_denominations => case
        when jsonb_typeof(v_payment -> 'change_denominations') = 'object'
          then v_payment -> 'change_denominations'
        else null
      end
    );
  end loop;

  -- `register_payment` actualiza paid_ves y status: se relee la fila final.
  select * into v_sale
  from public.sales
  where id = v_sale.id;

  return v_sale;
exception
  -- R6 — un monto de pago que no cabe en sus columnas al convertirlo a Bs / REF.
  when numeric_value_out_of_range then
    raise exception using
      errcode = 'PT400',
      message = 'Algun monto del cobro esta fuera del rango permitido';
end;
$$;

revoke all on function public.create_sale_with_payments(
  uuid, jsonb, jsonb, uuid, numeric, numeric, numeric, text, text, uuid
) from public, anon;
grant execute on function public.create_sale_with_payments(
  uuid, jsonb, jsonb, uuid, numeric, numeric, numeric, text, text, uuid
) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 8. create_purchase — copia de 20261006c + R6 (validacion de entrada). Misma firma.
-- -----------------------------------------------------------------------------

create or replace function public.create_purchase(
  p_supplier_id uuid,
  p_items jsonb,
  p_exchange_rate_id uuid default null,
  p_ref_rate_ves numeric default null,
  p_discount_ref numeric default 0,
  p_tax_ref numeric default 0,
  p_notes text default null,
  p_purchase_number text default null,
  p_status public.purchase_status default 'recibido',
  p_discount_ves numeric default null,
  p_tax_ves numeric default null,
  p_subtotal_ves numeric default null,
  p_subtotal_ref numeric default null,
  p_client_request_id uuid default null
)
returns public.purchases
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_rate numeric(14,4);
  v_purchase public.purchases;
  v_item jsonb;
  v_product public.products;
  v_product_id uuid;
  v_product_ids uuid[];
  v_quantity integer;
  v_unit_cost_ref numeric(12,2);
  v_unit_cost_ves numeric(14,2);
  v_cost_with_tax_ref numeric(12,2);
  v_cost_with_tax_ves numeric(14,2);
  v_line_subtotal_ref numeric(14,2);
  v_line_subtotal_ves numeric(14,2);
  v_discount_ref numeric(14,2);
  v_discount_ves numeric(14,2);
  v_tax_ref numeric(14,2);
  v_tax_ves numeric(14,2);
  v_subtotal_ref numeric(14,2);
  v_subtotal_ves numeric(14,2);
  v_total_ref numeric(14,2);
  v_total_ves numeric(14,2);
  v_supplier_sku text;
  v_sp_id uuid;
  v_old_cost_ref numeric(12,2);
  v_old_cost_ves numeric(14,2);
  v_entry_mode text;
  v_pack_label text;
  v_pack_count integer;
  v_units_per_pack integer;
  v_pack_cost_ref numeric(12,2);
  v_pack_cost_ves numeric(14,2);
  v_tax_rate numeric(5,2);
  v_line_tax_ref numeric(14,2);
  v_line_tax_ves numeric(14,2);
  v_cost_currency text;
  v_pair_units integer;
  v_request_hash text;
  v_number_seq bigint;
  v_rows integer;
  v_constraint text;
begin
  v_store_id := public.assert_store_context();

  if coalesce(public.current_user_role()::text, '') not in ('admin', 'almacen') then
    raise exception using errcode = 'PT403', message = 'No autorizado para crear compras';
  end if;

  -- C6 — reintento del mismo envio. El advisory lock serializa dos peticiones
  -- simultaneas con la misma clave: la segunda espera el commit de la primera y
  -- encuentra su compra (nunca llega al indice unico).
  if p_client_request_id is not null then
    perform pg_advisory_xact_lock(
      hashtextextended('purchase-request:' || v_store_id::text || ':' || p_client_request_id::text, 0)
    );

    v_request_hash := public.stock_request_hash(jsonb_build_array(
      'create_purchase',
      p_supplier_id,
      p_items,
      p_status,
      round(coalesce(p_discount_ref, 0), 2)::text,
      round(coalesce(p_tax_ref, 0), 2)::text,
      round(p_discount_ves, 2)::text,
      round(p_tax_ves, 2)::text,
      round(p_subtotal_ves, 2)::text,
      round(p_subtotal_ref, 2)::text
    ));
    v_purchase := public.purchase_idempotent_replay(v_store_id, p_client_request_id, v_request_hash);

    if v_purchase.id is not null then
      return v_purchase;
    end if;
  end if;

  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception using errcode = 'PT400', message = 'La compra debe tener al menos un item';
  end if;

  -- R6 — forma de cada linea antes de convertirla: un uuid, un entero o un
  -- monto mal escritos salian como 22P02 crudo. Las cantidades se miran segun
  -- el modo de la linea, igual que en el bucle de abajo.
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item) is distinct from 'object'
       or coalesce(v_item ->> 'product_id', '') !~ '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$' then
      raise exception using errcode = 'PT400', message = 'Identificador de producto invalido en item de compra';
    end if;

    v_entry_mode := coalesce(nullif(trim(v_item ->> 'entry_mode'), ''), 'unit');

    if exists (
      select 1
      from unnest(
        array['unit_cost_ref', 'unit_cost_ves', 'subtotal_ref', 'subtotal_ves', 'tax_rate', 'tax_ref', 'tax_ves']
        || case when v_entry_mode = 'pack' then array['pack_cost_ref', 'pack_cost_ves'] else array[]::text[] end
      ) as k(name)
      where (v_item ->> k.name) is not null
        and (v_item ->> k.name) !~ '^-?[0-9]{1,12}([.][0-9]+)?$'
    ) then
      raise exception using errcode = 'PT400', message = 'Montos invalidos en item de compra';
    end if;

    if exists (
      select 1
      from unnest(
        case when v_entry_mode = 'pack' then array['pack_count', 'units_per_pack'] else array['quantity'] end
      ) as k(name)
      where (v_item ->> k.name) is not null
        and (v_item ->> k.name) !~ '^-?[0-9]{1,9}$'
    ) then
      raise exception using errcode = 'PT400', message = 'Cantidad invalida en item de compra';
    end if;
  end loop;

  if p_exchange_rate_id is not null then
    select rate_ves into v_rate
    from public.exchange_rates
    where id = p_exchange_rate_id
      and store_id = v_store_id;
  else
    v_rate := p_ref_rate_ves;
  end if;

  if v_rate is null or v_rate <= 0 then
    raise exception using errcode = 'PT400', message = 'Debe indicar una tasa ref/VES valida';
  end if;

  if p_status is null or p_status not in ('pedido', 'recibido') then
    raise exception using errcode = 'PT400', message = 'Solo se puede crear una compra en estado pedido o recibido';
  end if;

  if p_discount_ves is null or p_tax_ves is null or p_subtotal_ves is null or p_subtotal_ref is null then
    raise exception using
      errcode = 'PT400',
      message = 'Debe enviar subtotal/descuento/impuesto en REF y VES desde el cliente';
  end if;

  v_discount_ref := coalesce(p_discount_ref, 0);
  v_discount_ves := p_discount_ves;
  v_tax_ref := coalesce(p_tax_ref, 0);
  v_tax_ves := p_tax_ves;
  v_subtotal_ref := p_subtotal_ref;
  v_subtotal_ves := p_subtotal_ves;

  if v_discount_ref < 0 or v_discount_ves < 0 or v_tax_ref < 0 or v_tax_ves < 0
     or v_subtotal_ref < 0 or v_subtotal_ves < 0 then
    raise exception using errcode = 'PT400', message = 'Totales de compra invalidos';
  end if;

  perform public.assert_contact_type(p_supplier_id, array['proveedor', 'ambos']::public.contact_type[]);

  if not exists (
    select 1
    from public.contacts
    where id = p_supplier_id
      and store_id = v_store_id
  ) then
    raise exception using errcode = 'PT400', message = 'Contacto no pertenece a tu tienda';
  end if;

  -- C11 — el numero por defecto sale de una secuencia: dos compras en el mismo
  -- milisegundo ya no chocan en purchases_store_number_unique.
  if p_purchase_number is null then
    v_number_seq := nextval('public.purchases_number_seq');
  end if;

  insert into public.purchases (
    purchase_number,
    supplier_id,
    user_id,
    exchange_rate_id,
    ref_rate_ves,
    discount_ref,
    tax_ref,
    status,
    notes,
    store_id,
    client_request_id,
    client_request_hash
  )
  values (
    coalesce(
      p_purchase_number,
      'C-' || to_char(clock_timestamp(), 'YYYYMMDD') || '-'
        || lpad(v_number_seq::text, greatest(6, length(v_number_seq::text)), '0')
    ),
    p_supplier_id,
    auth.uid(),
    p_exchange_rate_id,
    v_rate,
    v_discount_ref,
    v_tax_ref,
    p_status,
    p_notes,
    v_store_id,
    p_client_request_id,
    case when p_client_request_id is not null then v_request_hash end
  )
  returning * into v_purchase;

  -- Documento primero; despues TODOS los productos de la compra en una sola
  -- sentencia y en orden fijo.
  select array_agg(distinct (e.value ->> 'product_id')::uuid)
  into v_product_ids
  from jsonb_array_elements(p_items) as e(value);

  perform 1
  from public.products
  where id = any(v_product_ids)
    and store_id = v_store_id
  order by id
  for update;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_product_id := (v_item ->> 'product_id')::uuid;
    v_supplier_sku := v_item ->> 'supplier_sku';
    v_entry_mode := coalesce(nullif(trim(v_item ->> 'entry_mode'), ''), 'unit');
    v_cost_currency := coalesce(nullif(trim(v_item ->> 'cost_currency'), ''), 'ves');

    if v_cost_currency not in ('ves', 'ref') then
      raise exception using errcode = 'PT400', message = 'cost_currency invalido en item de compra';
    end if;

    v_unit_cost_ref := (v_item ->> 'unit_cost_ref')::numeric;
    v_unit_cost_ves := (v_item ->> 'unit_cost_ves')::numeric;
    v_line_subtotal_ref := (v_item ->> 'subtotal_ref')::numeric;
    v_line_subtotal_ves := (v_item ->> 'subtotal_ves')::numeric;
    v_tax_rate := (v_item ->> 'tax_rate')::numeric;
    v_line_tax_ref := (v_item ->> 'tax_ref')::numeric;
    v_line_tax_ves := (v_item ->> 'tax_ves')::numeric;

    if v_unit_cost_ref is null or v_unit_cost_ves is null
       or v_line_subtotal_ref is null or v_line_subtotal_ves is null
       or v_tax_rate is null or v_line_tax_ref is null or v_line_tax_ves is null then
      raise exception using
        errcode = 'PT400',
        message = 'Cada item debe enviar costos/subtotales/impuesto en REF y VES';
    end if;

    if v_unit_cost_ref < 0 or v_unit_cost_ves < 0
       or v_line_subtotal_ref < 0 or v_line_subtotal_ves < 0
       or v_tax_rate < 0 or v_tax_rate > 100
       or v_line_tax_ref < 0 or v_line_tax_ves < 0 then
      raise exception using errcode = 'PT400', message = 'Montos invalidos en item de compra';
    end if;

    if v_entry_mode = 'pack' then
      v_pack_label := nullif(trim(v_item ->> 'pack_label'), '');
      v_pack_count := (v_item ->> 'pack_count')::integer;
      v_units_per_pack := (v_item ->> 'units_per_pack')::integer;
      v_pack_cost_ref := (v_item ->> 'pack_cost_ref')::numeric;
      v_pack_cost_ves := (v_item ->> 'pack_cost_ves')::numeric;

      if v_pack_label is null
         or v_pack_count is null or v_pack_count <= 0
         or v_units_per_pack is null or v_units_per_pack <= 0
         or v_pack_cost_ref is null or v_pack_cost_ves is null
         or v_pack_cost_ref < 0 or v_pack_cost_ves < 0 then
        raise exception using
          errcode = 'PT400',
          message = 'Item pack incompleto: requiere label, conteos y pack_cost REF+VES';
      end if;

      -- C13 — si el producto pertenece a un par empaque -> unidad activo, las
      -- unidades por empaque las fija el par, no el cliente.
      select c.units_per_pack into v_pair_units
      from public.product_pack_conversions c
      where c.unit_product_id = v_product_id
        and c.store_id = v_store_id
        and c.is_active = true;

      if found then
        -- El producto es la UNIDAD del par: entran pack_count x unidades del par.
        if v_units_per_pack <> v_pair_units then
          raise exception using
            errcode = 'PT400',
            message = format(
              'Las unidades por empaque enviadas (%s) no coinciden con la conversion registrada del producto (%s)',
              v_units_per_pack, v_pair_units
            );
        end if;

        v_quantity := v_pack_count * v_units_per_pack;
      else
        select c.units_per_pack into v_pair_units
        from public.product_pack_conversions c
        where c.pack_product_id = v_product_id
          and c.store_id = v_store_id
          and c.is_active = true;

        if found then
          if v_units_per_pack <> v_pair_units then
            raise exception using
              errcode = 'PT400',
              message = format(
                'Las unidades por empaque enviadas (%s) no coinciden con la conversion registrada del producto (%s)',
                v_units_per_pack, v_pair_units
              );
          end if;

          -- El producto ES el empaque: su stock se cuenta en empaques. Entran
          -- pack_count empaques al costo del empaque y la linea se guarda en
          -- modo unidad (quantity = empaques), que es lo que leen
          -- receive_purchase y la vista purchases_without_movements.
          v_quantity := v_pack_count;
          v_unit_cost_ref := v_pack_cost_ref;
          v_unit_cost_ves := v_pack_cost_ves;
          v_entry_mode := 'unit';
          v_pack_label := null;
          v_pack_count := null;
          v_units_per_pack := null;
          v_pack_cost_ref := null;
          v_pack_cost_ves := null;
        else
          v_quantity := v_pack_count * v_units_per_pack;
        end if;
      end if;
    else
      v_entry_mode := 'unit';
      v_pack_label := null;
      v_pack_count := null;
      v_units_per_pack := null;
      v_pack_cost_ref := null;
      v_pack_cost_ves := null;
      v_quantity := (v_item ->> 'quantity')::integer;

      if v_quantity is null or v_quantity <= 0 then
        raise exception using errcode = 'PT400', message = 'Cantidad invalida en item de compra';
      end if;
    end if;

    -- Costo unitario final del producto: neto + IVA de esta linea (0% = exento).
    v_cost_with_tax_ref := round(v_unit_cost_ref * (1 + coalesce(v_tax_rate, 0) / 100.0), 2);
    v_cost_with_tax_ves := round(v_unit_cost_ves * (1 + coalesce(v_tax_rate, 0) / 100.0), 2);

    select * into v_product
    from public.products
    where id = v_product_id
      and store_id = v_store_id
    for update;

    if not found then
      raise exception using
        errcode = 'PT404',
        message = format('Producto no encontrado: %s', v_product_id);
    end if;

    insert into public.purchase_items (
      purchase_id,
      product_id,
      quantity,
      unit_cost_ref,
      unit_cost_ves,
      subtotal_ref,
      subtotal_ves,
      entry_mode,
      pack_label,
      pack_count,
      units_per_pack,
      pack_cost_ref,
      pack_cost_ves,
      tax_rate,
      tax_ref,
      tax_ves,
      cost_currency
    )
    values (
      v_purchase.id,
      v_product_id,
      v_quantity,
      v_unit_cost_ref,
      v_unit_cost_ves,
      v_line_subtotal_ref,
      v_line_subtotal_ves,
      v_entry_mode,
      v_pack_label,
      v_pack_count,
      v_units_per_pack,
      v_pack_cost_ref,
      v_pack_cost_ves,
      v_tax_rate,
      v_line_tax_ref,
      v_line_tax_ves,
      v_cost_currency
    );

    if p_status = 'recibido' then
      update public.products
      set current_cost_ref = v_cost_with_tax_ref
      where id = v_product_id
        and store_id = v_store_id;

      get diagnostics v_rows = row_count;
      if v_rows <> 1 then
        raise exception using
          errcode = 'PT409',
          message = format('No se pudo actualizar el costo del producto %s', v_product_id);
      end if;

      select id, last_cost_ref, last_cost_ves
      into v_sp_id, v_old_cost_ref, v_old_cost_ves
      from public.supplier_products
      where supplier_id = p_supplier_id
        and product_id = v_product_id
        and store_id = v_store_id;

      insert into public.supplier_products (
        supplier_id,
        product_id,
        supplier_sku,
        last_cost_ref,
        last_cost_ves,
        last_purchased_at,
        store_id
      )
      values (
        p_supplier_id,
        v_product_id,
        v_supplier_sku,
        v_cost_with_tax_ref,
        v_cost_with_tax_ves,
        now(),
        v_store_id
      )
      on conflict (supplier_id, product_id)
      do update set
        supplier_sku = coalesce(excluded.supplier_sku, public.supplier_products.supplier_sku),
        last_cost_ref = excluded.last_cost_ref,
        last_cost_ves = excluded.last_cost_ves,
        last_purchased_at = excluded.last_purchased_at,
        is_active = true,
        updated_at = now()
      returning id into v_sp_id;

      perform public.append_supplier_product_price_history(
        v_sp_id,
        v_old_cost_ref,
        v_old_cost_ves,
        v_cost_with_tax_ref,
        v_cost_with_tax_ves,
        'compra',
        'Compra ' || v_purchase.purchase_number
      );

      -- Modo estricto: stock_after lo fija stock_movements_apply(), que tambien
      -- actualiza el stock del producto.
      insert into public.stock_movements (
        product_id,
        type,
        quantity_delta,
        purchase_id,
        reason,
        created_by,
        store_id
      )
      values (
        v_product_id,
        'compra',
        v_quantity,
        v_purchase.id,
        'Compra ' || v_purchase.purchase_number,
        auth.uid(),
        v_store_id
      );
    end if;
  end loop;

  v_total_ref := greatest(round(v_subtotal_ref - v_discount_ref + v_tax_ref, 2), 0);
  v_total_ves := greatest(round(v_subtotal_ves - v_discount_ves + v_tax_ves, 2), 0);

  update public.purchases
  set subtotal_ref = v_subtotal_ref,
      subtotal_ves = v_subtotal_ves,
      discount_ves = v_discount_ves,
      tax_ves = v_tax_ves,
      total_ref = v_total_ref,
      total_ves = v_total_ves
  where id = v_purchase.id
  returning * into v_purchase;

  return v_purchase;
exception
  -- R6 — tasa, costos, empaques x unidades o totales que no caben en sus columnas.
  when numeric_value_out_of_range then
    raise exception using
      errcode = 'PT400',
      message = 'Alguna cantidad o monto de la compra esta fuera del rango permitido';
  -- R6 — numero de compra repetido en la tienda. Cualquier otro choque sigue igual.
  when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'purchases_store_number_unique' then
      raise exception using
        errcode = 'PT409',
        message = format('Ya existe una compra con el numero %s', p_purchase_number);
    end if;
    raise;
end;
$$;

revoke all on function public.create_purchase(
  uuid, jsonb, uuid, numeric, numeric, numeric, text, text, public.purchase_status,
  numeric, numeric, numeric, numeric, uuid
) from public, anon;
grant execute on function public.create_purchase(
  uuid, jsonb, uuid, numeric, numeric, numeric, text, text, public.purchase_status,
  numeric, numeric, numeric, numeric, uuid
) to authenticated, service_role;

commit;

notify pgrst, 'reload schema';
