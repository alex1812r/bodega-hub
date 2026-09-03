-- =============================================================================
-- 20260903 — Cobro en POS con billetes reales y vuelto (tender & change)
-- Especificación: docs/cobro-pos-billetes.md
-- Idempotente y re-ejecutable.
--
-- POR QUÉ
-- -------
-- El POS asumía que el cliente entrega el total exacto. En la calle no existe:
-- el efectivo USD solo circula en billetes de 1/5/10/20/50/100 y el Bs. en
-- 10/20/50/100/200, así que una venta de $2,30 se cobra con $3 y se devuelve
-- vuelto (casi siempre en Bs., efectivo o pago móvil). Hoy el cajero anota un
-- método que no fue el real y el descuadre se corrige después a mano
-- (20260816-one-shot-fix-sale-usd-with-pm-change.sql,
--  20260828-one-shot-fix-sale-mixed-usd-ves-payment.sql).
--
-- QUÉ HACE
-- --------
-- 1. `payments` gana 6 columnas de vuelto (método, monto, equivalente en Bs.,
--    equivalente en USD y los desgloses de billetes recibidos/entregados) con
--    sus CHECK: vuelto solo en pagos de venta y nunca mayor a lo recibido en
--    esa línea.
-- 2. `cash_movements` admite el tipo `change_out` (salida física de la gaveta
--    por vuelto). `close_cash_session` y `auto_close_stale_cash_sessions` lo
--    RESTAN del teórico igual que `transfer_out` / `refund_out`.
-- 3. `register_payment` recibe 4 parámetros nuevos al final. Se elimina primero
--    la firma vieja de 8 argumentos para que PostgREST no vea un overload
--    ambiguo, y se re-otorga el grant con la firma nueva de 12.
--    - `sales.paid_ves` acumula el NETO (`amount_ves − change_ves`), no lo
--      recibido; el `status` se decide con ese neto.
--    - Vuelto en efectivo  → `cash_movements` `change_out` en la misma sesión.
--    - Vuelto bancario     → `cash_movements` `account_out` + `vault_movements`
--      `withdrawal` cubeta `cuenta` + `store_vaults.balance_ves -= change_ves`
--      (exactamente lo que hizo a mano el one-shot 20260816).
--    - Vuelto en efectivo USD no toca el baúl: es salida de gaveta en REF.
-- 4. `cancel_payment` revierte también los movimientos del vuelto, devuelve el
--    saldo de cuenta del baúl y descuenta de la venta el NETO.
--
-- NO HACE (pendiente en la app)
-- -----------------------------
-- `src/modules/cash/utils/cashSessionTotals.ts` debe restar `change_out` igual
-- que el RPC, y `POST /api/payments` debe aceptar `change` / `*Denominations`.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. payments — columnas y CHECK del vuelto
-- -----------------------------------------------------------------------------

alter table public.payments
  add column if not exists change_method public.payment_method,
  add column if not exists change_amount numeric(14,2) not null default 0,
  add column if not exists change_ves numeric(14,2) not null default 0,
  add column if not exists change_ref numeric(14,2) not null default 0,
  add column if not exists received_denominations jsonb,
  add column if not exists change_denominations jsonb;

alter table public.payments drop constraint if exists payments_change_amounts_check;
alter table public.payments
  add constraint payments_change_amounts_check
  check (change_amount >= 0 and change_ves >= 0 and change_ref >= 0);

-- change_method is null  ⇔  todos los montos de vuelto en cero.
-- change_ref solo puede ser distinto de cero si el vuelto se dio en efectivo USD.
alter table public.payments drop constraint if exists payments_change_method_coupling_check;
alter table public.payments
  add constraint payments_change_method_coupling_check
  check (
    (change_method is null and change_amount = 0 and change_ves = 0 and change_ref = 0)
    or (
      change_method is not null
      and change_amount > 0
      and change_ves > 0
      and (change_method = 'efectivo_usd' or change_ref = 0)
    )
  );

-- No se puede devolver más de lo recibido en esa línea de pago.
alter table public.payments drop constraint if exists payments_change_not_over_amount_check;
alter table public.payments
  add constraint payments_change_not_over_amount_check
  check (change_ves <= amount_ves);

-- El vuelto solo existe en pagos de venta.
alter table public.payments drop constraint if exists payments_change_sale_only_check;
alter table public.payments
  add constraint payments_change_sale_only_check
  check (change_method is null or sale_id is not null);

-- -----------------------------------------------------------------------------
-- 2. cash_movements — tipo nuevo change_out
-- -----------------------------------------------------------------------------

alter table public.cash_movements drop constraint if exists cash_movements_type_check;
alter table public.cash_movements
  add constraint cash_movements_type_check
  check (type in (
    'sale_in', 'transfer_out', 'opening', 'adjustment', 'refund_out',
    'account_in', 'account_out', 'change_out'
  ));

-- -----------------------------------------------------------------------------
-- 3. Cierre de caja — el teórico físico resta change_out
--    (copia de 20260819-cash-session-auto-close.sql con 'change_out' añadido)
-- -----------------------------------------------------------------------------

create or replace function public.close_cash_session(
  p_session_id uuid, p_closing_ves numeric, p_closing_ref numeric
) returns public.cash_sessions language plpgsql security definer set search_path = public as $$
declare v_store_id uuid; v_session public.cash_sessions; v_ves numeric(14,2); v_ref numeric(14,2);
begin
  v_store_id := public.assert_store_context();
  if p_closing_ves is null or p_closing_ref is null or p_closing_ves < 0 or p_closing_ref < 0 then
    raise exception 'Los montos de cierre deben ser válidos y no negativos';
  end if;
  select * into v_session from public.cash_sessions where id = p_session_id and store_id = v_store_id for update;
  if not found then raise exception 'Sesión de caja no encontrada'; end if;
  if v_session.status <> 'open' then raise exception 'La sesión de caja ya está cerrada'; end if;
  if public.current_user_role() <> 'admin' and v_session.opened_by is distinct from auth.uid() then
    raise exception 'Solo quien abrió la caja o un administrador puede cerrarla';
  end if;
  select round(v_session.opening_ves + coalesce(sum(case
           when type in ('sale_in', 'adjustment') then amount_ves
           when type in ('transfer_out', 'refund_out', 'change_out') then -amount_ves else 0 end), 0), 2),
         round(v_session.opening_ref + coalesce(sum(case
           when type in ('sale_in', 'adjustment') then amount_ref
           when type in ('transfer_out', 'refund_out', 'change_out') then -amount_ref else 0 end), 0), 2)
  into v_ves, v_ref
  from public.cash_movements where session_id = v_session.id;
  update public.cash_sessions set status = 'closed', closing_ves = round(p_closing_ves, 2),
    closing_ref = round(p_closing_ref, 2), theoretical_closing_ves = v_ves,
    theoretical_closing_ref = v_ref, closed_by = auth.uid(), closed_at = now(),
    closed_reason = 'manual'
  where id = v_session.id returning * into v_session;
  return v_session;
end;
$$;

create or replace function public.auto_close_stale_cash_sessions()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.cash_sessions;
  v_ves numeric(14,2);
  v_ref numeric(14,2);
  v_ids uuid[] := '{}';
  v_now timestamptz := now();
begin
  for v_session in
    select * from public.cash_sessions
    where status = 'open'
      and public.cash_session_deadline(opened_at) <= v_now
    for update
  loop
    select round(v_session.opening_ves + coalesce(sum(case
             when type in ('sale_in', 'adjustment') then amount_ves
             when type in ('transfer_out', 'refund_out', 'change_out') then -amount_ves else 0 end), 0), 2),
           round(v_session.opening_ref + coalesce(sum(case
             when type in ('sale_in', 'adjustment') then amount_ref
             when type in ('transfer_out', 'refund_out', 'change_out') then -amount_ref else 0 end), 0), 2)
    into v_ves, v_ref
    from public.cash_movements where session_id = v_session.id;

    update public.cash_sessions
    set status = 'closed',
        closing_ves = v_ves,
        closing_ref = v_ref,
        theoretical_closing_ves = v_ves,
        theoretical_closing_ref = v_ref,
        closed_by = v_session.opened_by,
        closed_at = v_now,
        closed_reason = public.cash_session_auto_close_reason(v_session.opened_at)
    where id = v_session.id;

    v_ids := array_append(v_ids, v_session.id);
  end loop;

  return jsonb_build_object(
    'closedCount', coalesce(cardinality(v_ids), 0),
    'sessionIds', to_jsonb(coalesce(v_ids, '{}'::uuid[]))
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. register_payment — firma nueva con vuelto
--    Se elimina primero la firma vieja de 8 argumentos: `create or replace` no
--    reemplaza una función con distinta cantidad de parámetros, la sobrecarga,
--    y PostgREST rechazaría la llamada por ambigüedad.
-- -----------------------------------------------------------------------------

drop function if exists public.register_payment(
  uuid, uuid, public.payment_method, numeric, text, text, text, text
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
begin
  v_store_id := public.assert_store_context();
  if p_amount is null or p_amount <= 0 then raise exception 'El monto del pago debe ser mayor a cero'; end if;
  if (p_sale_id is null and p_purchase_id is null) or (p_sale_id is not null and p_purchase_id is not null) then
    raise exception 'Debe asociar el pago a una venta o a una compra';
  end if;
  if p_method = 'pago_movil' then
    if p_bank_name is null or length(trim(p_bank_name)) = 0 then raise exception 'Pago Móvil requiere banco'; end if;
    if p_phone is null or length(trim(p_phone)) = 0 then raise exception 'Pago Móvil requiere teléfono'; end if;
    if p_reference_code is null or p_reference_code !~ '^[0-9]{4}$' then raise exception 'Pago Móvil requiere referencia de 4 dígitos'; end if;
  end if;
  if p_method = 'transferencia' then
    if p_bank_name is null or length(trim(p_bank_name)) = 0 then raise exception 'Transferencia requiere banco'; end if;
    if p_reference_code is null or length(trim(p_reference_code)) = 0 then raise exception 'Transferencia requiere número de transferencia'; end if;
  end if;

  -- Validación del vuelto (solo aplica a ventas).
  v_change_amount := round(coalesce(p_change_amount, 0), 2);
  if v_change_amount < 0 then
    raise exception 'El monto del vuelto no puede ser negativo';
  end if;
  if p_purchase_id is not null and (p_change_method is not null or v_change_amount > 0) then
    raise exception 'No se puede registrar vuelto en un pago de compra: el vuelto solo aplica a pagos de venta';
  end if;
  if v_change_amount > 0 and p_change_method is null then
    raise exception 'Debe indicar el método del vuelto';
  end if;
  if v_change_amount > 0 then
    v_change_method := p_change_method;
  else
    v_change_method := null;
  end if;
  v_change_is_bank := coalesce(v_change_method in ('pago_movil', 'transferencia', 'punto_venta'), false);

  v_is_bank := p_method in ('pago_movil', 'transferencia', 'punto_venta');

  if p_sale_id is not null then
    if public.current_user_role() not in ('admin', 'contador', 'vendedor') then
      raise exception 'No autorizado para registrar pagos de ventas';
    end if;
    select * into v_sale from public.sales where id = p_sale_id and store_id = v_store_id for update;
    if not found then raise exception 'Venta no encontrada'; end if;
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
        raise exception 'El monto del vuelto debe ser mayor a cero';
      end if;
      if v_change_ves > v_amount_ves then
        raise exception 'El vuelto (Bs %) no puede superar el monto recibido en esta línea (Bs %)',
          v_change_ves, v_amount_ves;
      end if;
    end if;

    -- A la venta se aplica el NETO recibido, no lo entregado por el cliente.
    v_net_ves := round(v_amount_ves - v_change_ves, 2);
    update public.sales set paid_ves = paid_ves + v_net_ves,
      status = case when paid_ves + v_net_ves >= total_ves then 'pagada'::public.sale_status else 'pendiente_pago'::public.sale_status end
    where id = p_sale_id returning paid_ves into v_paid_ves;
  else
    if public.current_user_role() not in ('admin', 'contador') then
      raise exception 'No autorizado para registrar pagos a proveedores';
    end if;
    select * into v_purchase from public.purchases where id = p_purchase_id and store_id = v_store_id for update;
    if not found then raise exception 'Compra no encontrada'; end if;
    v_direction := 'salida'; v_contact_id := v_purchase.supplier_id;
    select rate_ves into v_rate from public.exchange_rates where store_id = v_store_id order by created_at desc limit 1;
    if v_rate is null or v_rate <= 0 then v_rate := v_purchase.ref_rate_ves; end if;
    if p_method = 'efectivo_usd' then
      v_currency := 'USD'; v_amount_ref := round(p_amount, 2); v_amount_ves := round(p_amount * v_rate, 2);
    else
      v_currency := 'VES'; v_amount_ves := round(p_amount, 2); v_amount_ref := round(p_amount / v_rate, 2);
    end if;
    update public.purchases set paid_ves = paid_ves + v_amount_ves, paid_ref = paid_ref + v_amount_ref
    where id = p_purchase_id returning paid_ves, paid_ref into v_paid_ves, v_paid_ref;
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
      raise exception 'No puede registrar un pago en efectivo: no tiene una sesión de caja abierta en su caja asignada';
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
          greatest(v_movement_ves - v_vault.balance_efectivo_ves, 0);
      else
        raise exception 'Saldo insuficiente en el baul. Faltante REF: %',
          greatest(v_movement_ref - v_vault.balance_ref, 0);
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
      raise exception 'No puede registrar pago móvil/transferencia/punto: no hay sesión de caja abierta';
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
        greatest(v_payment.amount_ves - v_vault.balance_ves, 0);
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
      raise exception 'No puede registrar el vuelto: no hay sesión de caja abierta';
    end if;
    v_change_notes := coalesce(
      nullif(trim(p_notes), ''),
      'Vuelto de venta (' || v_change_method::text || ')'
    );

    if v_change_method in ('efectivo_ves', 'efectivo_usd') then
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
          greatest(v_change_ves - v_vault.balance_ves, 0);
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

grant execute on function public.register_payment(
  uuid, uuid, public.payment_method, numeric, text, text, text, text,
  public.payment_method, numeric, jsonb, jsonb
) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. cancel_payment — revierte también el vuelto
-- -----------------------------------------------------------------------------

create or replace function public.cancel_payment(p_payment_id uuid)
returns public.payments language plpgsql security definer set search_path = public as $$
declare
  v_store_id uuid; v_payment public.payments; v_sale public.sales; v_purchase public.purchases;
  v_vault public.store_vaults; v_vault_movement public.vault_movements;
  v_change_movement public.vault_movements;
  v_new_paid_ves numeric(14,2); v_new_paid_ref numeric(14,2);
  v_is_bank boolean; v_change_ves numeric(14,2); v_net_ves numeric(14,2);
begin
  v_store_id := public.assert_store_context();
  if public.current_user_role() not in ('admin', 'contador') then
    raise exception 'No autorizado para anular pagos';
  end if;
  select * into v_payment from public.payments where id = p_payment_id and store_id = v_store_id for update;
  if not found then raise exception 'Pago no encontrado'; end if;
  if v_payment.status = 'anulado' then raise exception 'El pago ya fue anulado'; end if;

  v_is_bank := v_payment.method in ('pago_movil', 'transferencia', 'punto_venta');
  v_change_ves := round(coalesce(v_payment.change_ves, 0), 2);
  -- A la venta se le aplicó el neto, así que se le devuelve el neto.
  v_net_ves := round(v_payment.amount_ves - v_change_ves, 2);

  if v_payment.sale_id is not null then
    select * into v_sale from public.sales where id = v_payment.sale_id and store_id = v_store_id for update;
    if not found then raise exception 'Venta no encontrada'; end if;
    if v_sale.status in ('cancelada', 'devuelta') then
      raise exception 'No se puede anular un pago de una venta cancelada o devuelta';
    end if;
    if v_sale.paid_ves < v_net_ves then
      raise exception 'El monto del pago excede lo registrado en la venta';
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
        if not found then raise exception 'Baúl no encontrado para revertir el vuelto'; end if;
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
        update public.store_vaults
        set balance_ves = greatest(balance_ves - v_vault_movement.amount_ves, 0)
        where id = v_vault.id;
        delete from public.vault_movements where id = v_vault_movement.id;
      end if;
    end if;
  else
    select * into v_purchase from public.purchases where id = v_payment.purchase_id and store_id = v_store_id for update;
    if not found then raise exception 'Compra no encontrada'; end if;
    if v_purchase.status in ('cancelado', 'devuelto') then
      raise exception 'No se puede anular un pago de una compra cancelada o devuelta';
    end if;
    if v_purchase.paid_ves < v_payment.amount_ves then
      raise exception 'El monto del pago excede lo registrado en la compra';
    end if;
    if coalesce(v_purchase.paid_ref, 0) < v_payment.amount_ref then
      raise exception 'El monto REF del pago excede lo registrado en la compra';
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
        if not found then raise exception 'Baúl no encontrado para revertir el pago en efectivo'; end if;
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

notify pgrst, 'reload schema';
