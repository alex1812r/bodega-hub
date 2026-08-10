-- =============================================================================
-- Ajuste one-shot: pago parcial de compra C-20260810155452483
--
-- Datos del pago (ayer):
--   amount_ves = 267425.99
--   tasa      = 756.7083
--   amount_ref = round(267425.99 / 756.7083, 2) = 353.41
--
-- Compra:
--   total_ves = 415699.29
--   total_ref = 549.35
--   paid_ref  = 353.41
--   pending_ref = 549.35 - 353.41 = 195.94
--
-- Ejecutar DESPUES de 20260810d-purchase-paid-ref.sql
-- =============================================================================

do $$
declare
  v_purchase_id uuid := 'd1c05299-b34e-4530-bd1a-e663323daefc';
  v_rate numeric(14,4) := 756.7083;
  v_amount_ves numeric(14,2) := 267425.99;
  v_amount_ref numeric(14,2) := round(v_amount_ves / v_rate, 2);
  v_payment_id uuid;
  v_total_ref numeric(14,2);
  v_paid_ref numeric(14,2);
begin
  select id into v_payment_id
  from public.payments
  where purchase_id = v_purchase_id
    and status = 'activo'
    and abs(amount_ves - v_amount_ves) < 0.02
  order by created_at desc
  limit 1;

  if v_payment_id is null then
    raise notice 'No se encontro pago activo de Bs. % en compra %', v_amount_ves, v_purchase_id;
    return;
  end if;

  update public.payments
  set amount_ref = v_amount_ref,
      ref_rate_ves = v_rate
  where id = v_payment_id;

  update public.purchases p
  set paid_ref = coalesce((
        select round(sum(pay.amount_ref), 2)
        from public.payments pay
        where pay.purchase_id = p.id
          and pay.status = 'activo'
      ), 0),
      paid_ves = coalesce((
        select round(sum(pay.amount_ves), 2)
        from public.payments pay
        where pay.purchase_id = p.id
          and pay.status = 'activo'
      ), 0)
  where p.id = v_purchase_id
  returning total_ref, paid_ref into v_total_ref, v_paid_ref;

  raise notice 'Pago % ajustado: amount_ref=% (tasa %). Compra paid_ref=% / total_ref=% / pending_ref=%',
    v_payment_id,
    v_amount_ref,
    v_rate,
    v_paid_ref,
    v_total_ref,
    round(v_total_ref - v_paid_ref, 2);
end;
$$;
