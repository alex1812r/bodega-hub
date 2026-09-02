-- =============================================================================
-- 20260828 — One-shot: corrige pago mixto venta V-20260828013116483
-- Error: todo anotado como efectivo_ves (Bs 1922.92).
-- Real: efectivo_usd $2 + efectivo_ves Bs 340.27 (resto $0.43 a tasa venta).
-- Idempotente: segundo pago con notes FIX_PAYMENT:V-20260828013116483:ves
-- =============================================================================

do $$
declare
  v_sale public.sales%rowtype;
  v_payment_usd public.payments%rowtype;
  v_payment_ves public.payments%rowtype;
  v_cash_mov public.cash_movements%rowtype;
  v_marker text := 'FIX_PAYMENT:V-20260828013116483';
  v_usd_ref numeric(14,2) := 2;
  v_usd_ves numeric(14,2);
  v_ves_amount numeric(14,2);
  v_ves_ref numeric(14,2);
begin
  select * into v_sale
  from public.sales
  where id = 'eed57e63-0513-463c-9271-deccfa0220e9'
  for update;
  if not found then raise exception 'Venta no encontrada'; end if;

  select * into v_payment_usd
  from public.payments
  where id = '142be927-82c6-4a27-b5f4-798ec1c28f80'
    and sale_id = v_sale.id
  for update;
  if not found then raise exception 'Pago original no encontrado'; end if;

  if exists (
    select 1 from public.payments
    where sale_id = v_sale.id
      and notes like v_marker || ':ves%'
      and status = 'activo'
  ) then
    raise notice 'Correccion % ya aplicada; no se repite.', v_marker;
    return;
  end if;

  v_usd_ves := round(v_usd_ref * v_sale.ref_rate_ves, 2);
  v_ves_amount := round(v_sale.total_ves - v_usd_ves, 2);
  v_ves_ref := round(v_ves_amount / v_sale.ref_rate_ves, 2);

  if round(v_usd_ves + v_ves_amount, 2) <> round(v_sale.total_ves, 2) then
    raise exception 'Montos no cuadran: usd_ves=% ves=% total=%',
      v_usd_ves, v_ves_amount, v_sale.total_ves;
  end if;

  update public.payments
  set method = 'efectivo_usd',
      currency = 'USD',
      amount = v_usd_ref,
      amount_ref = v_usd_ref,
      amount_ves = v_usd_ves,
      notes = v_marker || ' efectivo USD $2 (parte 1/2 pago mixto)'
  where id = v_payment_usd.id;

  update public.cash_movements
  set amount_ves = 0,
      amount_ref = v_usd_ref,
      notes = v_marker || ' Pago en efectivo USD de venta ($2 recibidos)'
  where payment_id = v_payment_usd.id;

  select * into v_cash_mov
  from public.cash_movements
  where payment_id = v_payment_usd.id;

  insert into public.payments (
    direction, sale_id, purchase_id, contact_id, method, currency,
    amount, amount_ves, amount_ref, ref_rate_ves,
    bank_name, phone, reference_code, notes, created_by, store_id, created_at
  ) values (
    'entrada',
    v_sale.id,
    null,
    v_sale.customer_id,
    'efectivo_ves',
    'VES',
    v_ves_amount,
    v_ves_amount,
    v_ves_ref,
    v_sale.ref_rate_ves,
    null,
    null,
    null,
    v_marker || ':ves efectivo VES Bs ' || v_ves_amount::text || ' (parte 2/2 pago mixto)',
    v_payment_usd.created_by,
    v_payment_usd.store_id,
    v_payment_usd.created_at
  )
  returning * into v_payment_ves;

  insert into public.cash_movements (
    store_id, session_id, type, amount_ves, amount_ref,
    payment_id, notes, created_by, created_at
  ) values (
    v_cash_mov.store_id,
    v_cash_mov.session_id,
    'sale_in',
    v_ves_amount,
    0,
    v_payment_ves.id,
    v_marker || ' Pago en efectivo VES de venta (resto $0.43)',
    v_cash_mov.created_by,
    v_cash_mov.created_at
  );

  update public.sales
  set paid_ves = v_sale.total_ves,
      status = 'pagada',
      updated_at = now()
  where id = v_sale.id;

  raise notice 'OK: venta % corregida a USD $2 + VES Bs %',
    v_sale.invoice_number, v_ves_amount;
end;
$$;
