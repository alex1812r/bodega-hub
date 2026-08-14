-- =============================================================================
-- 20260813d — One-shot: split jabo-harm (Jabon Harmony) en 3 variantes
-- Stock 72 → 24+24+24. Mismo costo/precio. Desactiva el original.
-- Idempotente por SKU de variantes (jabo-harm-1|2|3).
-- Uso: Supabase Dashboard → SQL Editor → Run (o ya aplicado via script).
-- =============================================================================

do $$
declare
  v_source public.products%rowtype;
  v_variant_id uuid;
  v_i integer;
  v_sku text;
  v_name text;
  v_qty_each integer := 24;
  v_created integer := 0;
  v_sp public.supplier_products%rowtype;
begin
  select * into v_source
  from public.products
  where sku = 'jabo-harm'
  for update;

  if not found then
    raise exception 'Producto jabo-harm no encontrado';
  end if;

  if v_source.current_stock <> 72 and not exists (
    select 1 from public.products where sku in ('jabo-harm-1', 'jabo-harm-2', 'jabo-harm-3')
  ) then
    raise exception
      'Stock de jabo-harm es % (se esperaba 72 antes del split). Abortado.',
      v_source.current_stock;
  end if;

  -- Si ya existen las 3 variantes, solo asegurar stock/activo y salir limpio.
  if (
    select count(*) from public.products
    where sku in ('jabo-harm-1', 'jabo-harm-2', 'jabo-harm-3')
  ) = 3 then
    raise notice 'Variantes jabo-harm-1/2/3 ya existen; no se recrean.';
  else
    for v_i in 1..3 loop
      v_sku := 'jabo-harm-' || v_i::text;
      v_name := v_source.name || ' [' || v_i::text || ']';

      if exists (select 1 from public.products where store_id = v_source.store_id and sku = v_sku) then
        continue;
      end if;

      insert into public.products (
        store_id,
        category_id,
        sku,
        name,
        description,
        sale_price_ref,
        current_cost_ref,
        current_stock,
        min_stock,
        image_url,
        is_active,
        barcode
      )
      values (
        v_source.store_id,
        v_source.category_id,
        v_sku,
        v_name,
        v_source.description,
        v_source.sale_price_ref,
        v_source.current_cost_ref,
        v_qty_each,
        v_source.min_stock,
        null, -- cover ligado al id del producto; no reutilizar URL del original
        true,
        null  -- barcode unico: no copiar el del producto general
      )
      returning id into v_variant_id;

      insert into public.stock_movements (
        product_id,
        type,
        quantity_delta,
        stock_after,
        reason,
        store_id
      )
      values (
        v_variant_id,
        'ajuste_entrada',
        v_qty_each,
        v_qty_each,
        'Split desde jabo-harm: stock inicial variante [' || v_i::text || ']',
        v_source.store_id
      );

      -- Copiar vinculo proveedor si existe
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
          v_variant_id,
          case
            when v_sp.supplier_sku is null or btrim(v_sp.supplier_sku) = '' then null
            else v_sp.supplier_sku || '-' || v_i::text
          end,
          v_sp.last_cost_ref,
          v_sp.last_cost_ves,
          v_sp.last_purchased_at,
          v_sp.store_id,
          true
        )
        on conflict (supplier_id, product_id) do nothing;
      end loop;

      v_created := v_created + 1;
    end loop;
  end if;

  -- Vaciar y desactivar original
  if v_source.current_stock > 0 then
    insert into public.stock_movements (
      product_id,
      type,
      quantity_delta,
      stock_after,
      reason,
      store_id
    )
    values (
      v_source.id,
      'ajuste_salida',
      -v_source.current_stock,
      0,
      'Split a variantes jabo-harm-1/2/3: stock transferido (24 c/u)',
      v_source.store_id
    );
  end if;

  update public.products
  set current_stock = 0,
      is_active = false,
      updated_at = now()
  where id = v_source.id;

  -- Desactivar vinculos proveedor del producto general
  update public.supplier_products
  set is_active = false,
      updated_at = now()
  where product_id = v_source.id
    and is_active = true;

  raise notice
    'Split jabo-harm OK. Variantes creadas en este run=%. Original desactivado con stock 0.',
    v_created;
end;
$$;
