-- Patch: RPCs de escritura con store_id (post multitienda)
-- Fecha: 2026-08-10
-- Requiere: 20260716-multi-store.sql (stores, store_id NOT NULL, assert_store_context)
--
-- Problema: create_purchase / create_sale / register_payment / receive_* / cancel_* / return_*
-- insertaban filas sin store_id → null value violates not-null constraint.
--
-- Uso: Supabase Dashboard → SQL Editor → Run este archivo completo.

-- =============================================================================
-- create_sale
-- =============================================================================
create or replace function public.create_sale(
  p_customer_id uuid,
  p_items jsonb,
  p_exchange_rate_id uuid default null,
  p_ref_rate_ves numeric default null,
  p_discount_ref numeric default 0,
  p_tax_ref numeric default 0,
  p_notes text default null,
  p_invoice_number text default null
)
returns public.sales
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_rate numeric(14,4);
  v_sale public.sales;
  v_item jsonb;
  v_product public.products;
  v_product_id uuid;
  v_quantity integer;
  v_unit_price_ref numeric(12,2);
  v_unit_cost_ref numeric(12,2);
  v_line_subtotal_ref numeric(14,2);
  v_line_subtotal_ves numeric(14,2);
  v_subtotal_ref numeric(14,2) := 0;
  v_total_ref numeric(14,2);
  v_total_ves numeric(14,2);
  v_stock_after integer;
begin
  v_store_id := public.assert_store_context();

  if public.current_user_role() not in ('admin', 'vendedor') then
    raise exception 'No autorizado para crear ventas';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La venta debe tener al menos un item';
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

  perform public.assert_contact_type(p_customer_id, array['cliente', 'ambos']::public.contact_type[]);

  if not exists (
    select 1
    from public.contacts
    where id = p_customer_id
      and store_id = v_store_id
  ) then
    raise exception 'Contacto no pertenece a tu tienda';
  end if;

  insert into public.sales (
    invoice_number,
    customer_id,
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
    coalesce(p_invoice_number, 'V-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS')),
    p_customer_id,
    auth.uid(),
    p_exchange_rate_id,
    v_rate,
    coalesce(p_discount_ref, 0),
    coalesce(p_tax_ref, 0),
    'pendiente_pago',
    p_notes,
    v_store_id
  )
  returning * into v_sale;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_product_id := (v_item ->> 'product_id')::uuid;
    v_quantity := (v_item ->> 'quantity')::integer;

    if v_quantity is null or v_quantity <= 0 then
      raise exception 'Cantidad invalida en item de venta';
    end if;

    select * into v_product
    from public.products
    where id = v_product_id
      and store_id = v_store_id
      and is_active = true
    for update;

    if not found then
      raise exception 'Producto no encontrado o inactivo: %', v_product_id;
    end if;

    if v_product.current_stock < v_quantity then
      raise exception 'Stock insuficiente para producto %', v_product.sku;
    end if;

    v_unit_price_ref := coalesce((v_item ->> 'unit_price_ref')::numeric, v_product.sale_price_ref);
    v_unit_cost_ref := coalesce(v_product.current_cost_ref, 0);
    v_line_subtotal_ref := round(v_quantity::numeric * v_unit_price_ref, 2);
    v_line_subtotal_ves := round(v_line_subtotal_ref * v_rate, 2);
    v_subtotal_ref := v_subtotal_ref + v_line_subtotal_ref;
    v_stock_after := v_product.current_stock - v_quantity;

    insert into public.sale_items (
      sale_id,
      product_id,
      quantity,
      unit_price_ref,
      unit_cost_ref_snapshot,
      subtotal_ves
    )
    values (
      v_sale.id,
      v_product_id,
      v_quantity,
      v_unit_price_ref,
      v_unit_cost_ref,
      v_line_subtotal_ves
    );

    update public.products
    set current_stock = v_stock_after
    where id = v_product_id;

    insert into public.stock_movements (
      product_id,
      type,
      quantity_delta,
      stock_after,
      sale_id,
      reason,
      created_by,
      store_id
    )
    values (
      v_product_id,
      'venta',
      -v_quantity,
      v_stock_after,
      v_sale.id,
      'Venta ' || v_sale.invoice_number,
      auth.uid(),
      v_store_id
    );
  end loop;

  v_total_ref := greatest(round(v_subtotal_ref - coalesce(p_discount_ref, 0) + coalesce(p_tax_ref, 0), 2), 0);
  v_total_ves := round(v_total_ref * v_rate, 2);

  update public.sales
  set subtotal_ref = v_subtotal_ref,
      total_ref = v_total_ref,
      total_ves = v_total_ves
  where id = v_sale.id
  returning * into v_sale;

  return v_sale;
end;
$$;

-- =============================================================================
-- create_purchase
-- =============================================================================
create or replace function public.create_purchase(
  p_supplier_id uuid,
  p_items jsonb,
  p_exchange_rate_id uuid default null,
  p_ref_rate_ves numeric default null,
  p_discount_ref numeric default 0,
  p_tax_ref numeric default 0,
  p_notes text default null,
  p_purchase_number text default null,
  p_status public.purchase_status default 'recibido'
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
  v_line_subtotal_ref numeric(14,2);
  v_line_subtotal_ves numeric(14,2);
  v_subtotal_ref numeric(14,2) := 0;
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
    coalesce(p_discount_ref, 0),
    coalesce(p_tax_ref, 0),
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

    if v_entry_mode = 'pack' then
      v_pack_label := nullif(trim(v_item ->> 'pack_label'), '');
      v_pack_count := (v_item ->> 'pack_count')::integer;
      v_units_per_pack := (v_item ->> 'units_per_pack')::integer;
      v_pack_cost_ref := (v_item ->> 'pack_cost_ref')::numeric;

      if v_pack_label is null then
        raise exception 'Etiqueta de empaque requerida en item de compra';
      end if;

      if v_pack_count is null or v_pack_count <= 0 then
        raise exception 'Cantidad de empaques invalida en item de compra';
      end if;

      if v_units_per_pack is null or v_units_per_pack <= 0 then
        raise exception 'Unidades por empaque invalidas en item de compra';
      end if;

      if v_pack_cost_ref is null or v_pack_cost_ref < 0 then
        raise exception 'Costo por empaque invalido en item de compra';
      end if;

      v_quantity := v_pack_count * v_units_per_pack;
      v_unit_cost_ref := round(v_pack_cost_ref / v_units_per_pack, 2);
      v_line_subtotal_ref := round(v_pack_count::numeric * v_pack_cost_ref, 2);
    else
      v_entry_mode := 'unit';
      v_pack_label := null;
      v_pack_count := null;
      v_units_per_pack := null;
      v_pack_cost_ref := null;
      v_quantity := (v_item ->> 'quantity')::integer;
      v_unit_cost_ref := (v_item ->> 'unit_cost_ref')::numeric;

      if v_quantity is null or v_quantity <= 0 then
        raise exception 'Cantidad invalida en item de compra';
      end if;

      if v_unit_cost_ref is null or v_unit_cost_ref < 0 then
        raise exception 'Costo invalido en item de compra';
      end if;

      v_line_subtotal_ref := round(v_quantity::numeric * v_unit_cost_ref, 2);
    end if;

    select * into v_product
    from public.products
    where id = v_product_id
      and store_id = v_store_id
    for update;

    if not found then
      raise exception 'Producto no encontrado: %', v_product_id;
    end if;

    v_unit_cost_ves := round(v_unit_cost_ref * v_rate, 2);
    v_line_subtotal_ves := round(v_line_subtotal_ref * v_rate, 2);
    v_subtotal_ref := v_subtotal_ref + v_line_subtotal_ref;

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
      pack_cost_ref
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
      v_pack_cost_ref
    );

    if p_status = 'recibido' then
      v_stock_after := v_product.current_stock + v_quantity;

      update public.products
      set current_stock = v_stock_after,
          current_cost_ref = v_unit_cost_ref
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
        v_unit_cost_ref,
        v_unit_cost_ves,
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
        v_unit_cost_ref,
        v_unit_cost_ves,
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

  v_total_ref := greatest(round(v_subtotal_ref - coalesce(p_discount_ref, 0) + coalesce(p_tax_ref, 0), 2), 0);
  v_total_ves := round(v_total_ref * v_rate, 2);

  update public.purchases
  set subtotal_ref = v_subtotal_ref,
      total_ref = v_total_ref,
      total_ves = v_total_ves
  where id = v_purchase.id
  returning * into v_purchase;

  return v_purchase;
end;
$$;

-- =============================================================================
-- register_payment
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
    v_rate := v_purchase.ref_rate_ves;

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
    set paid_ves = paid_ves + v_amount_ves
    where id = p_purchase_id
    returning paid_ves into v_paid_ves;
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
-- receive_purchase
-- =============================================================================
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

    update public.products
    set current_stock = v_stock_after,
        current_cost_ref = v_item.unit_cost_ref
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
      v_item.unit_cost_ref,
      v_item.unit_cost_ves,
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
      v_item.unit_cost_ref,
      v_item.unit_cost_ves,
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

-- =============================================================================
-- cancel_sale
-- =============================================================================
create or replace function public.cancel_sale(p_sale_id uuid)
returns public.sales
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_sale public.sales;
  v_item public.sale_items;
  v_product public.products;
  v_stock_after integer;
begin
  v_store_id := public.assert_store_context();

  if public.current_user_role() not in ('admin', 'vendedor') then
    raise exception 'No autorizado para cancelar ventas';
  end if;

  select * into v_sale
  from public.sales
  where id = p_sale_id
    and store_id = v_store_id
  for update;

  if not found then
    raise exception 'Venta no encontrada';
  end if;

  if v_sale.status in ('cancelada', 'devuelta') then
    raise exception 'La venta ya fue cancelada o devuelta';
  end if;

  for v_item in
    select *
    from public.sale_items
    where sale_id = p_sale_id
  loop
    select * into v_product
    from public.products
    where id = v_item.product_id
      and store_id = v_store_id
    for update;

    v_stock_after := v_product.current_stock + v_item.quantity;

    update public.products
    set current_stock = v_stock_after
    where id = v_item.product_id;

    insert into public.stock_movements (
      product_id,
      type,
      quantity_delta,
      stock_after,
      sale_id,
      reason,
      created_by,
      store_id
    )
    values (
      v_item.product_id,
      'ajuste_entrada',
      v_item.quantity,
      v_stock_after,
      p_sale_id,
      'Cancelacion ' || v_sale.invoice_number,
      auth.uid(),
      v_store_id
    );
  end loop;

  update public.sales
  set status = 'cancelada'
  where id = p_sale_id
  returning * into v_sale;

  return v_sale;
end;
$$;

-- =============================================================================
-- return_sale
-- =============================================================================
create or replace function public.return_sale(p_sale_id uuid)
returns public.sales
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_sale public.sales;
  v_item public.sale_items;
  v_product public.products;
  v_stock_after integer;
begin
  v_store_id := public.assert_store_context();

  if public.current_user_role() not in ('admin', 'vendedor') then
    raise exception 'No autorizado para devolver ventas';
  end if;

  select * into v_sale
  from public.sales
  where id = p_sale_id
    and store_id = v_store_id
  for update;

  if not found then
    raise exception 'Venta no encontrada';
  end if;

  if v_sale.status in ('cancelada', 'devuelta') then
    raise exception 'La venta ya fue cancelada o devuelta';
  end if;

  for v_item in
    select *
    from public.sale_items
    where sale_id = p_sale_id
  loop
    select * into v_product
    from public.products
    where id = v_item.product_id
      and store_id = v_store_id
    for update;

    v_stock_after := v_product.current_stock + v_item.quantity;

    update public.products
    set current_stock = v_stock_after
    where id = v_item.product_id;

    insert into public.stock_movements (
      product_id,
      type,
      quantity_delta,
      stock_after,
      sale_id,
      reason,
      created_by,
      store_id
    )
    values (
      v_item.product_id,
      'devolucion_cliente',
      v_item.quantity,
      v_stock_after,
      p_sale_id,
      'Devolucion ' || v_sale.invoice_number,
      auth.uid(),
      v_store_id
    );
  end loop;

  update public.sales
  set status = 'devuelta'
  where id = p_sale_id
  returning * into v_sale;

  return v_sale;
end;
$$;

-- =============================================================================
-- cancel_purchase
-- =============================================================================
create or replace function public.cancel_purchase(p_purchase_id uuid)
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
begin
  v_store_id := public.assert_store_context();

  if public.current_user_role() not in ('admin', 'almacen') then
    raise exception 'No autorizado para cancelar compras';
  end if;

  select * into v_purchase
  from public.purchases
  where id = p_purchase_id
    and store_id = v_store_id
  for update;

  if not found then
    raise exception 'Compra no encontrada';
  end if;

  if v_purchase.status in ('cancelado', 'devuelto') then
    raise exception 'La compra ya fue cancelada o devuelta';
  end if;

  if v_purchase.status = 'recibido' then
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

      v_stock_after := v_product.current_stock - v_item.quantity;

      if v_stock_after < 0 then
        raise exception 'No hay stock suficiente para revertir la compra';
      end if;

      update public.products
      set current_stock = v_stock_after
      where id = v_item.product_id;

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
        'ajuste_salida',
        -v_item.quantity,
        v_stock_after,
        p_purchase_id,
        'Cancelacion ' || v_purchase.purchase_number,
        auth.uid(),
        v_store_id
      );
    end loop;
  end if;

  update public.purchases
  set status = 'cancelado'
  where id = p_purchase_id
  returning * into v_purchase;

  return v_purchase;
end;
$$;

-- =============================================================================
-- return_purchase
-- =============================================================================
create or replace function public.return_purchase(p_purchase_id uuid)
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
begin
  v_store_id := public.assert_store_context();

  if public.current_user_role() not in ('admin', 'almacen') then
    raise exception 'No autorizado para devolver compras';
  end if;

  select * into v_purchase
  from public.purchases
  where id = p_purchase_id
    and store_id = v_store_id
  for update;

  if not found then
    raise exception 'Compra no encontrada';
  end if;

  if v_purchase.status in ('cancelado', 'devuelto') then
    raise exception 'La compra ya fue cancelada o devuelta';
  end if;

  if v_purchase.status = 'recibido' then
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

      v_stock_after := v_product.current_stock - v_item.quantity;

      if v_stock_after < 0 then
        raise exception 'No hay stock suficiente para revertir la compra';
      end if;

      update public.products
      set current_stock = v_stock_after
      where id = v_item.product_id;

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
        'devolucion_proveedor',
        -v_item.quantity,
        v_stock_after,
        p_purchase_id,
        'Devolucion ' || v_purchase.purchase_number,
        auth.uid(),
        v_store_id
      );
    end loop;
  end if;

  update public.purchases
  set status = 'devuelto'
  where id = p_purchase_id
  returning * into v_purchase;

  return v_purchase;
end;
$$;

notify pgrst, 'reload schema';
