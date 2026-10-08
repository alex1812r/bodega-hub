-- =============================================================================
-- 20261008a — clave de idempotencia de register_payment (PAG-06a, P4-3)
-- Proyecto: BodegaHub (plan ux-mejoras, Ola 1, modulo Pagos)
-- Requiere: 20261006c-purchases-inventory-rpc-hardening.sql (stock_request_hash)
--           y 20261006h-rls-store-scope-and-finite-guards.sql (register_payment
--           vigente, assert_finite_numeric).
--
-- P4-3 (docs/stock-integrity.md): register_payment no tenia clave de
-- idempotencia; un reintento de POST /api/payments tras un corte de red creaba
-- un segundo pago con su asiento de caja / baul. Mismo patron que C6
-- (create_purchase):
--   * p_client_request_id uuid default null, unica por tienda
--     (payments.client_request_id + huella payments.client_request_hash).
--   * Misma tienda + misma clave + mismo contenido + mismo usuario -> devuelve
--     el pago original SIN insertar pago ni tocar documento, caja o baul.
--   * Misma clave con otro contenido, otro usuario o un pago ya anulado -> PT409.
--   * Dos peticiones simultaneas con la misma clave se serializan con un
--     advisory lock transaccional por (tienda, clave) tomado antes de leer
--     ningun saldo; el indice unico queda de respaldo.
--   * Sin clave: comportamiento identico al de 20261006h.
--
-- La semantica monetaria NO cambia: el cuerpo es copia literal del de 20261006h
-- y solo se anaden el parametro, el bloque del replay y las dos columnas del
-- insert. create_sale_with_payments la llama con argumentos por nombre y sin
-- clave: no se toca.
--
-- Firma nueva (13 argumentos): se elimina la de 12 para no dejar dos
-- sobrecargas vivas (PGRST203). Reaplicar 20261006b, c, f, g o h reinstala la
-- de 12: volver a aplicar este parche despues.
--
-- Idempotente, una sola transaccion. No migra ni toca filas existentes.
-- Ejecutar en SQL Editor o via db-up.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Esquema: clave y huella en payments
-- -----------------------------------------------------------------------------

alter table public.payments
  add column if not exists client_request_id uuid;

alter table public.payments
  add column if not exists client_request_hash text;

comment on column public.payments.client_request_id is
  'Clave de idempotencia enviada por el cliente al registrar el pago (unica por tienda).';
comment on column public.payments.client_request_hash is
  'Huella del contenido enviado con client_request_id. La misma clave con otra huella se rechaza.';

create unique index if not exists payments_store_client_request_unique
  on public.payments (store_id, client_request_id)
  where client_request_id is not null;

-- -----------------------------------------------------------------------------
-- 2. Funcion interna (no es RPC: sin execute para los roles de PostgREST)
-- -----------------------------------------------------------------------------

-- Pago ya registrado con esa clave en la tienda. NULL si no hay ninguno; el
-- pago si es un reintento legitimo; PT409 en cualquier otro caso.
create or replace function public.payment_idempotent_replay(
  p_store_id uuid,
  p_client_request_id uuid,
  p_client_request_hash text
)
returns public.payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.payments;
begin
  select * into v_payment
  from public.payments
  where store_id = p_store_id
    and client_request_id = p_client_request_id;

  if not found then
    return null;
  end if;

  if v_payment.client_request_hash is distinct from p_client_request_hash
     or v_payment.created_by is distinct from auth.uid()
     or v_payment.status = 'anulado' then
    raise exception using
      errcode = 'PT409',
      message = 'La clave de idempotencia ya se usó en otro pago. Revisa el pago registrado antes de reintentar.';
  end if;

  return v_payment;
end;
$$;

revoke all on function public.payment_idempotent_replay(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.payment_idempotent_replay(uuid, uuid, text) to service_role;

-- -----------------------------------------------------------------------------
-- 3. register_payment — copia de 20261006h + P4-3 (clave de idempotencia)
-- -----------------------------------------------------------------------------

drop function if exists public.register_payment(
  uuid, uuid, public.payment_method, numeric, text, text, text, text,
  public.payment_method, numeric, jsonb, jsonb
);

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
  p_change_denominations jsonb default null,
  p_client_request_id uuid default null
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
  v_request_hash text;
begin
  v_store_id := public.assert_store_context();
  -- N4 — NaN / Infinity no son menores que 0 y atravesaban las guardas de abajo.
  perform public.assert_finite_numeric(p_amount, 'el monto del pago');
  perform public.assert_finite_numeric(p_change_amount, 'el monto del vuelto');

  -- P4-3 — reintento del mismo envio. El advisory lock serializa dos peticiones
  -- simultaneas con la misma clave ANTES de leer ningun saldo: la segunda espera
  -- el commit de la primera y encuentra su pago (nunca llega al indice unico).
  -- Un replay devuelve el pago original sin tocar documento, caja ni baul.
  if p_client_request_id is not null then
    perform pg_advisory_xact_lock(
      hashtextextended('payment-request:' || v_store_id::text || ':' || p_client_request_id::text, 0)
    );

    v_request_hash := public.stock_request_hash(jsonb_build_array(
      'register_payment',
      p_sale_id,
      p_purchase_id,
      p_method,
      round(p_amount, 2)::text,
      nullif(trim(p_bank_name), ''),
      nullif(trim(p_phone), ''),
      p_reference_code,
      p_notes,
      case when round(coalesce(p_change_amount, 0), 2) > 0 then p_change_method end,
      round(coalesce(p_change_amount, 0), 2)::text,
      p_received_denominations,
      p_change_denominations
    ));
    v_payment := public.payment_idempotent_replay(v_store_id, p_client_request_id, v_request_hash);

    if v_payment.id is not null then
      return v_payment;
    end if;
  end if;

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
    received_denominations, change_denominations,
    client_request_id, client_request_hash
  ) values (
    v_direction, p_sale_id, p_purchase_id, v_contact_id, p_method, v_currency, p_amount, v_amount_ves, v_amount_ref,
    v_rate, nullif(trim(p_bank_name), ''), nullif(trim(p_phone), ''), p_reference_code, p_notes, auth.uid(), v_store_id,
    v_change_method, case when v_change_method is null then 0 else v_change_amount end, v_change_ves, v_change_ref,
    p_received_denominations, p_change_denominations,
    p_client_request_id, case when p_client_request_id is not null then v_request_hash end
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
  public.payment_method, numeric, jsonb, jsonb, uuid
) from public, anon;
grant execute on function public.register_payment(
  uuid, uuid, public.payment_method, numeric, text, text, text, text,
  public.payment_method, numeric, jsonb, jsonb, uuid
) to authenticated, service_role;

commit;

notify pgrst, 'reload schema';
