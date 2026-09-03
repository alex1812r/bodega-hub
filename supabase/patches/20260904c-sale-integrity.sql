-- Patch: integridad de ventas (tasa, precio unitario y cancelacion con pagos)
-- Fecha: 2026-09-04
-- Requiere: 20260810-rpc-store-context.sql (create_sale / cancel_sale con store_id)
--
-- Problema 1 (alto): la tasa ref/VES la fijaba el cliente sin validacion. `create_sale`
--   solo rechazaba `<= 0`, asi que un POST con `refRateVes: 1` registraba una venta de
--   $2,46 como Bs 2,46 en vez de Bs 1.970,89 (error de ~800x). Ademas
--   `items[].unit_price_ref = 0` se aceptaba y generaba una venta en Bs 0 que igual
--   descargaba inventario.
-- Problema 2 (medio): cancelar una venta pagada dejaba el dinero atrapado. `cancel_sale`
--   marcaba `cancelada` con `paid_ves` intacto y devolvia el stock; despues
--   `cancel_payment` se negaba para siempre ("No se puede anular un pago de una venta
--   cancelada o devuelta"). El efectivo quedaba en caja sin forma de sacarlo salvo SQL manual.
-- Problema 3 (bajo): la definicion de `cancel_sale` en `supabase-schema.sql` no filtraba
--   por `store_id` ni llamaba `assert_store_context()` siendo `security definer`.
--
-- Solucion:
--   1. `create_sale` compara la tasa recibida contra la ultima tasa registrada de la tienda
--      (`exchange_rates`, fila mas reciente por `created_at`) y rechaza fuera de una banda
--      de +-5%. Tolerancia elegida sobre el historico real: la tasa oficial se mueve menos
--      de ~0,6% por dia, asi que 5% cubre alrededor de una semana de deriva (una pestana de
--      POS abierta durante una actualizacion de tasa, o el cron de tasas caido varios dias)
--      pero corta cualquier error de orden de magnitud. Si la tienda todavia no tiene
--      ninguna tasa registrada no hay contra que comparar y se mantiene el comportamiento
--      anterior (solo `> 0`).
--   2. `create_sale` rechaza `unit_price_ref = 0` salvo que el propio producto tenga
--      `sale_price_ref = 0` (productos de obsequio/valor cero configurados a proposito).
--   3. `cancel_sale` se niega a cancelar una venta con pagos en estado `activo` y pide
--      anularlos primero. NO los anula solo: mover efectivo en silencio seria peor.
--   4. `cancel_sale` queda alcanzada a la tienda del contexto (ya lo estaba en la base
--      viva por 20260810; aqui se consolida para que el esquema y la base coincidan).
--
-- Uso: Supabase Dashboard -> SQL Editor -> Run este archivo completo.
-- Idempotente: solo `create or replace function` + `grant`.

-- =============================================================================
-- create_sale: valida la tasa contra la tasa vigente de la tienda y el precio unitario
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
  -- Banda permitida entre la tasa enviada y la ultima tasa registrada de la tienda.
  -- 0.05 = +-5%. Ver cabecera del patch para la justificacion.
  c_rate_tolerance constant numeric := 0.05;
  v_store_id uuid;
  v_rate numeric(14,4);
  v_reference_rate numeric(14,4);
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

  -- Tasa vigente de la tienda: ultima fila registrada.
  select rate_ves into v_reference_rate
  from public.exchange_rates
  where store_id = v_store_id
  order by created_at desc
  limit 1;

  if v_reference_rate is not null and v_reference_rate > 0 then
    if v_rate < v_reference_rate * (1 - c_rate_tolerance)
       or v_rate > v_reference_rate * (1 + c_rate_tolerance) then
      raise exception
        'Tasa ref/VES fuera de rango: se envio % Bs/REF y la tasa vigente de la tienda es % Bs/REF (tolerancia +-%). Actualiza la tasa y vuelve a intentar.',
        round(v_rate, 4),
        round(v_reference_rate, 4),
        -- El literal '%' no puede ir en el formato de RAISE: se arma como argumento.
        trim(trailing '.' from trim(trailing '0' from round(c_rate_tolerance * 100, 2)::text)) || '%';
    end if;
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

    if v_unit_price_ref is null or v_unit_price_ref < 0 then
      raise exception 'Precio unitario invalido para el producto %', v_product.sku;
    end if;

    -- Un precio unitario en cero solo se acepta si el producto vale cero de lista.
    if v_unit_price_ref = 0 and coalesce(v_product.sale_price_ref, 0) <> 0 then
      raise exception
        'Precio unitario en cero no permitido para el producto % (precio de lista: % REF)',
        v_product.sku, round(v_product.sale_price_ref, 2);
    end if;

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

grant execute on function public.create_sale(uuid, jsonb, uuid, numeric, numeric, numeric, text, text) to authenticated;

-- =============================================================================
-- cancel_sale: exige anular los pagos activos antes de cancelar; alcance por tienda
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
  v_active_payments integer;
  v_active_ves numeric(14,2);
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

  -- El dinero se saca por `cancel_payment`, no por aqui: cancelar una venta con pagos
  -- vivos dejaba el efectivo en caja y bloqueaba la anulacion del pago para siempre.
  select count(*), coalesce(sum(amount_ves), 0)
  into v_active_payments, v_active_ves
  -- Sin filtro por store_id a proposito: la venta ya quedo alcanzada arriba y aqui
  -- interesa no dejar fuera ningun pago vivo colgado de ella.
  from public.payments
  where sale_id = p_sale_id
    and status = 'activo';

  if v_active_payments > 0 then
    raise exception
      'La venta % tiene % pago(s) activo(s) por Bs %. Anula primero los pagos y luego cancela la venta.',
      v_sale.invoice_number, v_active_payments, round(v_active_ves, 2);
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

grant execute on function public.cancel_sale(uuid) to authenticated;
