-- =============================================================================
-- 20261006g — Correcciones de la revision de RPC, segunda tanda (STK-601)
-- Proyecto: BodegaHub (plan stock-integrity, fase 6)
-- Requiere: 20261006a, b, c, e y f; 20260705-supplier-product-pack-cost.sql;
--           20260811b-cash-registers-vault.sql
-- Origen: .notes/stock-integrity-gtm/rpc-review.md (R4, R7, R11, R12, R17) y las
--         tres RPC security definer sin filtro de tienda anteriores al plan.
--
-- Redefine completas, partiendo de su version vigente y con el cambio minimo:
--   adjust_stock (20261006c), cancel_payment_apply (20261006b), cancel_sale y
--   register_payment (20261006f), update_product_price (supabase-schema.sql),
--   register_supplier_product_price (20260705) y deactivate_supplier_product
--   (supabase-schema.sql). Ninguna firma cambia.
--
--   R4   adjust_stock rechaza (PT400) devolucion_cliente sin p_sale_id y
--        devolucion_proveedor sin p_purchase_id. Esos dos tipos dejan de existir
--        como ajuste libre: sin documento no habia tope y return_sale /
--        return_purchase no descontaban lo devuelto (unidades duplicadas con la
--        reconciliacion en 0). El camino ligado al documento no cambia.
--   tienda  update_product_price, register_supplier_product_price y
--        deactivate_supplier_product llaman a assert_store_context() en la
--        primera sentencia, filtran cada select / update por la tienda del
--        contexto y responden PT404 si la fila no es de esa tienda. Antes un
--        admin / almacen de cualquier tienda cambiaba precios o costos de otra,
--        y un token sin perfil pasaba la guarda de rol (null not in (…)).
--   R12  get_open_cash_session_for_user y append_supplier_product_price_history
--        dejan de ser ejecutables por /rpc (solo las llaman otras RPC security
--        definer). assert_contact_type NO se revoca: el BFF la llama con la sesion
--        del usuario (src/lib/supabase/contacts.ts).
--   R7   cancel_payment_apply comprueba que encontro el baul (PT404) antes de
--        tocar el saldo y borrar el asiento en las dos ramas bancarias.
--   R11  stock_movements es solo-append tambien para las funciones security
--        definer: triggers before update / delete / truncate que lanzan PT409
--        salvo en una conexion directa (session_user postgres o supabase_admin).
--   R17  cancel_sale y register_payment rechazan (PT409) la venta en borrador,
--        con la misma guarda de estado de return_sale.
--
-- Idempotente, una sola transaccion. Ejecutar en SQL Editor o via db-up.
-- Reaplicar 20261006b, c o f reinstala las versiones anteriores de esas RPC:
-- volver a aplicar este parche despues.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. adjust_stock — copia de 20261006c + R4 (la devolucion exige su documento)
--    Misma firma de 7 argumentos.
-- -----------------------------------------------------------------------------

create or replace function public.adjust_stock(
  p_product_id uuid,
  p_quantity_delta integer,
  p_reason text default null,
  p_type public.stock_movement_type default null,
  p_client_request_id uuid default null,
  p_sale_id uuid default null,
  p_purchase_id uuid default null
)
returns public.stock_movements
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_product public.products;
  v_type public.stock_movement_type;
  v_movement public.stock_movements;
  v_sale public.sales;
  v_purchase public.purchases;
  v_document_quantity integer;
  v_already_returned integer;
  v_request_hash text;
  v_replay jsonb;
begin
  v_store_id := public.assert_store_context();

  if coalesce(public.current_user_role()::text, '') not in ('admin', 'almacen') then
    raise exception using errcode = 'PT403', message = 'No autorizado para ajustar stock';
  end if;

  -- C6 — reintento del mismo ajuste: se devuelve el movimiento original.
  if p_client_request_id is not null then
    perform pg_advisory_xact_lock(
      hashtextextended('stock-request:' || v_store_id::text || ':' || p_client_request_id::text, 0)
    );

    v_request_hash := public.stock_request_hash(jsonb_build_array(
      'adjust_stock', p_product_id, p_quantity_delta, p_reason, p_type, p_sale_id, p_purchase_id
    ));
    v_replay := public.stock_request_replay(v_store_id, p_client_request_id, 'adjust_stock', v_request_hash);

    if v_replay is not null then
      v_movement := jsonb_populate_record(null::public.stock_movements, v_replay);
      return v_movement;
    end if;
  end if;

  if p_quantity_delta is null or p_quantity_delta = 0 then
    raise exception using errcode = 'PT400', message = 'El ajuste de stock no puede ser cero';
  end if;

  v_type := coalesce(
    p_type,
    case
      when p_quantity_delta > 0 then 'ajuste_entrada'::public.stock_movement_type
      else 'ajuste_salida'::public.stock_movement_type
    end
  );

  if v_type in ('venta', 'compra', 'conversion_entrada', 'conversion_salida') then
    raise exception using
      errcode = 'PT400',
      message = 'Use create_sale, create_purchase o convert_pack_to_units para este tipo de movimiento';
  end if;

  if v_type in ('ajuste_salida', 'devolucion_proveedor') and p_quantity_delta > 0 then
    raise exception using
      errcode = 'PT400',
      message = 'ajuste_salida / devolucion_proveedor requiere quantity_delta negativo';
  end if;

  if v_type in ('ajuste_entrada', 'devolucion_cliente', 'inventario_inicial')
     and p_quantity_delta < 0 then
    raise exception using errcode = 'PT400', message = 'Este tipo de ajuste requiere quantity_delta positivo';
  end if;

  -- C15 — el documento solo acompana a su devolucion.
  if p_sale_id is not null and v_type <> 'devolucion_cliente' then
    raise exception using
      errcode = 'PT400',
      message = 'Solo una devolucion de cliente puede ligarse a una venta';
  end if;

  if p_purchase_id is not null and v_type <> 'devolucion_proveedor' then
    raise exception using
      errcode = 'PT400',
      message = 'Solo una devolucion a proveedor puede ligarse a una compra';
  end if;

  -- R4 — y la devolucion no existe sin su documento: sin el no hay tope (vendido /
  -- recibido menos ya devuelto) y return_sale / return_purchase no la descuentan,
  -- asi que las unidades se duplicaban con la reconciliacion en 0. La devolucion
  -- suelta deja de existir como ajuste libre.
  if v_type = 'devolucion_cliente' and p_sale_id is null then
    raise exception using
      errcode = 'PT400',
      message = 'Una devolucion de cliente debe indicar la venta a la que corresponde';
  end if;

  if v_type = 'devolucion_proveedor' and p_purchase_id is null then
    raise exception using
      errcode = 'PT400',
      message = 'Una devolucion a proveedor debe indicar la compra a la que corresponde';
  end if;

  -- Orden de bloqueo: documento -> producto.
  if p_sale_id is not null then
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

    if v_sale.status not in ('pagada', 'pendiente_pago') then
      raise exception using
        errcode = 'PT409',
        message = 'Solo se pueden devolver ventas pagadas o pendientes de pago';
    end if;
  end if;

  if p_purchase_id is not null then
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

    if v_purchase.status <> 'recibido' then
      raise exception using errcode = 'PT409', message = 'Solo se pueden devolver compras recibidas';
    end if;
  end if;

  select * into v_product
  from public.products
  where id = p_product_id
    and store_id = v_store_id
  for update;

  if not found then
    raise exception using errcode = 'PT404', message = 'Producto no encontrado';
  end if;

  -- C15 — tope: lo vendido (o recibido) de ese producto en el documento menos
  -- lo ya devuelto con movimientos ligados a el.
  if p_sale_id is not null then
    select coalesce(sum(quantity), 0)::integer
    into v_document_quantity
    from public.sale_items
    where sale_id = p_sale_id
      and product_id = p_product_id;

    if v_document_quantity = 0 then
      raise exception using errcode = 'PT400', message = 'El producto no pertenece a la venta indicada';
    end if;

    select coalesce(sum(quantity_delta), 0)::integer
    into v_already_returned
    from public.stock_movements
    where sale_id = p_sale_id
      and product_id = p_product_id
      and type = 'devolucion_cliente';

    if p_quantity_delta > v_document_quantity - v_already_returned then
      raise exception using
        errcode = 'PT409',
        message = format(
          'La devolucion supera lo vendido en la venta %s: vendido %s, ya devuelto %s',
          v_sale.invoice_number, v_document_quantity, v_already_returned
        );
    end if;
  end if;

  if p_purchase_id is not null then
    select coalesce(sum(quantity), 0)::integer
    into v_document_quantity
    from public.purchase_items
    where purchase_id = p_purchase_id
      and product_id = p_product_id;

    if v_document_quantity = 0 then
      raise exception using errcode = 'PT400', message = 'El producto no pertenece a la compra indicada';
    end if;

    select coalesce(-sum(quantity_delta), 0)::integer
    into v_already_returned
    from public.stock_movements
    where purchase_id = p_purchase_id
      and product_id = p_product_id
      and type = 'devolucion_proveedor';

    if -p_quantity_delta > v_document_quantity - v_already_returned then
      raise exception using
        errcode = 'PT409',
        message = format(
          'La devolucion supera lo recibido en la compra %s: recibido %s, ya devuelto %s',
          v_purchase.purchase_number, v_document_quantity, v_already_returned
        );
    end if;
  end if;

  if v_product.current_stock + p_quantity_delta < 0 then
    raise exception using errcode = 'PT409', message = 'Stock insuficiente';
  end if;

  -- Modo estricto: stock_after lo fija stock_movements_apply(), que tambien
  -- actualiza el stock del producto.
  insert into public.stock_movements (
    product_id,
    type,
    quantity_delta,
    sale_id,
    purchase_id,
    reason,
    created_by,
    store_id
  )
  values (
    p_product_id,
    v_type,
    p_quantity_delta,
    p_sale_id,
    p_purchase_id,
    p_reason,
    auth.uid(),
    v_store_id
  )
  returning * into v_movement;

  if p_client_request_id is not null then
    insert into public.stock_request_keys (
      store_id, client_request_id, operation, request_hash, user_id, result
    )
    values (
      v_store_id, p_client_request_id, 'adjust_stock', v_request_hash, auth.uid(), to_jsonb(v_movement)
    );
  end if;

  return v_movement;
end;
$$;

revoke all on function public.adjust_stock(
  uuid, integer, text, public.stock_movement_type, uuid, uuid, uuid
) from public, anon;
grant execute on function public.adjust_stock(
  uuid, integer, text, public.stock_movement_type, uuid, uuid, uuid
) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. update_product_price — copia de supabase-schema.sql + contexto de tienda
-- -----------------------------------------------------------------------------

create or replace function public.update_product_price(
  p_product_id uuid,
  p_new_sale_price_ref numeric,
  p_reason text default null
)
returns public.products
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_product public.products;
  v_old_price numeric(12,2);
begin
  v_store_id := public.assert_store_context();

  if public.current_user_role() not in ('admin', 'almacen') then
    raise exception 'No autorizado para cambiar precios';
  end if;

  if p_new_sale_price_ref < 0 then
    raise exception 'El precio no puede ser negativo';
  end if;

  select * into v_product
  from public.products
  where id = p_product_id
    and store_id = v_store_id
  for update;

  if not found then
    raise exception using errcode = 'PT404', message = 'Producto no encontrado';
  end if;

  v_old_price := v_product.sale_price_ref;

  update public.products
  set sale_price_ref = p_new_sale_price_ref
  where id = p_product_id
    and store_id = v_store_id
  returning * into v_product;

  if not found then
    raise exception using errcode = 'PT404', message = 'Producto no encontrado';
  end if;

  insert into public.product_price_history (
    product_id,
    old_sale_price_ref,
    new_sale_price_ref,
    reason,
    changed_by
  )
  values (
    p_product_id,
    v_old_price,
    p_new_sale_price_ref,
    p_reason,
    auth.uid()
  );

  return v_product;
end;
$$;

revoke all on function public.update_product_price(uuid, numeric, text) from public, anon;
grant execute on function public.update_product_price(uuid, numeric, text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. register_supplier_product_price — copia de 20260705 + contexto de tienda.
--    Misma firma de 7 argumentos.
-- -----------------------------------------------------------------------------

create or replace function public.register_supplier_product_price(
  p_supplier_product_id uuid,
  p_new_cost_ref numeric,
  p_new_cost_ves numeric,
  p_origin text,
  p_notes text default null,
  p_new_pack_cost_ref numeric default null,
  p_price_input_mode text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_sp public.supplier_products;
  v_old_cost_ref numeric(12,2);
  v_old_cost_ves numeric(14,2);
  v_variation_percent numeric(8,2);
  v_history_id uuid;
begin
  v_store_id := public.assert_store_context();

  if public.current_user_role() not in ('admin', 'almacen') then
    raise exception 'No autorizado para registrar precios de proveedor';
  end if;

  if p_new_cost_ref is null or p_new_cost_ref < 0 then
    raise exception 'El costo no puede ser negativo';
  end if;

  if p_origin not in ('cotizacion', 'compra', 'ajuste', 'vinculacion') then
    raise exception 'Origen de precio invalido';
  end if;

  if p_price_input_mode is not null and p_price_input_mode not in ('unit', 'pack') then
    raise exception 'Modo de precio invalido';
  end if;

  if p_price_input_mode = 'pack' and (p_new_pack_cost_ref is null or p_new_pack_cost_ref < 0) then
    raise exception 'Indica un precio de empaque valido';
  end if;

  select * into v_sp
  from public.supplier_products
  where id = p_supplier_product_id
    and store_id = v_store_id
  for update;

  if not found then
    raise exception using errcode = 'PT404', message = 'Relacion proveedor-producto no encontrada';
  end if;

  if not v_sp.is_active then
    raise exception 'No se puede registrar precio en una relacion inactiva';
  end if;

  v_old_cost_ref := v_sp.last_cost_ref;
  v_old_cost_ves := v_sp.last_cost_ves;

  v_history_id := public.append_supplier_product_price_history(
    p_supplier_product_id,
    v_old_cost_ref,
    v_old_cost_ves,
    p_new_cost_ref,
    p_new_cost_ves,
    p_origin,
    p_notes
  );

  update public.supplier_products
  set last_cost_ref = p_new_cost_ref,
      last_cost_ves = p_new_cost_ves,
      last_pack_cost_ref = case
        when p_price_input_mode = 'pack' then p_new_pack_cost_ref
        when p_price_input_mode = 'unit' then null
        else last_pack_cost_ref
      end,
      last_purchased_at = case when p_origin = 'compra' then now() else last_purchased_at end,
      updated_at = now()
  where id = p_supplier_product_id
    and store_id = v_store_id
  returning * into v_sp;

  if not found then
    raise exception using errcode = 'PT404', message = 'Relacion proveedor-producto no encontrada';
  end if;

  if v_old_cost_ref is not null and v_old_cost_ref > 0 then
    v_variation_percent := round(((p_new_cost_ref - v_old_cost_ref) / v_old_cost_ref) * 100, 2);
  else
    v_variation_percent := null;
  end if;

  return jsonb_build_object(
    'supplier_product', to_jsonb(v_sp),
    'variation_percent', v_variation_percent,
    'history_id', v_history_id
  );
end;
$$;

revoke all on function public.register_supplier_product_price(uuid, numeric, numeric, text, text, numeric, text)
  from public, anon;
grant execute on function public.register_supplier_product_price(uuid, numeric, numeric, text, text, numeric, text)
  to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. deactivate_supplier_product — copia de supabase-schema.sql + contexto de tienda
-- -----------------------------------------------------------------------------

create or replace function public.deactivate_supplier_product(p_id uuid)
returns public.supplier_products
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_sp public.supplier_products;
begin
  v_store_id := public.assert_store_context();

  if public.current_user_role() not in ('admin', 'almacen') then
    raise exception 'No autorizado para desactivar relaciones proveedor-producto';
  end if;

  update public.supplier_products
  set is_active = false,
      updated_at = now()
  where id = p_id
    and store_id = v_store_id
  returning * into v_sp;

  if not found then
    raise exception using errcode = 'PT404', message = 'Relacion proveedor-producto no encontrada';
  end if;

  return v_sp;
end;
$$;

revoke all on function public.deactivate_supplier_product(uuid) from public, anon;
grant execute on function public.deactivate_supplier_product(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 5. R12 — funciones internas sin execute por PostgREST. Las RPC security
--    definer (register_payment; create_purchase, receive_purchase y
--    register_supplier_product_price) las siguen llamando como propietario.
--    assert_contact_type queda como esta: el BFF la llama por /rpc con la sesion
--    del usuario (src/lib/supabase/contacts.ts).
-- -----------------------------------------------------------------------------

-- Devolvia la sesion de caja (montos de apertura) de cualquier tienda.
revoke all on function public.get_open_cash_session_for_user(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_open_cash_session_for_user(uuid, uuid) to service_role;

-- Insertaba historial de costos de cualquier relacion con un responsable arbitrario.
revoke all on function public.append_supplier_product_price_history(
  uuid, numeric, numeric, numeric, numeric, text, text, uuid
) from public, anon, authenticated;
grant execute on function public.append_supplier_product_price_history(
  uuid, numeric, numeric, numeric, numeric, text, text, uuid
) to service_role;

-- -----------------------------------------------------------------------------
-- 6. cancel_payment_apply — copia de 20261006b + R7 (if not found tras bloquear
--    el baul en las dos ramas bancarias). El greatest(…, 0) NO se toca: es logica
--    de caja (docs/cuadre-baul.md). Sigue sin execute por /rpc.
-- -----------------------------------------------------------------------------

create or replace function public.cancel_payment_apply(p_payment_id uuid)
returns public.payments language plpgsql security definer set search_path = public as $$
declare
  v_store_id uuid; v_payment public.payments; v_sale public.sales; v_purchase public.purchases;
  v_vault public.store_vaults; v_vault_movement public.vault_movements;
  v_change_movement public.vault_movements;
  v_new_paid_ves numeric(14,2); v_new_paid_ref numeric(14,2);
  v_is_bank boolean; v_change_ves numeric(14,2); v_net_ves numeric(14,2);
begin
  v_store_id := public.assert_store_context();
  -- Orden de bloqueo venta -> pago, el mismo de register_payment y return_sale.
  perform 1 from public.sales s
  where s.store_id = v_store_id
    and s.id = (select p.sale_id from public.payments p where p.id = p_payment_id and p.store_id = v_store_id)
  for update;
  select * into v_payment from public.payments where id = p_payment_id and store_id = v_store_id for update;
  if not found then raise exception 'Pago no encontrado' using errcode = 'PT404'; end if;
  if v_payment.status = 'anulado' then
    raise exception 'El pago ya fue anulado' using errcode = 'PT409';
  end if;

  -- F4 — si el cierre de esa sesión ya viajó al baúl, borrar sus movimientos
  -- dejaría el `theoretical_closing_*` guardado sin respaldo mientras el baúl
  -- conserva el dinero: el descuadre saldría en el próximo arqueo.
  if exists (
    select 1
    from public.cash_movements m
    join public.cash_sessions s on s.id = m.session_id
    where m.payment_id = v_payment.id
      and m.store_id = v_store_id
      and s.status = 'closed'
      and s.vault_transferred_at is not null
  ) then
    raise exception 'No se puede anular este pago: su cierre de caja ya fue transferido al baúl. Registre un ajuste explícito de caja o baúl para corregirlo'
      using errcode = 'PT409';
  end if;

  v_is_bank := v_payment.method in ('pago_movil', 'transferencia', 'punto_venta');
  v_change_ves := round(coalesce(v_payment.change_ves, 0), 2);
  -- A la venta se le aplicó el neto, así que se le devuelve el neto.
  v_net_ves := round(v_payment.amount_ves - v_change_ves, 2);

  if v_payment.sale_id is not null then
    select * into v_sale from public.sales where id = v_payment.sale_id and store_id = v_store_id for update;
    if not found then raise exception 'Venta no encontrada' using errcode = 'PT404'; end if;
    if v_sale.status in ('cancelada', 'devuelta') then
      raise exception 'No se puede anular un pago de una venta cancelada o devuelta' using errcode = 'PT409';
    end if;
    if v_sale.paid_ves < v_net_ves then
      raise exception 'El monto del pago excede lo registrado en la venta' using errcode = 'PT400';
    end if;
    v_new_paid_ves := v_sale.paid_ves - v_net_ves;
    update public.sales set paid_ves = v_new_paid_ves, status = case
      when v_sale.status = 'borrador' then v_sale.status
      when v_new_paid_ves >= v_sale.total_ves then 'pagada'::public.sale_status
      else 'pendiente_pago'::public.sale_status end where id = v_payment.sale_id;

    -- Vuelto entregado por cuenta bancaria: devolver el saldo al baúl (cubeta cuenta).
    if v_change_ves > 0 and v_payment.change_method in ('pago_movil', 'transferencia', 'punto_venta') then
      select * into v_change_movement from public.vault_movements
      where payment_id = v_payment.id and store_id = v_store_id and type = 'withdrawal' for update;
      if found then
        select * into v_vault from public.store_vaults
        where id = v_change_movement.vault_id and store_id = v_store_id for update;
        if not found then raise exception 'Baúl no encontrado para revertir el vuelto' using errcode = 'PT404'; end if;
        update public.store_vaults
        set balance_ves = balance_ves + v_change_movement.amount_ves
        where id = v_vault.id;
        delete from public.vault_movements where id = v_change_movement.id;
      end if;
    end if;

    -- Borra el sale_in / account_in y, si lo hubo, el change_out / account_out del vuelto.
    if v_payment.method in ('efectivo_ves', 'efectivo_usd') then
      delete from public.cash_movements where payment_id = v_payment.id and store_id = v_store_id;
    elsif v_is_bank then
      delete from public.cash_movements where payment_id = v_payment.id and store_id = v_store_id;
      select * into v_vault_movement from public.vault_movements
      where payment_id = v_payment.id and store_id = v_store_id and type = 'sale_in' for update;
      if found then
        select * into v_vault from public.store_vaults
        where id = v_vault_movement.vault_id and store_id = v_store_id for update;
        -- R7 — sin baul el update no tocaba nada y el asiento se borraba igual.
        if not found then raise exception 'Baúl no encontrado para revertir el cobro en cuenta' using errcode = 'PT404'; end if;
        update public.store_vaults
        set balance_ves = greatest(balance_ves - v_vault_movement.amount_ves, 0)
        where id = v_vault.id;
        delete from public.vault_movements where id = v_vault_movement.id;
      end if;
    end if;
  else
    select * into v_purchase from public.purchases where id = v_payment.purchase_id and store_id = v_store_id for update;
    if not found then raise exception 'Compra no encontrada' using errcode = 'PT404'; end if;
    if v_purchase.status in ('cancelado', 'devuelto') then
      raise exception 'No se puede anular un pago de una compra cancelada o devuelta' using errcode = 'PT409';
    end if;
    if v_purchase.paid_ves < v_payment.amount_ves then
      raise exception 'El monto del pago excede lo registrado en la compra' using errcode = 'PT400';
    end if;
    if coalesce(v_purchase.paid_ref, 0) < v_payment.amount_ref then
      raise exception 'El monto REF del pago excede lo registrado en la compra' using errcode = 'PT400';
    end if;
    v_new_paid_ves := v_purchase.paid_ves - v_payment.amount_ves;
    v_new_paid_ref := greatest(round(coalesce(v_purchase.paid_ref, 0) - v_payment.amount_ref, 2), 0);
    update public.purchases set paid_ves = v_new_paid_ves, paid_ref = v_new_paid_ref where id = v_payment.purchase_id;

    if v_payment.method in ('efectivo_ves', 'efectivo_usd') then
      select * into v_vault_movement from public.vault_movements
      where payment_id = v_payment.id and store_id = v_store_id and type = 'purchase_out' for update;
      if found then
        select * into v_vault from public.store_vaults
        where id = v_vault_movement.vault_id and store_id = v_store_id for update;
        if not found then raise exception 'Baúl no encontrado para revertir el pago en efectivo' using errcode = 'PT404'; end if;
        update public.store_vaults
        set balance_efectivo_ves = balance_efectivo_ves + v_vault_movement.amount_ves,
            balance_ref = balance_ref + v_vault_movement.amount_ref
        where id = v_vault.id;
        delete from public.vault_movements where id = v_vault_movement.id;
      end if;
    elsif v_is_bank then
      select * into v_vault_movement from public.vault_movements
      where payment_id = v_payment.id and store_id = v_store_id and type = 'purchase_out' for update;
      if found then
        select * into v_vault from public.store_vaults
        where id = v_vault_movement.vault_id and store_id = v_store_id for update;
        -- R7 — sin baul el update no tocaba nada y el asiento se borraba igual.
        if not found then raise exception 'Baúl no encontrado para revertir el pago desde cuenta' using errcode = 'PT404'; end if;
        update public.store_vaults
        set balance_ves = balance_ves + v_vault_movement.amount_ves
        where id = v_vault.id;
        delete from public.vault_movements where id = v_vault_movement.id;
      end if;
    end if;
  end if;

  update public.payments set status = 'anulado', cancelled_at = now(), cancelled_by = auth.uid()
  where id = p_payment_id returning * into v_payment;
  return v_payment;
end;
$$;

revoke all on function public.cancel_payment_apply(uuid) from public, anon, authenticated;
grant execute on function public.cancel_payment_apply(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 7. cancel_sale — copia de 20261006f + R17 (rechaza la venta en borrador)
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

  -- R17 — solo se cancela una venta viva (la misma guarda de return_sale): un
  -- borrador nunca desconto stock y cancelarlo lo "reponia".
  if v_sale.status not in ('pagada', 'pendiente_pago') then
    raise exception using
      errcode = 'PT409',
      message = 'Solo se pueden cancelar ventas pagadas o pendientes de pago';
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
-- 8. register_payment — copia de 20261006f + R17 (rechaza la venta en borrador).
--    Misma firma de 12 argumentos. Nada mas cambia (caja y baul intactos).
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
    -- R17 — ni un borrador (la misma guarda de return_sale): el cobro lo pasaba a
    -- pendiente_pago / pagada sin que su stock hubiera salido nunca.
    if v_sale.status not in ('pagada', 'pendiente_pago') then
      raise exception 'No se puede registrar un pago en una venta en borrador' using errcode = 'PT409';
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
-- 9. R11 — stock_movements solo-append tambien por trigger.
--    Hasta aqui eran solo grants (20261006a): una funcion security definer
--    (propietario postgres) podia reescribir quantity_delta / stock_after o
--    borrar filas. Ninguna funcion de public lo hace hoy (check en
--    verify-patches). Pasa unicamente:
--      * una conexion directa a la base (session_user postgres o supabase_admin:
--        migraciones, one-shots, seed y limpieza de tests), igual que en
--        products_stock_guard; por PostgREST session_user es "authenticator";
--      * el update que solo suelta el vinculo con una venta, una compra o un
--        usuario borrados (FK on delete set null de sale_id, purchase_id y
--        created_by): no toca cantidades ni saldos, y bloquearlo impediria borrar
--        un usuario con historial desde Auth (session_user supabase_auth_admin).
--        Las vistas de integridad siguen marcando el movimiento sin documento.
-- -----------------------------------------------------------------------------

create or replace function public.stock_movements_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if session_user in ('postgres', 'supabase_admin') then
    if tg_op = 'UPDATE' then
      return new;
    elsif tg_op = 'DELETE' then
      return old;
    end if;
    return null; -- TRUNCATE (trigger de sentencia)
  end if;

  if tg_op = 'UPDATE' then
    if (to_jsonb(new) - array['sale_id', 'purchase_id', 'created_by'])
         = (to_jsonb(old) - array['sale_id', 'purchase_id', 'created_by'])
       and (new.sale_id is null or new.sale_id is not distinct from old.sale_id)
       and (new.purchase_id is null or new.purchase_id is not distinct from old.purchase_id)
       and (new.created_by is null or new.created_by is not distinct from old.created_by) then
      return new;
    end if;
  end if;

  raise exception using
    errcode = 'PT409',
    message = 'Los movimientos de inventario no se modifican ni se borran: registra un movimiento de ajuste';
end;
$$;

-- Los triggers se disparan sin privilegio de EXECUTE; nadie debe llamarla a mano.
revoke all on function public.stock_movements_append_only() from public, anon, authenticated;

drop trigger if exists trg_stock_movements_append_only on public.stock_movements;
create trigger trg_stock_movements_append_only
  before update or delete on public.stock_movements
  for each row execute function public.stock_movements_append_only();

drop trigger if exists trg_stock_movements_no_truncate on public.stock_movements;
create trigger trg_stock_movements_no_truncate
  before truncate on public.stock_movements
  for each statement execute function public.stock_movements_append_only();

commit;

notify pgrst, 'reload schema';
