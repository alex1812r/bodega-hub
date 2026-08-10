-- =============================================================================
-- 20260810d — saldo de compras en REF (paid_ref)
-- Idempotente
--
-- Problema: el pendiente de compra se calculaba solo en VES fijos (total_ves - paid_ves).
-- El proveedor cobra el restante en REF al tipo del día.
--
-- Solución:
--   - purchases.paid_ref acumula amount_ref de pagos activos
--   - register_payment / cancel_payment mantienen paid_ref
--   - en pagos a compra, la tasa de conversión VES→REF usa la tasa vigente del store
--     (o p_ref_rate_ves si se envía), no solo la tasa histórica de la compra
-- =============================================================================

alter table public.purchases
  add column if not exists paid_ref numeric(14,2) not null default 0
  check (paid_ref >= 0);

-- Backfill desde pagos activos (amount_ref ya persistido en cada pago)
update public.purchases p
set paid_ref = coalesce((
  select round(sum(pay.amount_ref), 2)
  from public.payments pay
  where pay.purchase_id = p.id
    and pay.status = 'activo'
), 0);

-- =============================================================================
-- register_payment (con paid_ref + tasa vigente en compras)
-- =============================================================================
create or replace function public.register_payment(
  p_sale_id uuid default null,
  p_purchase_id uuid default null,
  p_method public.payment_method default 'efectivo_ves',
  p_amount numeric default 0,
  p_bank_name text default null,
  p_phone text default null,
  p_reference_code text default null,
  p_notes text default null
)
returns public.payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_sale public.sales;
  v_purchase public.purchases;
  v_payment public.payments;
  v_direction public.payment_direction;
  v_contact_id uuid;
  v_rate numeric(14,4);
  v_currency public.payment_currency;
  v_amount_ves numeric(14,2);
  v_amount_ref numeric(14,2);
  v_paid_ves numeric(14,2);
  v_paid_ref numeric(14,2);
begin
  v_store_id := public.assert_store_context();

  if p_amount is null or p_amount <= 0 then
    raise exception 'El monto del pago debe ser mayor a cero';
  end if;

  if (p_sale_id is null and p_purchase_id is null) or (p_sale_id is not null and p_purchase_id is not null) then
    raise exception 'Debe asociar el pago a una venta o a una compra';
  end if;

  if p_method = 'pago_movil' then
    if p_bank_name is null or length(trim(p_bank_name)) = 0 then
      raise exception 'Pago Movil requiere banco';
    end if;

    if p_phone is null or length(trim(p_phone)) = 0 then
      raise exception 'Pago Movil requiere telefono';
    end if;

    if p_reference_code is null or p_reference_code !~ '^[0-9]{4}$' then
      raise exception 'Pago Movil requiere referencia de 4 digitos';
    end if;
  end if;

  if p_method = 'transferencia' then
    if p_bank_name is null or length(trim(p_bank_name)) = 0 then
      raise exception 'Transferencia requiere banco';
    end if;

    if p_reference_code is null or length(trim(p_reference_code)) = 0 then
      raise exception 'Transferencia requiere numero de transferencia';
    end if;
  end if;

  if p_sale_id is not null then
    if public.current_user_role() not in ('admin', 'contador', 'vendedor') then
      raise exception 'No autorizado para registrar pagos de ventas';
    end if;

    select * into v_sale
    from public.sales
    where id = p_sale_id
      and store_id = v_store_id
    for update;

    if not found then
      raise exception 'Venta no encontrada';
    end if;

    v_direction := 'entrada';
    v_contact_id := v_sale.customer_id;
    v_rate := v_sale.ref_rate_ves;

    if p_method = 'efectivo_usd' then
      v_currency := 'USD';
      v_amount_ref := round(p_amount, 2);
      v_amount_ves := round(p_amount * v_rate, 2);
    else
      v_currency := 'VES';
      v_amount_ves := round(p_amount, 2);
      v_amount_ref := round(p_amount / v_rate, 2);
    end if;

    update public.sales
    set paid_ves = paid_ves + v_amount_ves,
        status = case
          when paid_ves + v_amount_ves >= total_ves then 'pagada'::public.sale_status
          else 'pendiente_pago'::public.sale_status
        end
    where id = p_sale_id
    returning paid_ves into v_paid_ves;
  else
    if public.current_user_role() not in ('admin', 'contador') then
      raise exception 'No autorizado para registrar pagos a proveedores';
    end if;

    select * into v_purchase
    from public.purchases
    where id = p_purchase_id
      and store_id = v_store_id
    for update;

    if not found then
      raise exception 'Compra no encontrada';
    end if;

    v_direction := 'salida';
    v_contact_id := v_purchase.supplier_id;

    -- Tasa del dia (vigente del store); fallback a tasa de la compra
    select rate_ves into v_rate
    from public.exchange_rates
    where store_id = v_store_id
    order by created_at desc
    limit 1;

    if v_rate is null or v_rate <= 0 then
      v_rate := v_purchase.ref_rate_ves;
    end if;

    if p_method = 'efectivo_usd' then
      v_currency := 'USD';
      v_amount_ref := round(p_amount, 2);
      v_amount_ves := round(p_amount * v_rate, 2);
    else
      v_currency := 'VES';
      v_amount_ves := round(p_amount, 2);
      v_amount_ref := round(p_amount / v_rate, 2);
    end if;

    update public.purchases
    set paid_ves = paid_ves + v_amount_ves,
        paid_ref = paid_ref + v_amount_ref
    where id = p_purchase_id
    returning paid_ves, paid_ref into v_paid_ves, v_paid_ref;
  end if;

  insert into public.payments (
    direction,
    sale_id,
    purchase_id,
    contact_id,
    method,
    currency,
    amount,
    amount_ves,
    amount_ref,
    ref_rate_ves,
    bank_name,
    phone,
    reference_code,
    notes,
    created_by,
    store_id
  )
  values (
    v_direction,
    p_sale_id,
    p_purchase_id,
    v_contact_id,
    p_method,
    v_currency,
    p_amount,
    v_amount_ves,
    v_amount_ref,
    v_rate,
    nullif(trim(p_bank_name), ''),
    nullif(trim(p_phone), ''),
    p_reference_code,
    p_notes,
    auth.uid(),
    v_store_id
  )
  returning * into v_payment;

  return v_payment;
end;
$$;

-- =============================================================================
-- cancel_payment (revierte paid_ref en compras)
-- =============================================================================
create or replace function public.cancel_payment(p_payment_id uuid)
returns public.payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_payment public.payments;
  v_sale public.sales;
  v_purchase public.purchases;
  v_new_paid_ves numeric(14,2);
  v_new_paid_ref numeric(14,2);
begin
  v_store_id := public.assert_store_context();

  if public.current_user_role() not in ('admin', 'contador') then
    raise exception 'No autorizado para anular pagos';
  end if;

  select * into v_payment
  from public.payments
  where id = p_payment_id
    and store_id = v_store_id
  for update;

  if not found then
    raise exception 'Pago no encontrado';
  end if;

  if v_payment.status = 'anulado' then
    raise exception 'El pago ya fue anulado';
  end if;

  if v_payment.sale_id is not null then
    select * into v_sale
    from public.sales
    where id = v_payment.sale_id
      and store_id = v_store_id
    for update;

    if not found then
      raise exception 'Venta no encontrada';
    end if;

    if v_sale.status in ('cancelada', 'devuelta') then
      raise exception 'No se puede anular un pago de una venta cancelada o devuelta';
    end if;

    if v_sale.paid_ves < v_payment.amount_ves then
      raise exception 'El monto del pago excede lo registrado en la venta';
    end if;

    v_new_paid_ves := v_sale.paid_ves - v_payment.amount_ves;

    update public.sales
    set paid_ves = v_new_paid_ves,
        status = case
          when v_sale.status = 'borrador' then v_sale.status
          when v_new_paid_ves >= v_sale.total_ves then 'pagada'::public.sale_status
          else 'pendiente_pago'::public.sale_status
        end
    where id = v_payment.sale_id;
  else
    select * into v_purchase
    from public.purchases
    where id = v_payment.purchase_id
      and store_id = v_store_id
    for update;

    if not found then
      raise exception 'Compra no encontrada';
    end if;

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

    update public.purchases
    set paid_ves = v_new_paid_ves,
        paid_ref = v_new_paid_ref
    where id = v_payment.purchase_id;
  end if;

  update public.payments
  set status = 'anulado',
      cancelled_at = now(),
      cancelled_by = auth.uid()
  where id = p_payment_id
  returning * into v_payment;

  return v_payment;
end;
$$;

notify pgrst, 'reload schema';
