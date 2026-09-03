-- =============================================================================
-- 20260904 — Guardas de pagos (register_payment / cancel_payment)
-- Base: supabase/patches/20260903-pos-tender-and-change.sql
-- Especificación: docs/cobro-pos-billetes.md
-- Idempotente y re-ejecutable.
--
-- POR QUÉ
-- -------
-- El QA del cobro con billetes encontró seis huecos reales en los RPC de pago.
-- Todos se cierran aquí, sin tocar `open_cash_session`, `close_cash_session`,
-- `auto_close_stale_cash_sessions`, `transfer_cash_closures_to_vault`,
-- `create_sale` ni `cancel_sale`.
--
-- QUÉ HACE
-- --------
-- F1. El vuelto en efectivo ya no puede dejar la gaveta en negativo:
--     `register_payment` calcula el efectivo físico de la sesión con la MISMA
--     fórmula del cierre (`opening + Σ(sale_in|adjustment) −
--     Σ(transfer_out|refund_out|change_out)`, en Bs. y en REF) — incluyendo el
--     `sale_in` que esta misma transacción acaba de escribir, porque ese
--     efectivo ya está en la gaveta — y rechaza el `change_out` que la exceda.
-- F2. Una venta ya no se puede cobrar infinitas veces: sin saldo pendiente no
--     se acepta ningún pago, y con saldo el neto no puede superarlo más allá
--     del "redondeo a favor" que el propio POS genera con los billetes.
-- F3. Un pago de compra ya no puede superar el saldo pendiente de la factura
--     (era la vía para vaciar el baúl con un monto inventado).
-- F4. `cancel_payment` rechaza anular un pago cuyo cierre de caja ya fue
--     transferido al baúl: borrar sus `cash_movements` dejaría el
--     `theoretical_closing_*` guardado sin respaldo mientras el baúl conserva
--     el dinero. La corrección debe ser un ajuste explícito.
-- F5. Los desgloses de billetes dejan de ser decorativos: se valida moneda,
--     denominaciones reales, conteos enteros no negativos y que la suma cuadre
--     con el monto (`public.assert_payment_denominations`).
-- F6. Toda excepción deliberada de estos RPC lleva un SQLSTATE estable para que
--     la API la traduzca a 4xx en vez de 500 (ver convención abajo).
--
-- CONVENCIÓN DE SQLSTATE (F6)
-- ---------------------------
-- Clase `PT` (reservada para códigos definidos por el usuario; además PostgREST
-- interpreta `PTxyz` como el status HTTP `xyz`):
--
--   PT400  validación de negocio            → 400 BAD_REQUEST
--   PT402  saldo insuficiente en el baúl    → 400 INSUFFICIENT_VAULT_BALANCE
--   PT403  falta de permisos                → 403 FORBIDDEN
--   PT404  recurso inexistente              → 404 NOT_FOUND
--   PT409  conflicto de estado              → 409 CONFLICT
--
-- El mapeo vive en `src/modules/payments/services/payments.server.ts`
-- (`throwIfRpcError`), que sigue reconociendo por texto los mensajes de RPC de
-- otros módulos que todavía usan el `P0001` por defecto (p. ej. 'Contacto no
-- pertenece a tu tienda', que nace en `create_sale` / `create_purchase`).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Helper: validación de desgloses de billetes (F5)
--    Los billetes que circulan de verdad: USD 1/5/10/20/50/100, VES
--    10/20/50/100/200 (docs/cobro-pos-billetes.md §2).
-- -----------------------------------------------------------------------------

create or replace function public.assert_payment_denominations(
  p_denominations jsonb,
  p_currency text,
  p_expected_amount numeric,
  p_label text
) returns void
language plpgsql
set search_path = public
as $$
declare
  v_valid_bills numeric[];
  v_key text;
  v_bill_key text;
  v_bill numeric;
  v_count jsonb;
  v_count_num numeric;
  v_bills jsonb;
  v_sum numeric(14,2) := 0;
begin
  if p_denominations is null then
    return;
  end if;

  if jsonb_typeof(p_denominations) <> 'object' then
    raise exception 'El desglose de billetes % debe ser un objeto como {"%": {"20": 1}}',
      p_label, p_currency using errcode = 'PT400';
  end if;

  if p_currency = 'USD' then
    v_valid_bills := array[1, 5, 10, 20, 50, 100]::numeric[];
  else
    v_valid_bills := array[10, 20, 50, 100, 200]::numeric[];
  end if;

  -- (a) la moneda del desglose debe ser la del método.
  for v_key in select jsonb_object_keys(p_denominations) loop
    if v_key <> p_currency then
      raise exception 'El desglose de billetes % viene en % pero el monto es en %',
        p_label, v_key, p_currency using errcode = 'PT400';
    end if;
  end loop;

  v_bills := p_denominations -> p_currency;
  if v_bills is null or jsonb_typeof(v_bills) <> 'object' then
    raise exception 'El desglose de billetes % debe listar los billetes en %',
      p_label, p_currency using errcode = 'PT400';
  end if;

  for v_bill_key, v_count in select key, value from jsonb_each(v_bills) loop
    -- (b) la denominación debe existir de verdad.
    if v_bill_key !~ '^[0-9]+$' then
      raise exception 'Denominación inválida en el desglose de billetes %: "%"',
        p_label, v_bill_key using errcode = 'PT400';
    end if;
    v_bill := v_bill_key::numeric;
    if not (v_bill = any (v_valid_bills)) then
      raise exception 'No existe el billete de % en %: solo circulan %',
        v_bill, p_currency, array_to_string(v_valid_bills, ', ') using errcode = 'PT400';
    end if;

    -- (c) el conteo debe ser un entero no negativo.
    if jsonb_typeof(v_count) <> 'number' then
      raise exception 'El conteo del billete de % en el desglose % debe ser un número entero',
        v_bill, p_label using errcode = 'PT400';
    end if;
    v_count_num := v_count::numeric;
    if v_count_num < 0 or v_count_num <> trunc(v_count_num) then
      raise exception 'El conteo del billete de % en el desglose % debe ser un entero no negativo',
        v_bill, p_label using errcode = 'PT400';
    end if;

    v_sum := v_sum + v_bill * v_count_num;
  end loop;

  -- (d) la suma de los billetes debe ser exactamente el monto declarado.
  if round(v_sum, 2) <> round(coalesce(p_expected_amount, 0), 2) then
    raise exception 'El desglose de billetes % suma % % pero el monto declarado es % %',
      p_label, round(v_sum, 2), p_currency, round(coalesce(p_expected_amount, 0), 2), p_currency
      using errcode = 'PT400';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. register_payment — copia de 20260903 con las guardas F1, F2, F3, F5 y los
--    SQLSTATE de F6. Misma firma de 12 argumentos: `create or replace` basta.
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
    if public.current_user_role() not in ('admin', 'contador', 'vendedor') then
      raise exception 'No autorizado para registrar pagos de ventas' using errcode = 'PT403';
    end if;
    select * into v_sale from public.sales where id = p_sale_id and store_id = v_store_id for update;
    if not found then raise exception 'Venta no encontrada' using errcode = 'PT404'; end if;
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
    if public.current_user_role() not in ('admin', 'contador') then
      raise exception 'No autorizado para registrar pagos a proveedores' using errcode = 'PT403';
    end if;
    select * into v_purchase from public.purchases where id = p_purchase_id and store_id = v_store_id for update;
    if not found then raise exception 'Compra no encontrada' using errcode = 'PT404'; end if;
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

grant execute on function public.register_payment(
  uuid, uuid, public.payment_method, numeric, text, text, text, text,
  public.payment_method, numeric, jsonb, jsonb
) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. cancel_payment — copia de 20260903 con la guarda F4 y los SQLSTATE de F6.
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
    raise exception 'No autorizado para anular pagos' using errcode = 'PT403';
  end if;
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
