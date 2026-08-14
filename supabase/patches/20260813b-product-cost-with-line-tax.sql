-- =============================================================================
-- 20260813b — Al comprar/recibir, products.current_cost_ref = unitario CON IVA
-- de la linea (tax_rate de la factura). Si tax_rate = 0 (exento), queda el neto.
-- No usa IVA de categoria. Requiere 20260810c. Idempotente.
-- =============================================================================

drop function if exists public.create_purchase(
  uuid, jsonb, uuid, numeric, numeric, numeric, text, text, public.purchase_status
);

drop function if exists public.create_purchase(
  uuid, jsonb, uuid, numeric, numeric, numeric, text, text, public.purchase_status,
  numeric, numeric, numeric
);

create or replace function public.create_purchase(
  p_supplier_id uuid,
  p_items jsonb,
  p_exchange_rate_id uuid default null,
  p_ref_rate_ves numeric default null,
  p_discount_ref numeric default 0,
  p_tax_ref numeric default 0,
  p_notes text default null,
  p_purchase_number text default null,
  p_status public.purchase_status default 'recibido',
  p_discount_ves numeric default null,
  p_tax_ves numeric default null,
  p_subtotal_ves numeric default null,
  p_subtotal_ref numeric default null
)
returns public.purchases
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_rate numeric(14,4);
  v_purchase public.purchases;
  v_item jsonb;
  v_product public.products;
  v_product_id uuid;
  v_quantity integer;
  v_unit_cost_ref numeric(12,2);
  v_unit_cost_ves numeric(14,2);
  v_cost_with_tax_ref numeric(12,2);
  v_cost_with_tax_ves numeric(14,2);
  v_line_subtotal_ref numeric(14,2);
  v_line_subtotal_ves numeric(14,2);
  v_discount_ref numeric(14,2);
  v_discount_ves numeric(14,2);
  v_tax_ref numeric(14,2);
  v_tax_ves numeric(14,2);
  v_subtotal_ref numeric(14,2);
  v_subtotal_ves numeric(14,2);
  v_total_ref numeric(14,2);
  v_total_ves numeric(14,2);
  v_stock_after integer;
  v_supplier_sku text;
  v_sp_id uuid;
  v_old_cost_ref numeric(12,2);
  v_old_cost_ves numeric(14,2);
  v_entry_mode text;
  v_pack_label text;
  v_pack_count integer;
  v_units_per_pack integer;
  v_pack_cost_ref numeric(12,2);
  v_pack_cost_ves numeric(14,2);
  v_tax_rate numeric(5,2);
  v_line_tax_ref numeric(14,2);
  v_line_tax_ves numeric(14,2);
  v_cost_currency text;
begin
  v_store_id := public.assert_store_context();

  if public.current_user_role() not in ('admin', 'almacen') then
    raise exception 'No autorizado para crear compras';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La compra debe tener al menos un item';
  end if;

  if p_exchange_rate_id is not null then
    select rate_ves into v_rate
    from public.exchange_rates
    where id = p_exchange_rate_id
      and store_id = v_store_id;
  else
    v_rate := p_ref_rate_ves;
  end if;

  if v_rate is null or v_rate <= 0 then
    raise exception 'Debe indicar una tasa ref/VES valida';
  end if;

  if p_status not in ('pedido', 'recibido') then
    raise exception 'Solo se puede crear una compra en estado pedido o recibido';
  end if;

  if p_discount_ves is null or p_tax_ves is null or p_subtotal_ves is null or p_subtotal_ref is null then
    raise exception 'Debe enviar subtotal/descuento/impuesto en REF y VES desde el cliente';
  end if;

  v_discount_ref := coalesce(p_discount_ref, 0);
  v_discount_ves := p_discount_ves;
  v_tax_ref := coalesce(p_tax_ref, 0);
  v_tax_ves := p_tax_ves;
  v_subtotal_ref := p_subtotal_ref;
  v_subtotal_ves := p_subtotal_ves;

  if v_discount_ref < 0 or v_discount_ves < 0 or v_tax_ref < 0 or v_tax_ves < 0
     or v_subtotal_ref < 0 or v_subtotal_ves < 0 then
    raise exception 'Totales de compra invalidos';
  end if;

  perform public.assert_contact_type(p_supplier_id, array['proveedor', 'ambos']::public.contact_type[]);

  if not exists (
    select 1
    from public.contacts
    where id = p_supplier_id
      and store_id = v_store_id
  ) then
    raise exception 'Contacto no pertenece a tu tienda';
  end if;

  insert into public.purchases (
    purchase_number,
    supplier_id,
    user_id,
    exchange_rate_id,
    ref_rate_ves,
    discount_ref,
    tax_ref,
    status,
    notes,
    store_id
  )
  values (
    coalesce(p_purchase_number, 'C-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS')),
    p_supplier_id,
    auth.uid(),
    p_exchange_rate_id,
    v_rate,
    v_discount_ref,
    v_tax_ref,
    p_status,
    p_notes,
    v_store_id
  )
  returning * into v_purchase;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_product_id := (v_item ->> 'product_id')::uuid;
    v_supplier_sku := v_item ->> 'supplier_sku';
    v_entry_mode := coalesce(nullif(trim(v_item ->> 'entry_mode'), ''), 'unit');
    v_cost_currency := coalesce(nullif(trim(v_item ->> 'cost_currency'), ''), 'ves');

    if v_cost_currency not in ('ves', 'ref') then
      raise exception 'cost_currency invalido en item de compra';
    end if;

    v_unit_cost_ref := (v_item ->> 'unit_cost_ref')::numeric;
    v_unit_cost_ves := (v_item ->> 'unit_cost_ves')::numeric;
    v_line_subtotal_ref := (v_item ->> 'subtotal_ref')::numeric;
    v_line_subtotal_ves := (v_item ->> 'subtotal_ves')::numeric;
    v_tax_rate := (v_item ->> 'tax_rate')::numeric;
    v_line_tax_ref := (v_item ->> 'tax_ref')::numeric;
    v_line_tax_ves := (v_item ->> 'tax_ves')::numeric;

    if v_unit_cost_ref is null or v_unit_cost_ves is null
       or v_line_subtotal_ref is null or v_line_subtotal_ves is null
       or v_tax_rate is null or v_line_tax_ref is null or v_line_tax_ves is null then
      raise exception 'Cada item debe enviar costos/subtotales/impuesto en REF y VES';
    end if;

    if v_unit_cost_ref < 0 or v_unit_cost_ves < 0
       or v_line_subtotal_ref < 0 or v_line_subtotal_ves < 0
       or v_tax_rate < 0 or v_tax_rate > 100
       or v_line_tax_ref < 0 or v_line_tax_ves < 0 then
      raise exception 'Montos invalidos en item de compra';
    end if;

    if v_entry_mode = 'pack' then
      v_pack_label := nullif(trim(v_item ->> 'pack_label'), '');
      v_pack_count := (v_item ->> 'pack_count')::integer;
      v_units_per_pack := (v_item ->> 'units_per_pack')::integer;
      v_pack_cost_ref := (v_item ->> 'pack_cost_ref')::numeric;
      v_pack_cost_ves := (v_item ->> 'pack_cost_ves')::numeric;

      if v_pack_label is null
         or v_pack_count is null or v_pack_count <= 0
         or v_units_per_pack is null or v_units_per_pack <= 0
         or v_pack_cost_ref is null or v_pack_cost_ves is null
         or v_pack_cost_ref < 0 or v_pack_cost_ves < 0 then
        raise exception 'Item pack incompleto: requiere label, conteos y pack_cost REF+VES';
      end if;

      v_quantity := v_pack_count * v_units_per_pack;
    else
      v_entry_mode := 'unit';
      v_pack_label := null;
      v_pack_count := null;
      v_units_per_pack := null;
      v_pack_cost_ref := null;
      v_pack_cost_ves := null;
      v_quantity := (v_item ->> 'quantity')::integer;

      if v_quantity is null or v_quantity <= 0 then
        raise exception 'Cantidad invalida en item de compra';
      end if;
    end if;

    -- Costo unitario final del producto: neto + IVA de esta linea (0% = exento).
    v_cost_with_tax_ref := round(v_unit_cost_ref * (1 + coalesce(v_tax_rate, 0) / 100.0), 2);
    v_cost_with_tax_ves := round(v_unit_cost_ves * (1 + coalesce(v_tax_rate, 0) / 100.0), 2);

    select * into v_product
    from public.products
    where id = v_product_id
      and store_id = v_store_id
    for update;

    if not found then
      raise exception 'Producto no encontrado: %', v_product_id;
    end if;

    insert into public.purchase_items (
      purchase_id,
      product_id,
      quantity,
      unit_cost_ref,
      unit_cost_ves,
      subtotal_ves,
      entry_mode,
      pack_label,
      pack_count,
      units_per_pack,
      pack_cost_ref,
      pack_cost_ves,
      tax_rate,
      tax_ref,
      tax_ves,
      cost_currency
    )
    values (
      v_purchase.id,
      v_product_id,
      v_quantity,
      v_unit_cost_ref,
      v_unit_cost_ves,
      v_line_subtotal_ves,
      v_entry_mode,
      v_pack_label,
      v_pack_count,
      v_units_per_pack,
      v_pack_cost_ref,
      v_pack_cost_ves,
      v_tax_rate,
      v_line_tax_ref,
      v_line_tax_ves,
      v_cost_currency
    );

    if p_status = 'recibido' then
      v_stock_after := v_product.current_stock + v_quantity;

      update public.products
      set current_stock = v_stock_after,
          current_cost_ref = v_cost_with_tax_ref
      where id = v_product_id;

      select id, last_cost_ref, last_cost_ves
      into v_sp_id, v_old_cost_ref, v_old_cost_ves
      from public.supplier_products
      where supplier_id = p_supplier_id
        and product_id = v_product_id
        and store_id = v_store_id;

      insert into public.supplier_products (
        supplier_id,
        product_id,
        supplier_sku,
        last_cost_ref,
        last_cost_ves,
        last_purchased_at,
        store_id
      )
      values (
        p_supplier_id,
        v_product_id,
        v_supplier_sku,
        v_cost_with_tax_ref,
        v_cost_with_tax_ves,
        now(),
        v_store_id
      )
      on conflict (supplier_id, product_id)
      do update set
        supplier_sku = coalesce(excluded.supplier_sku, public.supplier_products.supplier_sku),
        last_cost_ref = excluded.last_cost_ref,
        last_cost_ves = excluded.last_cost_ves,
        last_purchased_at = excluded.last_purchased_at,
        is_active = true,
        updated_at = now()
      returning id into v_sp_id;

      perform public.append_supplier_product_price_history(
        v_sp_id,
        v_old_cost_ref,
        v_old_cost_ves,
        v_cost_with_tax_ref,
        v_cost_with_tax_ves,
        'compra',
        'Compra ' || v_purchase.purchase_number
      );

      insert into public.stock_movements (
        product_id,
        type,
        quantity_delta,
        stock_after,
        purchase_id,
        reason,
        created_by,
        store_id
      )
      values (
        v_product_id,
        'compra',
        v_quantity,
        v_stock_after,
        v_purchase.id,
        'Compra ' || v_purchase.purchase_number,
        auth.uid(),
        v_store_id
      );
    end if;
  end loop;

  v_total_ref := greatest(round(v_subtotal_ref - v_discount_ref + v_tax_ref, 2), 0);
  v_total_ves := greatest(round(v_subtotal_ves - v_discount_ves + v_tax_ves, 2), 0);

  update public.purchases
  set subtotal_ref = v_subtotal_ref,
      subtotal_ves = v_subtotal_ves,
      discount_ves = v_discount_ves,
      tax_ves = v_tax_ves,
      total_ref = v_total_ref,
      total_ves = v_total_ves
  where id = v_purchase.id
  returning * into v_purchase;

  return v_purchase;
end;
$$;

grant execute on function public.create_purchase(
  uuid, jsonb, uuid, numeric, numeric, numeric, text, text, public.purchase_status,
  numeric, numeric, numeric, numeric
) to authenticated;

-- receive_purchase: mismo criterio (costo producto = unitario con tax_rate de la linea)
create or replace function public.receive_purchase(p_purchase_id uuid)
returns public.purchases
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_purchase public.purchases;
  v_item public.purchase_items;
  v_product public.products;
  v_stock_after integer;
  v_sp_id uuid;
  v_old_cost_ref numeric(12,2);
  v_old_cost_ves numeric(14,2);
  v_cost_with_tax_ref numeric(12,2);
  v_cost_with_tax_ves numeric(14,2);
begin
  v_store_id := public.assert_store_context();

  if public.current_user_role() not in ('admin', 'almacen') then
    raise exception 'No autorizado para recibir compras';
  end if;

  select * into v_purchase
  from public.purchases
  where id = p_purchase_id
    and store_id = v_store_id
  for update;

  if not found then
    raise exception 'Compra no encontrada';
  end if;

  if v_purchase.status <> 'pedido' then
    raise exception 'Solo se pueden recibir compras en estado pedido';
  end if;

  for v_item in
    select *
    from public.purchase_items
    where purchase_id = p_purchase_id
  loop
    select * into v_product
    from public.products
    where id = v_item.product_id
      and store_id = v_store_id
    for update;

    if not found then
      raise exception 'Producto no encontrado: %', v_item.product_id;
    end if;

    v_stock_after := v_product.current_stock + v_item.quantity;
    v_cost_with_tax_ref := round(
      coalesce(v_item.unit_cost_ref, 0) * (1 + coalesce(v_item.tax_rate, 0) / 100.0),
      2
    );
    v_cost_with_tax_ves := round(
      coalesce(v_item.unit_cost_ves, 0) * (1 + coalesce(v_item.tax_rate, 0) / 100.0),
      2
    );

    update public.products
    set current_stock = v_stock_after,
        current_cost_ref = v_cost_with_tax_ref
    where id = v_item.product_id;

    select id, last_cost_ref, last_cost_ves
    into v_sp_id, v_old_cost_ref, v_old_cost_ves
    from public.supplier_products
    where supplier_id = v_purchase.supplier_id
      and product_id = v_item.product_id
      and store_id = v_store_id;

    insert into public.supplier_products (
      supplier_id,
      product_id,
      last_cost_ref,
      last_cost_ves,
      last_purchased_at,
      store_id
    )
    values (
      v_purchase.supplier_id,
      v_item.product_id,
      v_cost_with_tax_ref,
      v_cost_with_tax_ves,
      now(),
      v_store_id
    )
    on conflict (supplier_id, product_id)
    do update set
      last_cost_ref = excluded.last_cost_ref,
      last_cost_ves = excluded.last_cost_ves,
      last_purchased_at = excluded.last_purchased_at,
      is_active = true,
      updated_at = now()
    returning id into v_sp_id;

    perform public.append_supplier_product_price_history(
      v_sp_id,
      v_old_cost_ref,
      v_old_cost_ves,
      v_cost_with_tax_ref,
      v_cost_with_tax_ves,
      'compra',
      'Recepcion ' || v_purchase.purchase_number
    );

    insert into public.stock_movements (
      product_id,
      type,
      quantity_delta,
      stock_after,
      purchase_id,
      reason,
      created_by,
      store_id
    )
    values (
      v_item.product_id,
      'compra',
      v_item.quantity,
      v_stock_after,
      v_purchase.id,
      'Recepcion ' || v_purchase.purchase_number,
      auth.uid(),
      v_store_id
    );
  end loop;

  update public.purchases
  set status = 'recibido'
  where id = p_purchase_id
  returning * into v_purchase;

  return v_purchase;
end;
$$;

grant execute on function public.receive_purchase(uuid) to authenticated;

notify pgrst, 'reload schema';
