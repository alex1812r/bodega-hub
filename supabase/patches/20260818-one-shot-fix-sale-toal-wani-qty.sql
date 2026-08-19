-- =============================================================================
-- 20260818 — One-shot: corrige cantidad toal-wani-diar-10pc en venta
-- V-20260818172031032 (fe11ba2a-814c-404e-abe6-0e9f32d05fa7)
--
-- Error: qty registrada 2, debía ser 1 (solo ese producto en la venta).
-- Efecto: bajar linea y totales a la mitad; restock +1; ajustar pago efectivo_ves
-- y movimiento de caja.
--
-- Idempotente si qty=1, stock_movement=-1 y pago=541.32 VES.
-- =============================================================================

do $$
declare
  v_sale_id uuid := 'fe11ba2a-814c-404e-abe6-0e9f32d05fa7';
  v_item_id uuid := '19069887-bc0c-4ae6-aa31-887604353cb6';
  v_product_id uuid := 'a70febaf-9080-4a26-b7bc-5ffc648f5a98';
  v_stock_movement_id uuid := 'da2f66ca-47d9-42da-9112-3ea133504761';
  v_payment_id uuid := '2387124a-ecb8-4376-b8b9-6bb333a5dc70';
  v_cash_movement_id uuid := '5fd082cc-28f5-4c07-b6a0-8107f3e3ff31';
  v_marker text := 'FIX_SALE:V-20260818172031032';

  v_sale public.sales%rowtype;
  v_item public.sale_items%rowtype;
  v_payment public.payments%rowtype;
  v_rate numeric(14,4);
  v_new_qty integer := 1;
  v_unit_price_ref numeric(12,2);
  v_new_line_subtotal_ves numeric(14,2);
  v_new_subtotal_ref numeric(14,2);
  v_new_total_ref numeric(14,2);
  v_new_total_ves numeric(14,2);
  v_new_paid_ves numeric(14,2);
  v_new_amount_ref numeric(14,2);
  v_old_qty integer;
  v_old_total_ves numeric(14,2);
  v_stock integer;
begin
  select * into v_sale
  from public.sales
  where id = v_sale_id
  for update;

  if not found then
    raise exception 'Venta % no encontrada', v_sale_id;
  end if;

  select * into v_item
  from public.sale_items
  where id = v_item_id
    and sale_id = v_sale_id
    and product_id = v_product_id
  for update;

  if not found then
    raise exception 'Linea de venta no encontrada';
  end if;

  v_rate := v_sale.ref_rate_ves;
  if v_rate is null or v_rate <= 0 then
    raise exception 'Venta sin tasa ref_rate_ves valida';
  end if;

  v_unit_price_ref := v_item.unit_price_ref;
  v_old_qty := v_item.quantity;
  v_old_total_ves := v_sale.total_ves;

  v_new_line_subtotal_ves := round(v_new_qty::numeric * v_unit_price_ref * v_rate, 2);
  v_new_subtotal_ref := round(v_new_qty::numeric * v_unit_price_ref, 2);
  v_new_total_ref := greatest(
    round(v_new_subtotal_ref - coalesce(v_sale.discount_ref, 0) + coalesce(v_sale.tax_ref, 0), 2),
    0
  );
  v_new_total_ves := round(v_new_total_ref * v_rate, 2);
  v_new_amount_ref := round(v_new_total_ves / v_rate, 2);
  v_new_paid_ves := v_new_total_ves;

  if v_item.quantity = v_new_qty
     and v_sale.total_ves = v_new_total_ves
     and exists (
       select 1 from public.stock_movements
       where id = v_stock_movement_id
         and quantity_delta = -v_new_qty
     ) then
    raise notice 'Venta % ya corregida (qty=%, total_ves=%). Nada que hacer.',
      v_sale.invoice_number, v_new_qty, v_new_total_ves;
    return;
  end if;

  if v_item.quantity <> 2 then
    raise exception 'Cantidad actual inesperada: % (esperaba 2 antes del fix)', v_item.quantity;
  end if;

  update public.sale_items
  set quantity = v_new_qty,
      subtotal_ves = v_new_line_subtotal_ves
  where id = v_item_id;

  update public.stock_movements
  set quantity_delta = -v_new_qty,
      reason = v_marker || ' Venta ' || v_sale.invoice_number || ' [corregido qty 2→1]'
  where id = v_stock_movement_id
    and sale_id = v_sale_id
    and product_id = v_product_id
    and type = 'venta';

  update public.stock_movements sm
  set stock_after = sub.running
  from (
    select
      id,
      sum(quantity_delta) over (order by created_at asc, id asc) as running
    from public.stock_movements
    where product_id = v_product_id
  ) sub
  where sm.id = sub.id
    and sm.product_id = v_product_id;

  select coalesce(sum(quantity_delta), 0) into v_stock
  from public.stock_movements
  where product_id = v_product_id;

  update public.products
  set current_stock = v_stock,
      updated_at = now()
  where id = v_product_id;

  update public.sales
  set subtotal_ref = v_new_subtotal_ref,
      total_ref = v_new_total_ref,
      total_ves = v_new_total_ves,
      paid_ves = v_new_paid_ves,
      status = 'pagada',
      updated_at = now()
  where id = v_sale_id;

  select * into v_payment
  from public.payments
  where id = v_payment_id
    and sale_id = v_sale_id
  for update;

  if not found then
    raise exception 'Pago no encontrado';
  end if;

  if v_payment.method = 'efectivo_ves' then
    update public.payments
    set amount = v_new_total_ves,
        amount_ves = v_new_total_ves,
        amount_ref = v_new_amount_ref,
        notes = coalesce(v_payment.notes, '') ||
          case when v_payment.notes is null or btrim(v_payment.notes) = '' then '' else ' | ' end ||
          v_marker || ' monto corregido (qty 2→1)'
    where id = v_payment_id;

    update public.cash_movements
    set amount_ves = v_new_total_ves,
        notes = coalesce(notes, '') ||
          case when notes is null or btrim(notes) = '' then '' else ' | ' end ||
          v_marker || ' monto corregido (qty 2→1)'
    where id = v_cash_movement_id
      and payment_id = v_payment_id;
  else
    raise notice 'Pago method=%: revisar manualmente vault/caja si aplica', v_payment.method;
  end if;

  raise notice
    'OK %: linea qty %→%, subtotal_ves %→%, total_ves %→%, stock %, pago VES %→%',
    v_sale.invoice_number,
    v_old_qty,
    v_new_qty,
    v_item.subtotal_ves,
    v_new_line_subtotal_ves,
    v_old_total_ves,
    v_new_total_ves,
    v_stock,
    v_payment.amount_ves,
    v_new_total_ves;
end;
$$;
