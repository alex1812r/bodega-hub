-- =============================================================================
-- 20260813e — One-shot: corrige line sham-sobr-head-shou en compra
-- C-20260810155452483 (d1c05299-b34e-4530-bd1a-e663323daefc)
--
-- Error: se registro 1 pack x 12, pero eran 3 packs x 12 (36 unidades)
-- con el MISMO costo total de linea (no triplicar el monto).
-- Efecto: bajar costo unitario/pack; conservar subtotal/IVA de linea;
-- stock +24 (12→36 recibidas).
--
-- Idempotente si qty=36 y unit_cost_ves ya refleja subtotal/36.
-- =============================================================================

do $$
declare
  v_purchase_id uuid := 'd1c05299-b34e-4530-bd1a-e663323daefc';
  v_product_id uuid;
  v_item_id uuid := '88ec7860-ae62-40e6-989c-5210dde985b3';
  v_purchase public.purchases%rowtype;
  v_item public.purchase_items%rowtype;
  v_rate numeric(14,4);
  v_pack_count integer := 3;
  v_units_per_pack integer := 12;
  v_quantity integer;
  -- Monto total ORIGINAL de la linea (no se incrementa)
  v_line_subtotal_ves numeric(14,2) := 8933.70;
  v_line_tax_ves numeric(14,2) := 1429.39;
  v_line_tax_ref numeric(14,2) := 1.89;
  v_pack_cost_ves numeric(14,2);
  v_pack_cost_ref numeric(12,2);
  v_unit_cost_ves numeric(14,2);
  v_unit_cost_ref numeric(12,2);
  v_tax_rate numeric(5,2);
  v_old_qty integer;
  v_sum_sub_ref numeric(14,2);
  v_sum_sub_ves numeric(14,2);
  v_sum_tax_ref numeric(14,2);
  v_sum_tax_ves numeric(14,2);
  v_total_ref numeric(14,2);
  v_total_ves numeric(14,2);
  v_stock integer;
begin
  select id into v_product_id
  from public.products
  where sku = 'sham-sobr-head-shou'
  limit 1;

  if v_product_id is null then
    raise exception 'Producto sham-sobr-head-shou no encontrado';
  end if;

  select * into v_purchase
  from public.purchases
  where id = v_purchase_id
  for update;

  if not found then
    raise exception 'Compra % no encontrada', v_purchase_id;
  end if;

  select * into v_item
  from public.purchase_items
  where id = v_item_id
  for update;

  if not found then
    raise exception 'Linea de compra % no encontrada', v_item_id;
  end if;

  if v_item.product_id <> v_product_id then
    raise exception 'La linea no corresponde a sham-sobr-head-shou';
  end if;

  v_rate := v_purchase.ref_rate_ves;
  if v_rate is null or v_rate <= 0 then
    raise exception 'Compra sin tasa ref_rate_ves valida';
  end if;

  v_tax_rate := coalesce(v_item.tax_rate, 0);
  v_old_qty := v_item.quantity;
  v_quantity := v_pack_count * v_units_per_pack;

  -- Mismo costo total repartido en 3 packs / 36 unidades
  v_pack_cost_ves := round(v_line_subtotal_ves / v_pack_count, 2);
  v_unit_cost_ves := round(v_line_subtotal_ves / v_quantity, 2);
  v_pack_cost_ref := round(v_pack_cost_ves / v_rate, 2);
  v_unit_cost_ref := round(v_unit_cost_ves / v_rate, 2);

  if v_item.pack_count = v_pack_count
     and v_item.quantity = v_quantity
     and v_item.unit_cost_ves = v_unit_cost_ves
     and v_item.subtotal_ves = v_line_subtotal_ves then
    raise notice 'Linea ya corregida (36 u, mismo costo total, unit_cost_ves=%). Nada que hacer.',
      v_unit_cost_ves;
    return;
  end if;

  update public.purchase_items
  set pack_count = v_pack_count,
      units_per_pack = v_units_per_pack,
      quantity = v_quantity,
      pack_cost_ves = v_pack_cost_ves,
      pack_cost_ref = v_pack_cost_ref,
      unit_cost_ves = v_unit_cost_ves,
      unit_cost_ref = v_unit_cost_ref,
      subtotal_ves = v_line_subtotal_ves,
      tax_ves = v_line_tax_ves,
      tax_ref = v_line_tax_ref
  where id = v_item_id;

  update public.stock_movements
  set quantity_delta = v_quantity,
      reason = 'Recepcion C-20260810155452483 [corrigido: 3 packs x 12, mismo costo total]'
  where purchase_id = v_purchase_id
    and product_id = v_product_id
    and type = 'compra';

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
      current_cost_ref = round(v_unit_cost_ref * (1 + v_tax_rate / 100.0), 2),
      updated_at = now()
  where id = v_product_id;

  select
    coalesce(sum(subtotal_ref), 0),
    coalesce(sum(subtotal_ves), 0),
    coalesce(sum(tax_ref), 0),
    coalesce(sum(tax_ves), 0)
  into v_sum_sub_ref, v_sum_sub_ves, v_sum_tax_ref, v_sum_tax_ves
  from public.purchase_items
  where purchase_id = v_purchase_id;

  v_total_ref := greatest(round(v_sum_sub_ref - coalesce(v_purchase.discount_ref, 0) + v_sum_tax_ref, 2), 0);
  v_total_ves := greatest(round(v_sum_sub_ves - coalesce(v_purchase.discount_ves, 0) + v_sum_tax_ves, 2), 0);

  update public.purchases
  set subtotal_ref = v_sum_sub_ref,
      subtotal_ves = v_sum_sub_ves,
      tax_ref = v_sum_tax_ref,
      tax_ves = v_sum_tax_ves,
      total_ref = v_total_ref,
      total_ves = v_total_ves,
      updated_at = now()
  where id = v_purchase_id;

  raise notice
    'Corrigido sham-sobr-head-shou: qty % → %, subtotal_ves (conservado) %, unit_cost_ves % → %, cost_con_iva_ref %, stock %, total compra REF % / VES %',
    v_old_qty,
    v_quantity,
    v_line_subtotal_ves,
    v_item.unit_cost_ves,
    v_unit_cost_ves,
    round(v_unit_cost_ref * (1 + v_tax_rate / 100.0), 2),
    v_stock,
    v_total_ref,
    v_total_ves;
end;
$$;
