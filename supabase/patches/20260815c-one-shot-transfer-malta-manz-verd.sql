-- =============================================================================
-- 20260815c — One-shot: transferir mitad stock mal-port-175-lt
-- hacia variante mal-port-manz-verd-1-75lt (mismo precio/costo).
-- Stock origen 12 → 6+6. No desactiva el origen.
-- Idempotente si la variante ya tiene stock 6 y mismos costo/precio.
-- =============================================================================

do $$
declare
  v_source public.products%rowtype;
  v_variant public.products%rowtype;
  v_qty integer;
  v_transfer integer;
  v_source_after integer;
  v_variant_after integer;
  v_sp public.supplier_products%rowtype;
begin
  select * into v_source
  from public.products
  where sku = 'mal-port-175-lt'
  for update;

  if not found then
    raise exception 'Producto mal-port-175-lt no encontrado';
  end if;

  select * into v_variant
  from public.products
  where sku = 'mal-port-manz-verd-1-75lt'
  for update;

  if not found then
    raise exception 'Variante mal-port-manz-verd-1-75lt no encontrada (crear primero en UI)';
  end if;

  v_qty := floor(v_source.current_stock / 2.0)::integer;

  -- Si ya se transfirio, el origen queda en 6 y la variante en 6
  if v_variant.current_stock = 6
     and v_source.current_stock = 6
     and v_variant.sale_price_ref = v_source.sale_price_ref
     and v_variant.current_cost_ref = v_source.current_cost_ref then
    raise notice 'Transferencia ya aplicada (6+6). Nada que hacer.';
    return;
  end if;

  if v_qty <= 0 and v_variant.current_stock = 0 then
    raise exception 'Stock origen insuficiente para transferir mitad: %', v_source.current_stock;
  end if;

  -- Si origen ya bajó, transferir solo lo que falte en variante para llegar a 6
  if v_variant.current_stock >= 6 then
    v_transfer := 0;
  elsif v_source.current_stock = 12 then
    v_transfer := 6;
  else
    v_transfer := greatest(6 - coalesce(v_variant.current_stock, 0), 0);
    if v_transfer > v_source.current_stock then
      raise exception 'Stock insuficiente en origen: % (se necesitan %)', v_source.current_stock, v_transfer;
    end if;
  end if;

  if v_transfer > 0 then
    v_source_after := v_source.current_stock - v_transfer;
    v_variant_after := coalesce(v_variant.current_stock, 0) + v_transfer;

    insert into public.stock_movements (
      product_id, type, quantity_delta, stock_after, reason, store_id
    ) values (
      v_source.id, 'ajuste_salida', -v_transfer, v_source_after,
      'Transferencia a mal-port-manz-verd-1-75lt: ' || v_transfer || ' u (mitad stock)',
      v_source.store_id
    );

    insert into public.stock_movements (
      product_id, type, quantity_delta, stock_after, reason, store_id
    ) values (
      v_variant.id, 'ajuste_entrada', v_transfer, v_variant_after,
      'Transferencia desde mal-port-175-lt: ' || v_transfer || ' u (mitad stock)',
      v_variant.store_id
    );

    update public.products
    set current_stock = v_source_after, updated_at = now()
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
    select * from public.supplier_products
    where product_id = v_source.id
      and store_id = v_source.store_id
      and is_active = true
  loop
    insert into public.supplier_products (
      supplier_id, product_id, supplier_sku, last_cost_ref, last_cost_ves,
      last_purchased_at, store_id, is_active
    ) values (
      v_sp.supplier_id,
      v_variant.id,
      case
        when v_sp.supplier_sku is null or btrim(v_sp.supplier_sku) = '' then null
        else v_sp.supplier_sku || '-manz-verd'
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
    'OK malta: origen stock % → %, variante stock %, costo_ref %, precio_ref %',
    v_source.current_stock, v_source_after, v_variant_after,
    v_source.current_cost_ref, v_source.sale_price_ref;
end;
$$;
