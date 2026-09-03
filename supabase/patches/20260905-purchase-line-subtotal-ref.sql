-- =============================================================================
-- 20260905 — Compras: el subtotal REF de cada linea deja de ser derivado
--
-- Problema: purchase_items.subtotal_ref era una columna generada
-- `round(quantity * unit_cost_ref, 2)`. Cuando la compra se captura en Bs (el
-- caso normal), unit_cost_ref es un valor derivado y redondeado a 2 decimales;
-- al multiplicarlo por la cantidad total de unidades el error de redondeo se
-- multiplica tambien. Un bulto de 100 u a 0.0220 REF/u quedaba en 0.02 REF/u y
-- la linea mostraba 2.00 REF en vez de 2.20 REF (~10% de desvio), mientras el
-- encabezado de la compra guardaba el monto correcto enviado por el cliente.
-- Resultado: los montos item por item no cuadraban con el total.
--
-- Arreglo: subtotal_ref pasa a ser una columna real que guarda el subtotal REF
-- que envia el cliente (bultos x costo del bulto, o el equivalente exacto en
-- REF del monto en Bs de la linea), igual que ya se hacia con subtotal_ves.
-- Se recalculan las lineas existentes y se realinea el encabezado con la suma
-- de sus lineas. Idempotente. Requiere 20260813b.
--
-- Nota: solo cambia la cara REF (derivada). Los montos en Bs, que son el dinero
-- realmente pagado, no se tocan; las diferencias del encabezado son de centavos
-- (max ~1.20 REF en la compra mas antigua) y no alteran el estado de pago.
-- =============================================================================

begin;

-- 1) subtotal_ref deja de ser columna generada.
do $migrate$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'purchase_items'
      and column_name = 'subtotal_ref'
      and is_generated = 'ALWAYS'
  ) then
    alter table public.purchase_items drop column subtotal_ref;
  end if;
end
$migrate$;

alter table public.purchase_items
  add column if not exists subtotal_ref numeric(14,2) not null default 0;

alter table public.purchase_items drop constraint if exists purchase_items_subtotal_ref_check;
alter table public.purchase_items
  add constraint purchase_items_subtotal_ref_check check (subtotal_ref >= 0);

-- 2) Backfill: la magnitud exacta sale de la moneda en que se capturo la linea.
update public.purchase_items i
set subtotal_ref = case
  when i.cost_currency = 'ves' and p.ref_rate_ves > 0
    then round(i.subtotal_ves / p.ref_rate_ves, 2)
  when i.entry_mode = 'pack' and i.pack_count is not null and i.pack_cost_ref is not null
    then round(i.pack_count::numeric * i.pack_cost_ref, 2)
  else round(i.quantity::numeric * i.unit_cost_ref, 2)
end
from public.purchases p
where p.id = i.purchase_id;

-- 3) El impuesto de la linea se recalcula sobre el subtotal corregido.
update public.purchase_items
set tax_ref = round(subtotal_ref * (coalesce(tax_rate, 0) / 100.0), 2)
where coalesce(tax_rate, 0) > 0;

-- 4) El encabezado vuelve a ser exactamente la suma de sus lineas, en ambas
--    monedas. El encabezado en Bs sumaba lineas sin redondear y redondeaba una
--    sola vez al final, asi que tambien se iba unos centimos.
update public.purchases p
set subtotal_ref = s.subtotal_ref,
    subtotal_ves = s.subtotal_ves,
    tax_ref = s.tax_ref,
    tax_ves = s.tax_ves,
    total_ref = greatest(round(s.subtotal_ref - coalesce(p.discount_ref, 0) + s.tax_ref, 2), 0),
    total_ves = greatest(round(s.subtotal_ves - coalesce(p.discount_ves, 0) + s.tax_ves, 2), 0)
from (
  select purchase_id,
         round(sum(subtotal_ref), 2) as subtotal_ref,
         round(sum(subtotal_ves), 2) as subtotal_ves,
         round(sum(coalesce(tax_ref, 0)), 2) as tax_ref,
         round(sum(coalesce(tax_ves, 0)), 2) as tax_ves
  from public.purchase_items
  group by purchase_id
) s
where s.purchase_id = p.id;

-- 5) create_purchase guarda el subtotal REF que manda el cliente (ya lo recibia
--    en v_line_subtotal_ref pero la columna generada lo ignoraba).
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
      subtotal_ref,
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
      v_line_subtotal_ref,
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


commit;
