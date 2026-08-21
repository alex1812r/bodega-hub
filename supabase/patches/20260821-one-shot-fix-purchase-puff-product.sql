-- =============================================================================
-- 20260821 — One-shot: corregir producto en compra C-20260821230623761
-- Compra: 837e6237-fff1-41fa-b493-dadbed85da77
-- Linea:  d4594ec2-985a-44e2-8116-403395cc624e
--
-- Error: se cargo puff-mora-ques-25gr en vez de puff-azul-pimi-limo-25gr.
-- Montos, qty, IVA y totales de compra se conservan.
-- Ajusta: purchase_item, stock_movement, current_stock y supplier_products.
-- Idempotente si la linea ya apunta al SKU correcto.
-- =============================================================================

do $$
declare
  v_purchase_id uuid := '837e6237-fff1-41fa-b493-dadbed85da77';
  v_item_id uuid := 'd4594ec2-985a-44e2-8116-403395cc624e';
  v_movement_id uuid := '306f73bc-fdd4-4bb5-84c3-07e273ecc3c4';
  v_supplier_id uuid := 'ac280da9-17b7-47f9-b9a7-706969d29147';
  v_wrong_id uuid;
  v_right_id uuid;
  v_item public.purchase_items%rowtype;
  v_qty integer;
  v_wrong_stock integer;
  v_right_stock integer;
  v_cost_ref numeric(12,2);
  v_cost_ves numeric(14,2);
  v_pack_cost_ref numeric(12,2);
begin
  select id into v_wrong_id from public.products where sku = 'puff-mora-ques-25gr' limit 1;
  select id into v_right_id from public.products where sku = 'puff-azul-pimi-limo-25gr' limit 1;

  if v_wrong_id is null or v_right_id is null then
    raise exception 'No se encontraron ambos productos puff';
  end if;

  select * into v_item
  from public.purchase_items
  where id = v_item_id
    and purchase_id = v_purchase_id
  for update;

  if not found then
    raise exception 'Linea de compra % no encontrada', v_item_id;
  end if;

  -- Ya corregido
  if v_item.product_id = v_right_id then
    raise notice 'Linea ya apunta a puff-azul-pimi-limo-25gr; nada que hacer';
    return;
  end if;

  if v_item.product_id <> v_wrong_id then
    raise exception 'La linea no apunta a puff-mora-ques-25gr (product_id=%)', v_item.product_id;
  end if;

  v_qty := v_item.quantity;
  -- costo con IVA (como create_purchase)
  v_cost_ref := round(v_item.unit_cost_ref * (1 + coalesce(v_item.tax_rate, 0) / 100.0), 2);
  v_cost_ves := round(v_item.unit_cost_ves * (1 + coalesce(v_item.tax_rate, 0) / 100.0), 2);
  v_pack_cost_ref := v_item.pack_cost_ref;

  select current_stock into v_wrong_stock from public.products where id = v_wrong_id for update;
  select current_stock into v_right_stock from public.products where id = v_right_id for update;

  if v_wrong_stock < v_qty then
    raise exception 'Stock insuficiente en mora (%) para restar %', v_wrong_stock, v_qty;
  end if;

  update public.purchase_items
  set product_id = v_right_id
  where id = v_item_id;

  update public.stock_movements
  set
    product_id = v_right_id,
    stock_after = v_right_stock + v_qty
  where id = v_movement_id
    and purchase_id = v_purchase_id
    and product_id = v_wrong_id;

  if not found then
    raise exception 'Movimiento de stock % no encontrado o ya corregido', v_movement_id;
  end if;

  update public.products
  set
    current_stock = current_stock - v_qty,
    updated_at = now()
  where id = v_wrong_id;

  update public.products
  set
    current_stock = current_stock + v_qty,
    current_cost_ref = v_cost_ref,
    updated_at = now()
  where id = v_right_id;

  -- supplier_products del proveedor de esta compra
  update public.supplier_products
  set
    last_cost_ref = v_cost_ref,
    last_cost_ves = v_cost_ves,
    last_pack_cost_ref = v_pack_cost_ref,
    last_purchased_at = '2026-08-21T23:06:23.715141+00:00'::timestamptz,
    updated_at = now()
  where supplier_id = v_supplier_id
    and product_id = v_right_id
    and store_id = (select store_id from public.purchases where id = v_purchase_id);

  update public.supplier_products
  set
    last_cost_ref = null,
    last_cost_ves = null,
    last_pack_cost_ref = null,
    last_purchased_at = null,
    updated_at = now()
  where supplier_id = v_supplier_id
    and product_id = v_wrong_id
    and store_id = (select store_id from public.purchases where id = v_purchase_id)
    and last_purchased_at = '2026-08-21T23:06:23.715141+00:00'::timestamptz;

  raise notice 'OK: linea % reasignada a puff-azul-pimi-limo-25gr; stock mora -%, azul +%',
    v_item_id, v_qty, v_qty;
end;
$$;
