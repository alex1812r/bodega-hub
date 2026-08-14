-- =============================================================================
-- 20260813f — One-shot: transferir 12 u de sham-sobr-head-shou-18ml
-- hacia variante sham-sobr-head-shou-suav-mane-ro (mismo precio/costo).
-- La variante ya existe; no desactiva el origen.
-- Idempotente si la variante ya tiene stock 12 y mismos costo/precio.
-- =============================================================================

do $$
declare
  v_source public.products%rowtype;
  v_variant public.products%rowtype;
  v_qty integer := 12;
  v_transfer integer;
  v_source_after integer;
  v_variant_after integer;
  v_sp public.supplier_products%rowtype;
begin
  select * into v_source
  from public.products
  where sku = 'sham-sobr-head-shou-18ml'
  for update;

  if not found then
    raise exception 'Producto sham-sobr-head-shou-18ml no encontrado';
  end if;

  select * into v_variant
  from public.products
  where sku = 'sham-sobr-head-shou-suav-mane-ro'
  for update;

  if not found then
    raise exception 'Variante sham-sobr-head-shou-suav-mane-ro no encontrada (crear primero en UI)';
  end if;

  if v_variant.current_stock = v_qty
     and v_variant.sale_price_ref = v_source.sale_price_ref
     and v_variant.current_cost_ref = v_source.current_cost_ref then
    raise notice 'Transferencia ya aplicada (variante stock=%, costo=%, precio=%). Nada que hacer.',
      v_variant.current_stock, v_variant.current_cost_ref, v_variant.sale_price_ref;
    return;
  end if;

  v_transfer := greatest(v_qty - coalesce(v_variant.current_stock, 0), 0);

  if v_transfer > 0 then
    if v_source.current_stock < v_transfer then
      raise exception
        'Stock insuficiente en origen: % (se necesitan %)',
        v_source.current_stock, v_transfer;
    end if;

    v_source_after := v_source.current_stock - v_transfer;
    v_variant_after := coalesce(v_variant.current_stock, 0) + v_transfer;

    insert into public.stock_movements (
      product_id, type, quantity_delta, stock_after, reason, store_id
    ) values (
      v_source.id,
      'ajuste_salida',
      -v_transfer,
      v_source_after,
      'Transferencia a sham-sobr-head-shou-suav-mane-ro: ' || v_transfer || ' u',
      v_source.store_id
    );

    insert into public.stock_movements (
      product_id, type, quantity_delta, stock_after, reason, store_id
    ) values (
      v_variant.id,
      'ajuste_entrada',
      v_transfer,
      v_variant_after,
      'Transferencia desde sham-sobr-head-shou-18ml: ' || v_transfer || ' u',
      v_variant.store_id
    );

    update public.products
    set current_stock = v_source_after,
        updated_at = now()
    where id = v_source.id;

    update public.products
    set current_stock = v_variant_after,
        sale_price_ref = v_source.sale_price_ref,
        current_cost_ref = v_source.current_cost_ref,
        min_stock = greatest(coalesce(min_stock, 0), coalesce(v_source.min_stock, 0)),
        category_id = v_source.category_id,
        updated_at = now()
    where id = v_variant.id;
  else
    update public.products
    set sale_price_ref = v_source.sale_price_ref,
        current_cost_ref = v_source.current_cost_ref,
        min_stock = greatest(coalesce(min_stock, 0), coalesce(v_source.min_stock, 0)),
        category_id = v_source.category_id,
        updated_at = now()
    where id = v_variant.id;
  end if;

  for v_sp in
    select *
    from public.supplier_products
    where product_id = v_source.id
      and store_id = v_source.store_id
      and is_active = true
  loop
    insert into public.supplier_products (
      supplier_id,
      product_id,
      supplier_sku,
      last_cost_ref,
      last_cost_ves,
      last_purchased_at,
      store_id,
      is_active
    )
    values (
      v_sp.supplier_id,
      v_variant.id,
      case
        when v_sp.supplier_sku is null or btrim(v_sp.supplier_sku) = '' then null
        else v_sp.supplier_sku || '-suav-mane-ro'
      end,
      v_source.current_cost_ref,
      v_sp.last_cost_ves,
      v_sp.last_purchased_at,
      v_sp.store_id,
      true
    )
    on conflict (supplier_id, product_id) do update
    set last_cost_ref = excluded.last_cost_ref,
        last_cost_ves = excluded.last_cost_ves,
        last_purchased_at = excluded.last_purchased_at,
        is_active = true,
        updated_at = now();
  end loop;

  select current_stock into v_source_after from public.products where id = v_source.id;
  select current_stock into v_variant_after from public.products where id = v_variant.id;

  raise notice
    'OK: origen stock % → %, variante stock %, costo_ref %, precio_ref %',
    v_source.current_stock,
    v_source_after,
    v_variant_after,
    v_source.current_cost_ref,
    v_source.sale_price_ref;
end;
$$;
