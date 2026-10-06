-- =============================================================================
-- 20261006c — RPC de compras e inventario en modo estricto del libro mayor
-- Proyecto: BodegaHub (plan stock-integrity, fase 5, STK-503)
-- Requiere: 20261006a-stock-ledger-guards.sql (trigger stock_movements_apply),
--           20261006b-sales-rpc-hardening.sql (register_payment, return_sale),
--           20260811-pack-unit-conversion.sql (product_pack_conversions)
--
-- Redefine completas, partiendo de su version vigente y con el cambio minimo:
--   create_purchase (20260905), receive_purchase (20260813b),
--   cancel_purchase y return_purchase (20260810), adjust_stock (20260813h),
--   convert_pack_to_units (20260811) y register_payment (20261006b).
--
-- En todas las que mueven stock:
--   * ninguna escribe ya el stock de products: se inserta el movimiento con
--     stock_after NULL y el trigger del parche a calcula el saldo y actualiza
--     el producto. Los demas updates de products (costo) filtran por tienda y
--     comprueban row_count = 1.
--   * orden de bloqueo: documento -> TODOS los productos tocados en una sola
--     sentencia ordenada por id -> bucle por linea.
--   * "if not found" tras cada select for update (PT404, no 23502 crudo).
--   * errores de negocio con SQLSTATE PT400 / PT403 / PT404 / PT409 y los
--     textos de siempre.
--
-- Causas (.notes/stock-integrity-gtm/causes.md):
--   C6  clave de idempotencia (p_client_request_id) en create_purchase,
--       adjust_stock y convert_pack_to_units. Misma tienda + misma clave +
--       mismo contenido + mismo usuario -> se devuelve el resultado original
--       sin mover nada; cualquier otro caso, PT409. Dos peticiones simultaneas
--       con la misma clave se serializan con un advisory lock por (tienda,
--       clave); el indice unico / la clave primaria quedan de respaldo.
--   C11 purchase_number por secuencia: 'C-YYYYMMDD-NNNNNN'.
--   C12 rechazos de negocio de compras con PT4xx (recibir dos veces, revertir
--       sin stock, cancelar / devolver dos veces).
--   C13 modo empaque de create_purchase contrastado con product_pack_conversions.
--   C14 return_purchase exige estado recibido.
--   C15 adjust_stock acepta p_sale_id / p_purchase_id (solo devolucion_cliente
--       / devolucion_proveedor), los valida contra la tienda y el documento,
--       los escribe en el movimiento y topa por documento - ya devuelto.
--       cancel_purchase y return_purchase descuentan lo ya devuelto.
--   C8  (rama de compras) register_payment rechaza compras cancelado / devuelto.
--
-- Idempotente, una sola transaccion. Ejecutar en SQL Editor o via db-up.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Esquema: clave de idempotencia de compras, secuencia de numeros de compra
--    y registro de claves de ajustes / conversiones
-- -----------------------------------------------------------------------------

alter table public.purchases
  add column if not exists client_request_id uuid;

alter table public.purchases
  add column if not exists client_request_hash text;

comment on column public.purchases.client_request_id is
  'Clave de idempotencia enviada por el cliente al crear la compra (unica por tienda).';
comment on column public.purchases.client_request_hash is
  'Huella del contenido enviado con client_request_id. La misma clave con otra huella se rechaza.';

create unique index if not exists purchases_store_client_request_unique
  on public.purchases (store_id, client_request_id)
  where client_request_id is not null;

create sequence if not exists public.purchases_number_seq as bigint;
revoke all on sequence public.purchases_number_seq from public, anon, authenticated;

-- Ajustes y conversiones no tienen documento propio: la clave, la huella y el
-- resultado devuelto se guardan aqui. La clave primaria es el respaldo unico.
create table if not exists public.stock_request_keys (
  store_id uuid not null references public.stores(id) on delete cascade,
  client_request_id uuid not null,
  operation text not null check (operation in ('adjust_stock', 'convert_pack_to_units')),
  request_hash text not null,
  user_id uuid references public.profiles(id) on delete set null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (store_id, client_request_id)
);

comment on table public.stock_request_keys is
  'Claves de idempotencia de adjust_stock y convert_pack_to_units. Solo la escriben esas RPC.';

alter table public.stock_request_keys enable row level security;
revoke all on public.stock_request_keys from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. Funciones internas (no son RPC: sin execute para los roles de PostgREST)
-- -----------------------------------------------------------------------------

-- Huella de un contenido ya normalizado como jsonb. Los numeros se toman tal
-- como llegan: un reintento del mismo envio manda el mismo cuerpo.
create or replace function public.stock_request_hash(p_payload jsonb)
returns text
language sql
immutable
set search_path = public
as $$
  select encode(sha256(convert_to(p_payload::text, 'UTF8')), 'hex');
$$;

-- C6 — compra ya registrada con esa clave en la tienda. NULL si no hay
-- ninguna; la compra si es un reintento legitimo; PT409 en cualquier otro caso.
create or replace function public.purchase_idempotent_replay(
  p_store_id uuid,
  p_client_request_id uuid,
  p_client_request_hash text
)
returns public.purchases
language plpgsql
security definer
set search_path = public
as $$
declare
  v_purchase public.purchases;
begin
  select * into v_purchase
  from public.purchases
  where store_id = p_store_id
    and client_request_id = p_client_request_id;

  if not found then
    return null;
  end if;

  if v_purchase.client_request_hash is distinct from p_client_request_hash
     or v_purchase.user_id is distinct from auth.uid()
     or v_purchase.status in ('cancelado', 'devuelto') then
    raise exception using
      errcode = 'PT409',
      message = 'La clave de idempotencia ya se uso en otra compra. Revisa la compra registrada antes de reintentar.';
  end if;

  return v_purchase;
end;
$$;

-- C6 — resultado ya devuelto para esa clave por adjust_stock o
-- convert_pack_to_units. NULL si la clave es nueva; PT409 si se uso con otra
-- operacion, otro contenido u otro usuario.
create or replace function public.stock_request_replay(
  p_store_id uuid,
  p_client_request_id uuid,
  p_operation text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key public.stock_request_keys;
begin
  select * into v_key
  from public.stock_request_keys
  where store_id = p_store_id
    and client_request_id = p_client_request_id;

  if not found then
    return null;
  end if;

  if v_key.operation is distinct from p_operation
     or v_key.request_hash is distinct from p_request_hash
     or v_key.user_id is distinct from auth.uid() then
    raise exception using
      errcode = 'PT409',
      message = 'La clave de idempotencia ya se uso en otro movimiento de inventario. Revisa el movimiento registrado antes de reintentar.';
  end if;

  return v_key.result;
end;
$$;

revoke all on function public.stock_request_hash(jsonb) from public, anon, authenticated;
revoke all on function public.purchase_idempotent_replay(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.stock_request_replay(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.stock_request_hash(jsonb) to service_role;
grant execute on function public.purchase_idempotent_replay(uuid, uuid, text) to service_role;
grant execute on function public.stock_request_replay(uuid, uuid, text, text) to service_role;

-- -----------------------------------------------------------------------------
-- 3. create_purchase — copia de 20260905 + C6, C11, C13, PT4xx y modo estricto
--    Firma nueva (14 argumentos): se elimina la de 13 para no dejar dos
--    sobrecargas vivas (PGRST203).
-- -----------------------------------------------------------------------------

drop function if exists public.create_purchase(
  uuid, jsonb, uuid, numeric, numeric, numeric, text, text, public.purchase_status,
  numeric, numeric, numeric, numeric
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
  p_subtotal_ref numeric default null,
  p_client_request_id uuid default null
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
  v_product_ids uuid[];
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
  v_pair_units integer;
  v_request_hash text;
  v_number_seq bigint;
  v_rows integer;
begin
  v_store_id := public.assert_store_context();

  if coalesce(public.current_user_role()::text, '') not in ('admin', 'almacen') then
    raise exception using errcode = 'PT403', message = 'No autorizado para crear compras';
  end if;

  -- C6 — reintento del mismo envio. El advisory lock serializa dos peticiones
  -- simultaneas con la misma clave: la segunda espera el commit de la primera y
  -- encuentra su compra (nunca llega al indice unico).
  if p_client_request_id is not null then
    perform pg_advisory_xact_lock(
      hashtextextended('purchase-request:' || v_store_id::text || ':' || p_client_request_id::text, 0)
    );

    v_request_hash := public.stock_request_hash(jsonb_build_array(
      'create_purchase',
      p_supplier_id,
      p_items,
      p_status,
      round(coalesce(p_discount_ref, 0), 2)::text,
      round(coalesce(p_tax_ref, 0), 2)::text,
      round(p_discount_ves, 2)::text,
      round(p_tax_ves, 2)::text,
      round(p_subtotal_ves, 2)::text,
      round(p_subtotal_ref, 2)::text
    ));
    v_purchase := public.purchase_idempotent_replay(v_store_id, p_client_request_id, v_request_hash);

    if v_purchase.id is not null then
      return v_purchase;
    end if;
  end if;

  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception using errcode = 'PT400', message = 'La compra debe tener al menos un item';
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
    raise exception using errcode = 'PT400', message = 'Debe indicar una tasa ref/VES valida';
  end if;

  if p_status is null or p_status not in ('pedido', 'recibido') then
    raise exception using errcode = 'PT400', message = 'Solo se puede crear una compra en estado pedido o recibido';
  end if;

  if p_discount_ves is null or p_tax_ves is null or p_subtotal_ves is null or p_subtotal_ref is null then
    raise exception using
      errcode = 'PT400',
      message = 'Debe enviar subtotal/descuento/impuesto en REF y VES desde el cliente';
  end if;

  v_discount_ref := coalesce(p_discount_ref, 0);
  v_discount_ves := p_discount_ves;
  v_tax_ref := coalesce(p_tax_ref, 0);
  v_tax_ves := p_tax_ves;
  v_subtotal_ref := p_subtotal_ref;
  v_subtotal_ves := p_subtotal_ves;

  if v_discount_ref < 0 or v_discount_ves < 0 or v_tax_ref < 0 or v_tax_ves < 0
     or v_subtotal_ref < 0 or v_subtotal_ves < 0 then
    raise exception using errcode = 'PT400', message = 'Totales de compra invalidos';
  end if;

  perform public.assert_contact_type(p_supplier_id, array['proveedor', 'ambos']::public.contact_type[]);

  if not exists (
    select 1
    from public.contacts
    where id = p_supplier_id
      and store_id = v_store_id
  ) then
    raise exception using errcode = 'PT400', message = 'Contacto no pertenece a tu tienda';
  end if;

  -- C11 — el numero por defecto sale de una secuencia: dos compras en el mismo
  -- milisegundo ya no chocan en purchases_store_number_unique.
  if p_purchase_number is null then
    v_number_seq := nextval('public.purchases_number_seq');
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
    store_id,
    client_request_id,
    client_request_hash
  )
  values (
    coalesce(
      p_purchase_number,
      'C-' || to_char(clock_timestamp(), 'YYYYMMDD') || '-'
        || lpad(v_number_seq::text, greatest(6, length(v_number_seq::text)), '0')
    ),
    p_supplier_id,
    auth.uid(),
    p_exchange_rate_id,
    v_rate,
    v_discount_ref,
    v_tax_ref,
    p_status,
    p_notes,
    v_store_id,
    p_client_request_id,
    case when p_client_request_id is not null then v_request_hash end
  )
  returning * into v_purchase;

  -- Documento primero; despues TODOS los productos de la compra en una sola
  -- sentencia y en orden fijo.
  select array_agg(distinct (e.value ->> 'product_id')::uuid)
  into v_product_ids
  from jsonb_array_elements(p_items) as e(value);

  perform 1
  from public.products
  where id = any(v_product_ids)
    and store_id = v_store_id
  order by id
  for update;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_product_id := (v_item ->> 'product_id')::uuid;
    v_supplier_sku := v_item ->> 'supplier_sku';
    v_entry_mode := coalesce(nullif(trim(v_item ->> 'entry_mode'), ''), 'unit');
    v_cost_currency := coalesce(nullif(trim(v_item ->> 'cost_currency'), ''), 'ves');

    if v_cost_currency not in ('ves', 'ref') then
      raise exception using errcode = 'PT400', message = 'cost_currency invalido en item de compra';
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
      raise exception using
        errcode = 'PT400',
        message = 'Cada item debe enviar costos/subtotales/impuesto en REF y VES';
    end if;

    if v_unit_cost_ref < 0 or v_unit_cost_ves < 0
       or v_line_subtotal_ref < 0 or v_line_subtotal_ves < 0
       or v_tax_rate < 0 or v_tax_rate > 100
       or v_line_tax_ref < 0 or v_line_tax_ves < 0 then
      raise exception using errcode = 'PT400', message = 'Montos invalidos en item de compra';
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
        raise exception using
          errcode = 'PT400',
          message = 'Item pack incompleto: requiere label, conteos y pack_cost REF+VES';
      end if;

      -- C13 — si el producto pertenece a un par empaque -> unidad activo, las
      -- unidades por empaque las fija el par, no el cliente.
      select c.units_per_pack into v_pair_units
      from public.product_pack_conversions c
      where c.unit_product_id = v_product_id
        and c.store_id = v_store_id
        and c.is_active = true;

      if found then
        -- El producto es la UNIDAD del par: entran pack_count x unidades del par.
        if v_units_per_pack <> v_pair_units then
          raise exception using
            errcode = 'PT400',
            message = format(
              'Las unidades por empaque enviadas (%s) no coinciden con la conversion registrada del producto (%s)',
              v_units_per_pack, v_pair_units
            );
        end if;

        v_quantity := v_pack_count * v_units_per_pack;
      else
        select c.units_per_pack into v_pair_units
        from public.product_pack_conversions c
        where c.pack_product_id = v_product_id
          and c.store_id = v_store_id
          and c.is_active = true;

        if found then
          if v_units_per_pack <> v_pair_units then
            raise exception using
              errcode = 'PT400',
              message = format(
                'Las unidades por empaque enviadas (%s) no coinciden con la conversion registrada del producto (%s)',
                v_units_per_pack, v_pair_units
              );
          end if;

          -- El producto ES el empaque: su stock se cuenta en empaques. Entran
          -- pack_count empaques al costo del empaque y la linea se guarda en
          -- modo unidad (quantity = empaques), que es lo que leen
          -- receive_purchase y la vista purchases_without_movements.
          v_quantity := v_pack_count;
          v_unit_cost_ref := v_pack_cost_ref;
          v_unit_cost_ves := v_pack_cost_ves;
          v_entry_mode := 'unit';
          v_pack_label := null;
          v_pack_count := null;
          v_units_per_pack := null;
          v_pack_cost_ref := null;
          v_pack_cost_ves := null;
        else
          v_quantity := v_pack_count * v_units_per_pack;
        end if;
      end if;
    else
      v_entry_mode := 'unit';
      v_pack_label := null;
      v_pack_count := null;
      v_units_per_pack := null;
      v_pack_cost_ref := null;
      v_pack_cost_ves := null;
      v_quantity := (v_item ->> 'quantity')::integer;

      if v_quantity is null or v_quantity <= 0 then
        raise exception using errcode = 'PT400', message = 'Cantidad invalida en item de compra';
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
      raise exception using
        errcode = 'PT404',
        message = format('Producto no encontrado: %s', v_product_id);
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
      update public.products
      set current_cost_ref = v_cost_with_tax_ref
      where id = v_product_id
        and store_id = v_store_id;

      get diagnostics v_rows = row_count;
      if v_rows <> 1 then
        raise exception using
          errcode = 'PT409',
          message = format('No se pudo actualizar el costo del producto %s', v_product_id);
      end if;

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

      -- Modo estricto: stock_after lo fija stock_movements_apply(), que tambien
      -- actualiza el stock del producto.
      insert into public.stock_movements (
        product_id,
        type,
        quantity_delta,
        purchase_id,
        reason,
        created_by,
        store_id
      )
      values (
        v_product_id,
        'compra',
        v_quantity,
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

revoke all on function public.create_purchase(
  uuid, jsonb, uuid, numeric, numeric, numeric, text, text, public.purchase_status,
  numeric, numeric, numeric, numeric, uuid
) from public, anon;
grant execute on function public.create_purchase(
  uuid, jsonb, uuid, numeric, numeric, numeric, text, text, public.purchase_status,
  numeric, numeric, numeric, numeric, uuid
) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. receive_purchase — copia de 20260813b + modo estricto, bloqueo ordenado y
--    PT4xx (recibir una compra que no esta en pedido: PT409)
-- -----------------------------------------------------------------------------

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
  v_product_ids uuid[];
  v_sp_id uuid;
  v_old_cost_ref numeric(12,2);
  v_old_cost_ves numeric(14,2);
  v_cost_with_tax_ref numeric(12,2);
  v_cost_with_tax_ves numeric(14,2);
  v_rows integer;
begin
  v_store_id := public.assert_store_context();

  if coalesce(public.current_user_role()::text, '') not in ('admin', 'almacen') then
    raise exception using errcode = 'PT403', message = 'No autorizado para recibir compras';
  end if;

  select * into v_purchase
  from public.purchases
  where id = p_purchase_id
    and store_id = v_store_id
  for update;

  if not found then
    raise exception using errcode = 'PT404', message = 'Compra no encontrada';
  end if;

  if v_purchase.status <> 'pedido' then
    raise exception using errcode = 'PT409', message = 'Solo se pueden recibir compras en estado pedido';
  end if;

  -- Todos los productos de la compra, en orden fijo, antes del bucle.
  select array_agg(distinct product_id)
  into v_product_ids
  from public.purchase_items
  where purchase_id = p_purchase_id;

  perform 1
  from public.products
  where id = any(v_product_ids)
    and store_id = v_store_id
  order by id
  for update;

  for v_item in
    select *
    from public.purchase_items
    where purchase_id = p_purchase_id
    order by product_id, id
  loop
    select * into v_product
    from public.products
    where id = v_item.product_id
      and store_id = v_store_id
    for update;

    if not found then
      raise exception using
        errcode = 'PT404',
        message = format('Producto no encontrado: %s', v_item.product_id);
    end if;

    v_cost_with_tax_ref := round(
      coalesce(v_item.unit_cost_ref, 0) * (1 + coalesce(v_item.tax_rate, 0) / 100.0),
      2
    );
    v_cost_with_tax_ves := round(
      coalesce(v_item.unit_cost_ves, 0) * (1 + coalesce(v_item.tax_rate, 0) / 100.0),
      2
    );

    update public.products
    set current_cost_ref = v_cost_with_tax_ref
    where id = v_item.product_id
      and store_id = v_store_id;

    get diagnostics v_rows = row_count;
    if v_rows <> 1 then
      raise exception using
        errcode = 'PT409',
        message = format('No se pudo actualizar el costo del producto %s', v_item.product_id);
    end if;

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
      purchase_id,
      reason,
      created_by,
      store_id
    )
    values (
      v_item.product_id,
      'compra',
      v_item.quantity,
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

revoke all on function public.receive_purchase(uuid) from public, anon;
grant execute on function public.receive_purchase(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 5. cancel_purchase — copia de 20260810 + modo estricto, bloqueo ordenado,
--    PT4xx y C15 (revierte por producto lo recibido - ya devuelto)
-- -----------------------------------------------------------------------------

create or replace function public.cancel_purchase(p_purchase_id uuid)
returns public.purchases
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_purchase public.purchases;
  v_line record;
  v_product public.products;
  v_product_ids uuid[];
  v_already_returned integer;
  v_quantity integer;
begin
  v_store_id := public.assert_store_context();

  if coalesce(public.current_user_role()::text, '') not in ('admin', 'almacen') then
    raise exception using errcode = 'PT403', message = 'No autorizado para cancelar compras';
  end if;

  select * into v_purchase
  from public.purchases
  where id = p_purchase_id
    and store_id = v_store_id
  for update;

  if not found then
    raise exception using errcode = 'PT404', message = 'Compra no encontrada';
  end if;

  if v_purchase.status in ('cancelado', 'devuelto') then
    raise exception using errcode = 'PT409', message = 'La compra ya fue cancelada o devuelta';
  end if;

  if v_purchase.status = 'recibido' then
    select array_agg(distinct product_id)
    into v_product_ids
    from public.purchase_items
    where purchase_id = p_purchase_id;

    perform 1
    from public.products
    where id = any(v_product_ids)
      and store_id = v_store_id
    order by id
    for update;

    for v_line in
      select product_id, sum(quantity)::integer as received
      from public.purchase_items
      where purchase_id = p_purchase_id
      group by product_id
      order by product_id
    loop
      select * into v_product
      from public.products
      where id = v_line.product_id
        and store_id = v_store_id
      for update;

      if not found then
        raise exception using
          errcode = 'PT404',
          message = format(
            'Producto no encontrado en tu tienda (%s): no se puede revertir el stock de la compra %s',
            v_line.product_id, v_purchase.purchase_number
          );
      end if;

      -- C15 — lo ya devuelto al proveedor con movimientos ligados a esta compra.
      select coalesce(-sum(quantity_delta), 0)::integer
      into v_already_returned
      from public.stock_movements
      where purchase_id = p_purchase_id
        and product_id = v_line.product_id
        and type = 'devolucion_proveedor';

      v_quantity := v_line.received - v_already_returned;

      if v_quantity > 0 then
        if v_product.current_stock - v_quantity < 0 then
          raise exception using
            errcode = 'PT409',
            message = 'No hay stock suficiente para revertir la compra';
        end if;

        insert into public.stock_movements (
          product_id,
          type,
          quantity_delta,
          purchase_id,
          reason,
          created_by,
          store_id
        )
        values (
          v_line.product_id,
          'ajuste_salida',
          -v_quantity,
          p_purchase_id,
          'Cancelacion ' || v_purchase.purchase_number,
          auth.uid(),
          v_store_id
        );
      end if;
    end loop;
  end if;

  update public.purchases
  set status = 'cancelado'
  where id = p_purchase_id
  returning * into v_purchase;

  return v_purchase;
end;
$$;

revoke all on function public.cancel_purchase(uuid) from public, anon;
grant execute on function public.cancel_purchase(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 6. return_purchase — copia de 20260810 + C14 (exige recibido), C15, modo
--    estricto, bloqueo ordenado y PT4xx
-- -----------------------------------------------------------------------------

create or replace function public.return_purchase(p_purchase_id uuid)
returns public.purchases
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_purchase public.purchases;
  v_line record;
  v_product public.products;
  v_product_ids uuid[];
  v_already_returned integer;
  v_quantity integer;
begin
  v_store_id := public.assert_store_context();

  if coalesce(public.current_user_role()::text, '') not in ('admin', 'almacen') then
    raise exception using errcode = 'PT403', message = 'No autorizado para devolver compras';
  end if;

  select * into v_purchase
  from public.purchases
  where id = p_purchase_id
    and store_id = v_store_id
  for update;

  if not found then
    raise exception using errcode = 'PT404', message = 'Compra no encontrada';
  end if;

  if v_purchase.status in ('cancelado', 'devuelto') then
    raise exception using errcode = 'PT409', message = 'La compra ya fue cancelada o devuelta';
  end if;

  -- C14 — solo se devuelve lo que entro: un pedido nunca recibido se cancela.
  if v_purchase.status <> 'recibido' then
    raise exception using errcode = 'PT409', message = 'Solo se pueden devolver compras recibidas';
  end if;

  select array_agg(distinct product_id)
  into v_product_ids
  from public.purchase_items
  where purchase_id = p_purchase_id;

  perform 1
  from public.products
  where id = any(v_product_ids)
    and store_id = v_store_id
  order by id
  for update;

  for v_line in
    select product_id, sum(quantity)::integer as received
    from public.purchase_items
    where purchase_id = p_purchase_id
    group by product_id
    order by product_id
  loop
    select * into v_product
    from public.products
    where id = v_line.product_id
      and store_id = v_store_id
    for update;

    if not found then
      raise exception using
        errcode = 'PT404',
        message = format(
          'Producto no encontrado en tu tienda (%s): no se puede revertir el stock de la compra %s',
          v_line.product_id, v_purchase.purchase_number
        );
    end if;

    -- C15 — lo ya devuelto al proveedor con movimientos ligados a esta compra.
    select coalesce(-sum(quantity_delta), 0)::integer
    into v_already_returned
    from public.stock_movements
    where purchase_id = p_purchase_id
      and product_id = v_line.product_id
      and type = 'devolucion_proveedor';

    v_quantity := v_line.received - v_already_returned;

    if v_quantity > 0 then
      if v_product.current_stock - v_quantity < 0 then
        raise exception using
          errcode = 'PT409',
          message = 'No hay stock suficiente para revertir la compra';
      end if;

      insert into public.stock_movements (
        product_id,
        type,
        quantity_delta,
        purchase_id,
        reason,
        created_by,
        store_id
      )
      values (
        v_line.product_id,
        'devolucion_proveedor',
        -v_quantity,
        p_purchase_id,
        'Devolucion ' || v_purchase.purchase_number,
        auth.uid(),
        v_store_id
      );
    end if;
  end loop;

  update public.purchases
  set status = 'devuelto'
  where id = p_purchase_id
  returning * into v_purchase;

  return v_purchase;
end;
$$;

revoke all on function public.return_purchase(uuid) from public, anon;
grant execute on function public.return_purchase(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 7. adjust_stock — copia de 20260813h + C6, C15, PT4xx y modo estricto
--    Firma nueva (7 argumentos): se elimina la de 4 (PGRST203).
-- -----------------------------------------------------------------------------

drop function if exists public.adjust_stock(uuid, integer, text, public.stock_movement_type);

create or replace function public.adjust_stock(
  p_product_id uuid,
  p_quantity_delta integer,
  p_reason text default null,
  p_type public.stock_movement_type default null,
  p_client_request_id uuid default null,
  p_sale_id uuid default null,
  p_purchase_id uuid default null
)
returns public.stock_movements
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_product public.products;
  v_type public.stock_movement_type;
  v_movement public.stock_movements;
  v_sale public.sales;
  v_purchase public.purchases;
  v_document_quantity integer;
  v_already_returned integer;
  v_request_hash text;
  v_replay jsonb;
begin
  v_store_id := public.assert_store_context();

  if coalesce(public.current_user_role()::text, '') not in ('admin', 'almacen') then
    raise exception using errcode = 'PT403', message = 'No autorizado para ajustar stock';
  end if;

  -- C6 — reintento del mismo ajuste: se devuelve el movimiento original.
  if p_client_request_id is not null then
    perform pg_advisory_xact_lock(
      hashtextextended('stock-request:' || v_store_id::text || ':' || p_client_request_id::text, 0)
    );

    v_request_hash := public.stock_request_hash(jsonb_build_array(
      'adjust_stock', p_product_id, p_quantity_delta, p_reason, p_type, p_sale_id, p_purchase_id
    ));
    v_replay := public.stock_request_replay(v_store_id, p_client_request_id, 'adjust_stock', v_request_hash);

    if v_replay is not null then
      v_movement := jsonb_populate_record(null::public.stock_movements, v_replay);
      return v_movement;
    end if;
  end if;

  if p_quantity_delta is null or p_quantity_delta = 0 then
    raise exception using errcode = 'PT400', message = 'El ajuste de stock no puede ser cero';
  end if;

  v_type := coalesce(
    p_type,
    case
      when p_quantity_delta > 0 then 'ajuste_entrada'::public.stock_movement_type
      else 'ajuste_salida'::public.stock_movement_type
    end
  );

  if v_type in ('venta', 'compra', 'conversion_entrada', 'conversion_salida') then
    raise exception using
      errcode = 'PT400',
      message = 'Use create_sale, create_purchase o convert_pack_to_units para este tipo de movimiento';
  end if;

  if v_type in ('ajuste_salida', 'devolucion_proveedor') and p_quantity_delta > 0 then
    raise exception using
      errcode = 'PT400',
      message = 'ajuste_salida / devolucion_proveedor requiere quantity_delta negativo';
  end if;

  if v_type in ('ajuste_entrada', 'devolucion_cliente', 'inventario_inicial')
     and p_quantity_delta < 0 then
    raise exception using errcode = 'PT400', message = 'Este tipo de ajuste requiere quantity_delta positivo';
  end if;

  -- C15 — el documento solo acompana a su devolucion.
  if p_sale_id is not null and v_type <> 'devolucion_cliente' then
    raise exception using
      errcode = 'PT400',
      message = 'Solo una devolucion de cliente puede ligarse a una venta';
  end if;

  if p_purchase_id is not null and v_type <> 'devolucion_proveedor' then
    raise exception using
      errcode = 'PT400',
      message = 'Solo una devolucion a proveedor puede ligarse a una compra';
  end if;

  -- Orden de bloqueo: documento -> producto.
  if p_sale_id is not null then
    select * into v_sale
    from public.sales
    where id = p_sale_id
      and store_id = v_store_id
    for update;

    if not found then
      raise exception using errcode = 'PT404', message = 'Venta no encontrada';
    end if;

    if v_sale.status in ('cancelada', 'devuelta') then
      raise exception using errcode = 'PT409', message = 'La venta ya fue cancelada o devuelta';
    end if;

    if v_sale.status not in ('pagada', 'pendiente_pago') then
      raise exception using
        errcode = 'PT409',
        message = 'Solo se pueden devolver ventas pagadas o pendientes de pago';
    end if;
  end if;

  if p_purchase_id is not null then
    select * into v_purchase
    from public.purchases
    where id = p_purchase_id
      and store_id = v_store_id
    for update;

    if not found then
      raise exception using errcode = 'PT404', message = 'Compra no encontrada';
    end if;

    if v_purchase.status in ('cancelado', 'devuelto') then
      raise exception using errcode = 'PT409', message = 'La compra ya fue cancelada o devuelta';
    end if;

    if v_purchase.status <> 'recibido' then
      raise exception using errcode = 'PT409', message = 'Solo se pueden devolver compras recibidas';
    end if;
  end if;

  select * into v_product
  from public.products
  where id = p_product_id
    and store_id = v_store_id
  for update;

  if not found then
    raise exception using errcode = 'PT404', message = 'Producto no encontrado';
  end if;

  -- C15 — tope: lo vendido (o recibido) de ese producto en el documento menos
  -- lo ya devuelto con movimientos ligados a el.
  if p_sale_id is not null then
    select coalesce(sum(quantity), 0)::integer
    into v_document_quantity
    from public.sale_items
    where sale_id = p_sale_id
      and product_id = p_product_id;

    if v_document_quantity = 0 then
      raise exception using errcode = 'PT400', message = 'El producto no pertenece a la venta indicada';
    end if;

    select coalesce(sum(quantity_delta), 0)::integer
    into v_already_returned
    from public.stock_movements
    where sale_id = p_sale_id
      and product_id = p_product_id
      and type = 'devolucion_cliente';

    if p_quantity_delta > v_document_quantity - v_already_returned then
      raise exception using
        errcode = 'PT409',
        message = format(
          'La devolucion supera lo vendido en la venta %s: vendido %s, ya devuelto %s',
          v_sale.invoice_number, v_document_quantity, v_already_returned
        );
    end if;
  end if;

  if p_purchase_id is not null then
    select coalesce(sum(quantity), 0)::integer
    into v_document_quantity
    from public.purchase_items
    where purchase_id = p_purchase_id
      and product_id = p_product_id;

    if v_document_quantity = 0 then
      raise exception using errcode = 'PT400', message = 'El producto no pertenece a la compra indicada';
    end if;

    select coalesce(-sum(quantity_delta), 0)::integer
    into v_already_returned
    from public.stock_movements
    where purchase_id = p_purchase_id
      and product_id = p_product_id
      and type = 'devolucion_proveedor';

    if -p_quantity_delta > v_document_quantity - v_already_returned then
      raise exception using
        errcode = 'PT409',
        message = format(
          'La devolucion supera lo recibido en la compra %s: recibido %s, ya devuelto %s',
          v_purchase.purchase_number, v_document_quantity, v_already_returned
        );
    end if;
  end if;

  if v_product.current_stock + p_quantity_delta < 0 then
    raise exception using errcode = 'PT409', message = 'Stock insuficiente';
  end if;

  -- Modo estricto: stock_after lo fija stock_movements_apply(), que tambien
  -- actualiza el stock del producto.
  insert into public.stock_movements (
    product_id,
    type,
    quantity_delta,
    sale_id,
    purchase_id,
    reason,
    created_by,
    store_id
  )
  values (
    p_product_id,
    v_type,
    p_quantity_delta,
    p_sale_id,
    p_purchase_id,
    p_reason,
    auth.uid(),
    v_store_id
  )
  returning * into v_movement;

  if p_client_request_id is not null then
    insert into public.stock_request_keys (
      store_id, client_request_id, operation, request_hash, user_id, result
    )
    values (
      v_store_id, p_client_request_id, 'adjust_stock', v_request_hash, auth.uid(), to_jsonb(v_movement)
    );
  end if;

  return v_movement;
end;
$$;

revoke all on function public.adjust_stock(
  uuid, integer, text, public.stock_movement_type, uuid, uuid, uuid
) from public, anon;
grant execute on function public.adjust_stock(
  uuid, integer, text, public.stock_movement_type, uuid, uuid, uuid
) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 8. convert_pack_to_units — copia de 20260811 + C6, PT4xx y modo estricto
--    Firma nueva (4 argumentos): se elimina la de 3 (PGRST203).
-- -----------------------------------------------------------------------------

drop function if exists public.convert_pack_to_units(uuid, integer, text);

create or replace function public.convert_pack_to_units(
  p_pack_product_id uuid,
  p_pack_quantity integer,
  p_reason text default null,
  p_client_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_link public.product_pack_conversions;
  v_pack public.products;
  v_unit public.products;
  v_conversion_id uuid := gen_random_uuid();
  v_units_out integer;
  v_unit_stock integer;
  v_transferred_value numeric(14,4);
  v_unit_cost numeric(12,2);
  v_new_unit_cost numeric(12,2);
  v_pack_movement public.stock_movements;
  v_unit_movement public.stock_movements;
  v_request_hash text;
  v_result jsonb;
  v_rows integer;
begin
  v_store_id := public.assert_store_context();

  if coalesce(public.current_user_role()::text, '') not in ('admin', 'almacen') then
    raise exception using errcode = 'PT403', message = 'No autorizado para convertir empaque a unidad';
  end if;

  -- C6 — reintento de la misma conversion: se devuelve el resultado original.
  if p_client_request_id is not null then
    perform pg_advisory_xact_lock(
      hashtextextended('stock-request:' || v_store_id::text || ':' || p_client_request_id::text, 0)
    );

    v_request_hash := public.stock_request_hash(jsonb_build_array(
      'convert_pack_to_units', p_pack_product_id, p_pack_quantity, p_reason
    ));
    v_result := public.stock_request_replay(
      v_store_id, p_client_request_id, 'convert_pack_to_units', v_request_hash
    );

    if v_result is not null then
      return v_result;
    end if;
  end if;

  if p_pack_quantity is null or p_pack_quantity <= 0 then
    raise exception using errcode = 'PT400', message = 'La cantidad de empaques debe ser mayor a cero';
  end if;

  select * into v_link
  from public.product_pack_conversions
  where pack_product_id = p_pack_product_id
    and store_id = v_store_id
    and is_active = true
  for update;

  if not found then
    raise exception using
      errcode = 'PT404',
      message = 'El producto no tiene conversion de empaque a unidad activa';
  end if;

  -- Los dos productos del par en una sola sentencia y en orden fijo.
  perform 1
  from public.products
  where id in (v_link.pack_product_id, v_link.unit_product_id)
    and store_id = v_store_id
  order by id
  for update;

  select * into v_pack
  from public.products
  where id = v_link.pack_product_id
    and store_id = v_store_id
  for update;

  if not found then
    raise exception using errcode = 'PT404', message = 'Producto de empaque no encontrado';
  end if;

  select * into v_unit
  from public.products
  where id = v_link.unit_product_id
    and store_id = v_store_id
  for update;

  if not found then
    raise exception using errcode = 'PT404', message = 'Producto unidad no encontrado';
  end if;

  if v_pack.current_stock < p_pack_quantity then
    raise exception using errcode = 'PT409', message = 'Stock insuficiente de empaque';
  end if;

  v_units_out := p_pack_quantity * v_link.units_per_pack;
  v_unit_stock := v_unit.current_stock + v_units_out;

  v_transferred_value := p_pack_quantity::numeric * coalesce(v_pack.current_cost_ref, 0);
  v_unit_cost := round(v_transferred_value / v_units_out::numeric, 2);

  if v_unit.current_stock <= 0 then
    v_new_unit_cost := v_unit_cost;
  else
    v_new_unit_cost := round(
      (
        (v_unit.current_stock::numeric * coalesce(v_unit.current_cost_ref, 0))
        + v_transferred_value
      ) / v_unit_stock::numeric,
      2
    );
  end if;

  update public.products
  set current_cost_ref = v_new_unit_cost,
      updated_at = now()
  where id = v_unit.id
    and store_id = v_store_id;

  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception using
      errcode = 'PT409',
      message = 'No se pudo actualizar el costo del producto unidad';
  end if;

  -- Modo estricto: stock_after lo fija stock_movements_apply(), que tambien
  -- actualiza el stock de cada producto.
  insert into public.stock_movements (
    product_id,
    type,
    quantity_delta,
    conversion_id,
    reason,
    store_id,
    created_by
  )
  values (
    v_pack.id,
    'conversion_salida'::public.stock_movement_type,
    -p_pack_quantity,
    v_conversion_id,
    p_reason,
    v_store_id,
    auth.uid()
  )
  returning * into v_pack_movement;

  insert into public.stock_movements (
    product_id,
    type,
    quantity_delta,
    conversion_id,
    reason,
    store_id,
    created_by
  )
  values (
    v_unit.id,
    'conversion_entrada'::public.stock_movement_type,
    v_units_out,
    v_conversion_id,
    p_reason,
    v_store_id,
    auth.uid()
  )
  returning * into v_unit_movement;

  v_result := jsonb_build_object(
    'conversionId', v_conversion_id,
    'unitsPerPack', v_link.units_per_pack,
    'packQuantity', p_pack_quantity,
    'unitQuantity', v_units_out,
    'unitCostRef', v_unit_cost,
    'packMovement', jsonb_build_object(
      'id', v_pack_movement.id,
      'product_id', v_pack_movement.product_id,
      'type', v_pack_movement.type,
      'quantity_delta', v_pack_movement.quantity_delta,
      'stock_after', v_pack_movement.stock_after,
      'conversion_id', v_pack_movement.conversion_id,
      'reason', v_pack_movement.reason,
      'created_at', v_pack_movement.created_at
    ),
    'unitMovement', jsonb_build_object(
      'id', v_unit_movement.id,
      'product_id', v_unit_movement.product_id,
      'type', v_unit_movement.type,
      'quantity_delta', v_unit_movement.quantity_delta,
      'stock_after', v_unit_movement.stock_after,
      'conversion_id', v_unit_movement.conversion_id,
      'reason', v_unit_movement.reason,
      'created_at', v_unit_movement.created_at
    )
  );

  if p_client_request_id is not null then
    insert into public.stock_request_keys (
      store_id, client_request_id, operation, request_hash, user_id, result
    )
    values (
      v_store_id, p_client_request_id, 'convert_pack_to_units', v_request_hash, auth.uid(), v_result
    );
  end if;

  return v_result;
end;
$$;

revoke all on function public.convert_pack_to_units(uuid, integer, text, uuid) from public, anon;
grant execute on function public.convert_pack_to_units(uuid, integer, text, uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 9. register_payment — copia literal de 20261006b + C8 rama de compras: una
--    compra cancelada o devuelta no admite pagos (misma firma de 12 argumentos)
-- -----------------------------------------------------------------------------

create or replace function public.register_payment(
  p_sale_id uuid default null,
  p_purchase_id uuid default null,
  p_method public.payment_method default 'efectivo_ves',
  p_amount numeric default 0,
  p_bank_name text default null,
  p_phone text default null,
  p_reference_code text default null,
  p_notes text default null,
  p_change_method public.payment_method default null,
  p_change_amount numeric default 0,
  p_received_denominations jsonb default null,
  p_change_denominations jsonb default null
) returns public.payments language plpgsql security definer set search_path = public as $$
declare
  v_store_id uuid; v_sale public.sales; v_purchase public.purchases; v_payment public.payments;
  v_direction public.payment_direction; v_contact_id uuid; v_rate numeric(14,4);
  v_currency public.payment_currency; v_amount_ves numeric(14,2); v_amount_ref numeric(14,2);
  v_paid_ves numeric(14,2); v_paid_ref numeric(14,2); v_session public.cash_sessions;
  v_vault public.store_vaults; v_movement_ves numeric(14,2); v_movement_ref numeric(14,2);
  v_is_bank boolean;
  v_change_method public.payment_method; v_change_amount numeric(14,2);
  v_change_ves numeric(14,2) := 0; v_change_ref numeric(14,2) := 0;
  v_change_is_bank boolean := false; v_net_ves numeric(14,2);
  v_change_notes text;
  v_outstanding_ves numeric(14,2); v_overpay_tolerance numeric(14,2);
  v_cash_ves numeric(14,2); v_cash_ref numeric(14,2);
begin
  v_store_id := public.assert_store_context();
  if p_amount is null or p_amount <= 0 then
    raise exception 'El monto del pago debe ser mayor a cero' using errcode = 'PT400';
  end if;
  if (p_sale_id is null and p_purchase_id is null) or (p_sale_id is not null and p_purchase_id is not null) then
    raise exception 'Debe asociar el pago a una venta o a una compra' using errcode = 'PT400';
  end if;
  if p_method = 'pago_movil' then
    if p_bank_name is null or length(trim(p_bank_name)) = 0 then
      raise exception 'Pago Móvil requiere banco' using errcode = 'PT400';
    end if;
    if p_phone is null or length(trim(p_phone)) = 0 then
      raise exception 'Pago Móvil requiere teléfono' using errcode = 'PT400';
    end if;
    if p_reference_code is null or p_reference_code !~ '^[0-9]{4}$' then
      raise exception 'Pago Móvil requiere referencia de 4 dígitos' using errcode = 'PT400';
    end if;
  end if;
  if p_method = 'transferencia' then
    if p_bank_name is null or length(trim(p_bank_name)) = 0 then
      raise exception 'Transferencia requiere banco' using errcode = 'PT400';
    end if;
    if p_reference_code is null or length(trim(p_reference_code)) = 0 then
      raise exception 'Transferencia requiere número de transferencia' using errcode = 'PT400';
    end if;
  end if;

  -- Validación del vuelto (solo aplica a ventas).
  v_change_amount := round(coalesce(p_change_amount, 0), 2);
  if v_change_amount < 0 then
    raise exception 'El monto del vuelto no puede ser negativo' using errcode = 'PT400';
  end if;
  if p_purchase_id is not null and (p_change_method is not null or v_change_amount > 0) then
    raise exception 'No se puede registrar vuelto en un pago de compra: el vuelto solo aplica a pagos de venta'
      using errcode = 'PT400';
  end if;
  if v_change_amount > 0 and p_change_method is null then
    raise exception 'Debe indicar el método del vuelto' using errcode = 'PT400';
  end if;
  if v_change_amount > 0 then
    v_change_method := p_change_method;
  else
    v_change_method := null;
  end if;
  v_change_is_bank := coalesce(v_change_method in ('pago_movil', 'transferencia', 'punto_venta'), false);

  v_is_bank := p_method in ('pago_movil', 'transferencia', 'punto_venta');

  if p_sale_id is not null then
    if public.current_user_role() not in ('admin', 'contador', 'vendedor') then
      raise exception 'No autorizado para registrar pagos de ventas' using errcode = 'PT403';
    end if;
    select * into v_sale from public.sales where id = p_sale_id and store_id = v_store_id for update;
    if not found then raise exception 'Venta no encontrada' using errcode = 'PT404'; end if;
    -- C8 — una venta cancelada o devuelta no admite cobros: el pago la devolvia a
    -- pendiente_pago y permitia devolverla (y reponer stock) otra vez.
    if v_sale.status in ('cancelada', 'devuelta') then
      raise exception 'No se puede registrar un pago en una venta cancelada o devuelta' using errcode = 'PT409';
    end if;
    v_direction := 'entrada'; v_contact_id := v_sale.customer_id; v_rate := v_sale.ref_rate_ves;
    if p_method = 'efectivo_usd' then
      v_currency := 'USD'; v_amount_ref := round(p_amount, 2); v_amount_ves := round(p_amount * v_rate, 2);
    else
      v_currency := 'VES'; v_amount_ves := round(p_amount, 2); v_amount_ref := round(p_amount / v_rate, 2);
    end if;

    -- El vuelto se expresa siempre en Bs. a la tasa de la venta.
    if v_change_method is not null then
      if v_change_method = 'efectivo_usd' then
        v_change_ref := v_change_amount;
        v_change_ves := round(v_change_amount * v_rate, 2);
      else
        v_change_ref := 0;
        v_change_ves := round(v_change_amount, 2);
      end if;
      if v_change_ves <= 0 then
        raise exception 'El monto del vuelto debe ser mayor a cero' using errcode = 'PT400';
      end if;
      if v_change_ves > v_amount_ves then
        raise exception 'El vuelto (Bs %) no puede superar el monto recibido en esta línea (Bs %)',
          v_change_ves, v_amount_ves using errcode = 'PT400';
      end if;
    end if;

    -- A la venta se aplica el NETO recibido, no lo entregado por el cliente.
    v_net_ves := round(v_amount_ves - v_change_ves, 2);

    -- F2 — el neto no puede superar el saldo pendiente de la venta.
    --
    -- Sin saldo pendiente no hay nada que cobrar: ahí es donde se colaba el
    -- doble cobro (dos pagos idénticos dejaban `paid_ves` en 2x `total_ves`).
    --
    -- Con saldo pendiente sí hay una holgura legítima: el "redondeo a favor"
    -- (docs/cobro-pos-billetes.md §2). El cliente entrega billetes y el vuelto
    -- exacto casi nunca se puede armar, así que la gaveta se queda con la
    -- diferencia. Ese sobrante nunca supera el billete más pequeño de la moneda
    -- con la que se salda el resto:
    --   · vuelto en Bs. (efectivo o bancario) → Bs 10, el billete más chico;
    --     `greatest(10, 0.01 * rate)` mantiene el piso aun con tasas altas.
    --   · efectivo USD sin vuelto, o vuelto en efectivo USD → el ajuste fino es
    --     de $1 (no hay monedas), o sea `rate` bolívares.
    -- Cualquier exceso mayor es un monto errado, no un redondeo.
    v_outstanding_ves := round(v_sale.total_ves - coalesce(v_sale.paid_ves, 0), 2);
    if v_outstanding_ves <= 0.01 then
      raise exception 'La venta no tiene saldo pendiente: ya está cobrada (saldo pendiente: Bs %)',
        greatest(v_outstanding_ves, 0) using errcode = 'PT400';
    end if;
    v_overpay_tolerance := greatest(10, round(0.01 * v_rate, 2));
    if v_change_method = 'efectivo_usd'
       or (v_change_method is null and p_method = 'efectivo_usd') then
      v_overpay_tolerance := greatest(v_overpay_tolerance, round(v_rate, 2));
    end if;
    if v_net_ves > v_outstanding_ves + v_overpay_tolerance then
      raise exception 'El pago excede el saldo pendiente de la venta. Saldo pendiente: Bs %, neto del pago: Bs %',
        v_outstanding_ves, v_net_ves using errcode = 'PT400';
    end if;

    update public.sales set paid_ves = paid_ves + v_net_ves,
      status = case when paid_ves + v_net_ves >= total_ves then 'pagada'::public.sale_status else 'pendiente_pago'::public.sale_status end
    where id = p_sale_id returning paid_ves into v_paid_ves;
  else
    if public.current_user_role() not in ('admin', 'contador') then
      raise exception 'No autorizado para registrar pagos a proveedores' using errcode = 'PT403';
    end if;
    select * into v_purchase from public.purchases where id = p_purchase_id and store_id = v_store_id for update;
    if not found then raise exception 'Compra no encontrada' using errcode = 'PT404'; end if;
    -- C8 (rama de compras) — una compra cancelada o devuelta no admite pagos.
    if v_purchase.status in ('cancelado', 'devuelto') then
      raise exception 'No se puede registrar un pago en una compra cancelada o devuelta' using errcode = 'PT409';
    end if;
    v_direction := 'salida'; v_contact_id := v_purchase.supplier_id;
    select rate_ves into v_rate from public.exchange_rates where store_id = v_store_id order by created_at desc limit 1;
    if v_rate is null or v_rate <= 0 then v_rate := v_purchase.ref_rate_ves; end if;
    if p_method = 'efectivo_usd' then
      v_currency := 'USD'; v_amount_ref := round(p_amount, 2); v_amount_ves := round(p_amount * v_rate, 2);
    else
      v_currency := 'VES'; v_amount_ves := round(p_amount, 2); v_amount_ref := round(p_amount / v_rate, 2);
    end if;

    -- F3 — un pago a proveedor no puede superar el saldo pendiente de la factura.
    -- Aquí no hay vuelto ni billetes que redondear: la única holgura es el
    -- centavo de bolívar que puede aportar el redondeo de la conversión.
    v_outstanding_ves := round(v_purchase.total_ves - coalesce(v_purchase.paid_ves, 0), 2);
    if v_amount_ves > v_outstanding_ves + 0.01 then
      raise exception 'El pago excede el saldo pendiente de la compra. Saldo pendiente: Bs %, monto del pago: Bs %',
        v_outstanding_ves, v_amount_ves using errcode = 'PT400';
    end if;

    update public.purchases set paid_ves = paid_ves + v_amount_ves, paid_ref = paid_ref + v_amount_ref
    where id = p_purchase_id returning paid_ves, paid_ref into v_paid_ves, v_paid_ref;
  end if;

  -- F5 — los desgloses de billetes tienen que describir el dinero real.
  if p_received_denominations is not null then
    if p_method not in ('efectivo_ves', 'efectivo_usd') then
      raise exception 'El desglose de billetes recibidos solo aplica a pagos en efectivo'
        using errcode = 'PT400';
    end if;
    perform public.assert_payment_denominations(
      p_received_denominations,
      case when p_method = 'efectivo_usd' then 'USD' else 'VES' end,
      case when p_method = 'efectivo_usd' then v_amount_ref else v_amount_ves end,
      'recibidos'
    );
  end if;

  if p_change_denominations is not null then
    if v_change_method is null then
      raise exception 'No se puede enviar un desglose de billetes del vuelto si no hay vuelto'
        using errcode = 'PT400';
    end if;
    if v_change_method not in ('efectivo_ves', 'efectivo_usd') then
      raise exception 'El desglose de billetes del vuelto solo aplica a vueltos en efectivo'
        using errcode = 'PT400';
    end if;
    perform public.assert_payment_denominations(
      p_change_denominations,
      case when v_change_method = 'efectivo_usd' then 'USD' else 'VES' end,
      case when v_change_method = 'efectivo_usd' then v_change_ref else v_change_ves end,
      'del vuelto'
    );
  end if;

  insert into public.payments (
    direction, sale_id, purchase_id, contact_id, method, currency, amount, amount_ves, amount_ref,
    ref_rate_ves, bank_name, phone, reference_code, notes, created_by, store_id,
    change_method, change_amount, change_ves, change_ref,
    received_denominations, change_denominations
  ) values (
    v_direction, p_sale_id, p_purchase_id, v_contact_id, p_method, v_currency, p_amount, v_amount_ves, v_amount_ref,
    v_rate, nullif(trim(p_bank_name), ''), nullif(trim(p_phone), ''), p_reference_code, p_notes, auth.uid(), v_store_id,
    v_change_method, case when v_change_method is null then 0 else v_change_amount end, v_change_ves, v_change_ref,
    p_received_denominations, p_change_denominations
  ) returning * into v_payment;

  -- Efectivo venta → solo caja (físico).
  if p_method in ('efectivo_ves', 'efectivo_usd') and p_sale_id is not null then
    v_session := public.get_open_cash_session_for_user(auth.uid(), v_store_id);
    if v_session.id is null and public.current_user_role() in ('admin', 'contador') then
      select * into v_session from public.cash_sessions
      where store_id = v_store_id and status = 'open' order by opened_at desc limit 1;
    end if;
    if v_session.id is null then
      raise exception 'No puede registrar un pago en efectivo: no tiene una sesión de caja abierta en su caja asignada'
        using errcode = 'PT400';
    end if;
    v_movement_ves := case when p_method = 'efectivo_ves' then v_payment.amount_ves else 0 end;
    v_movement_ref := case when p_method = 'efectivo_usd' then v_payment.amount_ref else 0 end;
    insert into public.cash_movements (store_id, session_id, type, amount_ves, amount_ref, payment_id, notes, created_by)
    values (v_store_id, v_session.id, 'sale_in', v_movement_ves, v_movement_ref, v_payment.id,
      coalesce(nullif(trim(p_notes), ''), 'Pago en efectivo de venta'), auth.uid());

  -- Efectivo compra → baúl efectivo.
  elsif p_method in ('efectivo_ves', 'efectivo_usd') and p_purchase_id is not null then
    perform public.ensure_store_vault(v_store_id);
    select * into v_vault from public.store_vaults where store_id = v_store_id for update;
    v_movement_ves := case when p_method = 'efectivo_ves' then v_payment.amount_ves else 0 end;
    v_movement_ref := case when p_method = 'efectivo_usd' then v_payment.amount_ref else 0 end;
    if (p_method = 'efectivo_ves' and v_vault.balance_efectivo_ves < v_movement_ves)
       or (p_method = 'efectivo_usd' and v_vault.balance_ref < v_movement_ref) then
      if p_method = 'efectivo_ves' then
        raise exception 'Saldo insuficiente en el baul (efectivo). Faltante VES: %',
          greatest(v_movement_ves - v_vault.balance_efectivo_ves, 0) using errcode = 'PT402';
      else
        raise exception 'Saldo insuficiente en el baul. Faltante REF: %',
          greatest(v_movement_ref - v_vault.balance_ref, 0) using errcode = 'PT402';
      end if;
    end if;
    update public.store_vaults
    set balance_efectivo_ves = balance_efectivo_ves - v_movement_ves,
        balance_ref = balance_ref - v_movement_ref
    where id = v_vault.id;
    insert into public.vault_movements (
      store_id, vault_id, type, bucket, amount_ves, amount_ref, payment_id, notes, created_by
    ) values (
      v_store_id, v_vault.id, 'purchase_out', 'efectivo', v_movement_ves, v_movement_ref, v_payment.id,
      coalesce(nullif(trim(p_notes), ''), 'Pago en efectivo a proveedor'), auth.uid()
    );

  -- Cuenta (PM / transferencia / punto) venta → caja account_in + baúl cuenta.
  elsif v_is_bank and p_sale_id is not null then
    v_session := public.get_open_cash_session_for_user(auth.uid(), v_store_id);
    if v_session.id is null and public.current_user_role() in ('admin', 'contador') then
      select * into v_session from public.cash_sessions
      where store_id = v_store_id and status = 'open' order by opened_at desc limit 1;
    end if;
    if v_session.id is null then
      raise exception 'No puede registrar pago móvil/transferencia/punto: no hay sesión de caja abierta'
        using errcode = 'PT400';
    end if;
    insert into public.cash_movements (store_id, session_id, type, amount_ves, amount_ref, payment_id, notes, created_by)
    values (v_store_id, v_session.id, 'account_in', v_payment.amount_ves, 0, v_payment.id,
      coalesce(nullif(trim(p_notes), ''), 'Cobro en cuenta (' || p_method::text || ')'), auth.uid());
    perform public.ensure_store_vault(v_store_id);
    select * into v_vault from public.store_vaults where store_id = v_store_id for update;
    update public.store_vaults
    set balance_ves = balance_ves + v_payment.amount_ves
    where id = v_vault.id;
    insert into public.vault_movements (
      store_id, vault_id, type, bucket, amount_ves, amount_ref, payment_id, notes, created_by
    ) values (
      v_store_id, v_vault.id, 'sale_in', 'cuenta', v_payment.amount_ves, 0, v_payment.id,
      coalesce(nullif(trim(p_notes), ''), 'Ingreso a cuenta por venta (' || p_method::text || ')'), auth.uid()
    );

  -- Cuenta compra → baúl cuenta (sin caja).
  elsif v_is_bank and p_purchase_id is not null then
    perform public.ensure_store_vault(v_store_id);
    select * into v_vault from public.store_vaults where store_id = v_store_id for update;
    if v_vault.balance_ves < v_payment.amount_ves then
      raise exception 'Saldo insuficiente en el baul (cuenta). Faltante VES: %',
        greatest(v_payment.amount_ves - v_vault.balance_ves, 0) using errcode = 'PT402';
    end if;
    update public.store_vaults
    set balance_ves = balance_ves - v_payment.amount_ves
    where id = v_vault.id;
    insert into public.vault_movements (
      store_id, vault_id, type, bucket, amount_ves, amount_ref, payment_id, notes, created_by
    ) values (
      v_store_id, v_vault.id, 'purchase_out', 'cuenta', v_payment.amount_ves, 0, v_payment.id,
      coalesce(nullif(trim(p_notes), ''), 'Pago a proveedor desde cuenta (' || p_method::text || ')'), auth.uid()
    );
  end if;

  -- Asiento del vuelto (docs/cobro-pos-billetes.md §3.4 y §6).
  if v_change_method is not null then
    if v_session.id is null then
      raise exception 'No puede registrar el vuelto: no hay sesión de caja abierta' using errcode = 'PT400';
    end if;
    v_change_notes := coalesce(
      nullif(trim(p_notes), ''),
      'Vuelto de venta (' || v_change_method::text || ')'
    );

    if v_change_method in ('efectivo_ves', 'efectivo_usd') then
      -- F1 — el vuelto en efectivo sale de la gaveta: solo se puede entregar lo
      -- que la gaveta tiene. Se recalcula el efectivo físico de la sesión con la
      -- misma fórmula de `close_cash_session` (el `sale_in` de ESTE pago ya está
      -- escrito en esta transacción y, con razón, cuenta como disponible).
      select round(v_session.opening_ves + coalesce(sum(case
               when type in ('sale_in', 'adjustment') then amount_ves
               when type in ('transfer_out', 'refund_out', 'change_out') then -amount_ves else 0 end), 0), 2),
             round(v_session.opening_ref + coalesce(sum(case
               when type in ('sale_in', 'adjustment') then amount_ref
               when type in ('transfer_out', 'refund_out', 'change_out') then -amount_ref else 0 end), 0), 2)
      into v_cash_ves, v_cash_ref
      from public.cash_movements where session_id = v_session.id;

      if v_change_method = 'efectivo_ves' and v_change_ves > v_cash_ves then
        raise exception 'No hay suficiente efectivo en la caja para entregar el vuelto. Disponible: Bs %, vuelto: Bs %',
          v_cash_ves, v_change_ves using errcode = 'PT400';
      end if;
      if v_change_method = 'efectivo_usd' and v_change_ref > v_cash_ref then
        raise exception 'No hay suficiente efectivo en la caja para entregar el vuelto. Disponible: $ %, vuelto: $ %',
          v_cash_ref, v_change_ref using errcode = 'PT400';
      end if;

      -- Sale de la gaveta: en Bs. o en USD. El baúl no se toca.
      insert into public.cash_movements (store_id, session_id, type, amount_ves, amount_ref, payment_id, notes, created_by)
      values (
        v_store_id, v_session.id, 'change_out',
        case when v_change_method = 'efectivo_ves' then v_change_ves else 0 end,
        case when v_change_method = 'efectivo_usd' then v_change_ref else 0 end,
        v_payment.id, v_change_notes, auth.uid()
      );
    elsif v_change_is_bank then
      -- Sale de la cuenta bancaria: caja lo refleja y el baúl (cubeta cuenta) baja.
      insert into public.cash_movements (store_id, session_id, type, amount_ves, amount_ref, payment_id, notes, created_by)
      values (v_store_id, v_session.id, 'account_out', v_change_ves, 0, v_payment.id, v_change_notes, auth.uid());

      perform public.ensure_store_vault(v_store_id);
      select * into v_vault from public.store_vaults where store_id = v_store_id for update;
      if v_vault.balance_ves < v_change_ves then
        raise exception 'Saldo insuficiente en el baul (cuenta) para entregar el vuelto. Faltante VES: %',
          greatest(v_change_ves - v_vault.balance_ves, 0) using errcode = 'PT402';
      end if;
      update public.store_vaults
      set balance_ves = balance_ves - v_change_ves
      where id = v_vault.id;
      insert into public.vault_movements (
        store_id, vault_id, type, bucket, amount_ves, amount_ref, payment_id, notes, created_by
      ) values (
        v_store_id, v_vault.id, 'withdrawal', 'cuenta', v_change_ves, 0, v_payment.id,
        v_change_notes, auth.uid()
      );
    end if;
  end if;

  return v_payment;
end;
$$;

revoke all on function public.register_payment(
  uuid, uuid, public.payment_method, numeric, text, text, text, text,
  public.payment_method, numeric, jsonb, jsonb
) from public, anon;
grant execute on function public.register_payment(
  uuid, uuid, public.payment_method, numeric, text, text, text, text,
  public.payment_method, numeric, jsonb, jsonb
) to authenticated, service_role;

commit;

notify pgrst, 'reload schema';
