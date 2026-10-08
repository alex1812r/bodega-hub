-- =============================================================================
-- 20261010b — create_purchase rechaza las lineas de un producto inactivo
--             (COM-15; plan ux-mejoras, Ola 1; §0b "producto inactivo acepta
--             compras y ajustes", parte de compras)
-- Proyecto: BodegaHub
-- Requiere: 20261006c / f / h, 20261007a, 20261009d, 20261009e y 20261010a
--           (create_purchase con el vinculo automatico proveedor-producto).
--
-- REDEFINE public.create_purchase (misma firma de 14 argumentos). PARTE DE LA
-- VERSION DE 20261010a: copia literal de su cuerpo (IVA por tax_rate_code,
-- receta de empaque por componentes, idempotencia por p_client_request_id,
-- documento -> productos "order by id for update", guardas de formato y de NaN,
-- proveedor activo con PT400 y vinculo automatico por linea) mas UNA guarda. No
-- define ninguna otra funcion ni toca tablas, indices, politicas o triggers.
--
--   1. Producto inactivo. Hasta hoy una compra (recibida o en pedido) aceptaba
--      lineas de un producto con products.is_active = false: entraba stock a un
--      producto que no se puede vender. Desde aqui, si alguna linea es de un
--      producto inactivo de la tienda la compra se rechaza entera con PT400,
--      en espanol y nombrando el producto:
--        "El producto X está inactivo: no se puede registrar la compra"
--        "Los productos X, Y están inactivos: no se puede registrar la compra"
--      Nada se crea: ni compra, ni lineas, ni movimientos, ni vinculo, ni
--      empaque del proveedor, ni historial de costo.
--   2. Sin carrera con la desactivacion. La guarda va DESPUES de bloquear todos
--      los productos de la compra ("order by id for update"): quien desactiva
--      el producto espera a que la compra termine, y la compra que espera a una
--      desactivacion en curso ve el producto ya inactivo y se rechaza.
--   3. PT400 y no PT404. create_sale responde PT404 "Producto no encontrado o
--      inactivo: <uuid>" porque busca el producto con is_active = true y no
--      distingue los dos casos. Aqui el producto existe y se nombra: se sigue la
--      convencion de esta misma funcion para el proveedor inactivo (PT400, "El
--      proveedor X está inactivo: no se puede registrar la compra"). El producto
--      inexistente o de otra tienda sigue respondiendo PT404 como hasta hoy.
--   4. Reintento idempotente. La repeticion de un p_client_request_id ya
--      guardado devuelve la compra original ANTES de la guarda, aunque el
--      producto se haya desactivado despues: el reintento no cambia.
--   5. receive_purchase NO se toca (sigue en la version de 20261006c): recibir un
--      pedido cuyo producto se desactivo despues de pedirlo se PERMITE (la
--      mercancia ya viene en camino; rechazarla dejaria el pedido atascado).
--
-- NO cambia la semantica monetaria ni de stock: para una compra de productos
-- activos, mismas lineas, quantity_delta, costo del producto, totales y vinculos
-- que con 20261010a. No escribe el stock de products: lo mueve el trigger del
-- libro.
--
-- OJO: si se reaplica 20261006c, 20261006f, 20261006h, 20261007a, 20261009d o
-- 20261010a (todos redefinen create_purchase) HAY QUE REAPLICAR 20261010b y
-- correr verify-patches.sql. Reaplicar 20261009e no lo exige.
-- Idempotente, una sola transaccion. Ejecutar en SQL Editor o via db-up.
-- =============================================================================

begin;

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
  v_tax_rate_code text;
  v_tax_rate_pct numeric(5,2);
  v_line_tax_ref numeric(14,2);
  v_line_tax_ves numeric(14,2);
  v_cost_currency text;
  v_pair_units integer;
  v_unit_pack_sizes integer[];
  v_request_hash text;
  v_number_seq bigint;
  v_rows integer;
  v_constraint text;
  v_supplier_name text;
  v_supplier_type public.contact_type;
  v_supplier_active boolean;
  v_sp_active boolean;
  v_sp_is_new boolean;
  v_new_sp_ids uuid[] := '{}';
  v_inactive_names text;
  v_inactive_count integer;
begin
  v_store_id := public.assert_store_context();
  -- N4 — NaN / Infinity no son menores que 0 y atravesaban las guardas de abajo.
  perform public.assert_finite_numeric(p_ref_rate_ves, 'la tasa ref/VES');
  perform public.assert_finite_numeric(p_discount_ref, 'el descuento');
  perform public.assert_finite_numeric(p_tax_ref, 'el impuesto');
  perform public.assert_finite_numeric(p_discount_ves, 'el descuento en Bs');
  perform public.assert_finite_numeric(p_tax_ves, 'el impuesto en Bs');
  perform public.assert_finite_numeric(p_subtotal_ves, 'el subtotal en Bs');
  perform public.assert_finite_numeric(p_subtotal_ref, 'el subtotal');

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

  -- R6 — forma de cada linea antes de convertirla: un uuid, un entero o un
  -- monto mal escritos salian como 22P02 crudo. Las cantidades se miran segun
  -- el modo de la linea, igual que en el bucle de abajo.
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item) is distinct from 'object'
       or coalesce(v_item ->> 'product_id', '') !~ '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$' then
      raise exception using errcode = 'PT400', message = 'Identificador de producto invalido en item de compra';
    end if;

    v_entry_mode := coalesce(nullif(trim(v_item ->> 'entry_mode'), ''), 'unit');

    if exists (
      select 1
      from unnest(
        array['unit_cost_ref', 'unit_cost_ves', 'subtotal_ref', 'subtotal_ves', 'tax_rate', 'tax_ref', 'tax_ves']
        || case when v_entry_mode = 'pack' then array['pack_cost_ref', 'pack_cost_ves'] else array[]::text[] end
      ) as k(name)
      where (v_item ->> k.name) is not null
        and (v_item ->> k.name) !~ '^-?[0-9]{1,12}([.][0-9]+)?$'
    ) then
      raise exception using errcode = 'PT400', message = 'Montos invalidos en item de compra';
    end if;

    if exists (
      select 1
      from unnest(
        case when v_entry_mode = 'pack' then array['pack_count', 'units_per_pack'] else array['quantity'] end
      ) as k(name)
      where (v_item ->> k.name) is not null
        and (v_item ->> k.name) !~ '^-?[0-9]{1,9}$'
    ) then
      raise exception using errcode = 'PT400', message = 'Cantidad invalida en item de compra';
    end if;
  end loop;

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

  -- COM-02 — el proveedor debe ser de la tienda, estar activo y ser proveedor / ambos.
  -- Son las reglas de siempre (assert_contact_type + tienda), ahora con PT400 y
  -- mensaje propio: antes el inactivo y el que no es proveedor salian sin errcode.
  -- FOR SHARE: quien desactiva al proveedor o lo deja solo como cliente espera a
  -- que esta compra termine, y la compra ve su estado confirmado (la compra no
  -- deja un vinculo nuevo con un proveedor que se desactivo a mitad).
  select c.name, c.type, c.is_active
  into v_supplier_name, v_supplier_type, v_supplier_active
  from public.contacts c
  where c.id = p_supplier_id
    and c.store_id = v_store_id
  for share;

  if not found then
    if exists (select 1 from public.contacts where id = p_supplier_id and is_active) then
      raise exception using errcode = 'PT400', message = 'Contacto no pertenece a tu tienda';
    end if;

    raise exception using errcode = 'PT400', message = 'Proveedor no encontrado';
  end if;

  if not v_supplier_active then
    raise exception using
      errcode = 'PT400',
      message = format('El proveedor %s está inactivo: no se puede registrar la compra', v_supplier_name);
  end if;

  if v_supplier_type::text not in ('proveedor', 'ambos') then
    raise exception using
      errcode = 'PT400',
      message = format('El contacto %s no es proveedor: no se puede registrar la compra', v_supplier_name);
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

  -- COM-15 — ninguna linea puede ser de un producto inactivo, ni en una compra
  -- recibida ni en un pedido. Se mira con los productos ya bloqueados: desactivar
  -- uno espera a que esta compra termine y, si la desactivacion llego antes, aqui
  -- ya se ve. Al lanzar, la transaccion deshace la compra insertada arriba.
  select count(*), string_agg(p.name, ', ' order by p.name, p.id)
  into v_inactive_count, v_inactive_names
  from public.products p
  where p.id = any(v_product_ids)
    and p.store_id = v_store_id
    and p.is_active is not true;

  if v_inactive_count = 1 then
    raise exception using
      errcode = 'PT400',
      message = format('El producto %s está inactivo: no se puede registrar la compra', v_inactive_names);
  elsif v_inactive_count > 1 then
    raise exception using
      errcode = 'PT400',
      message = format('Los productos %s están inactivos: no se puede registrar la compra', v_inactive_names);
  end if;

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

    -- SHR-10 — el IVA de la linea sale del catalogo tax_rates (alicuotas de la
    -- tienda: propias + globales). Con tax_rate_code manda la alicuota y su pct
    -- es el snapshot de la linea; con solo tax_rate (clientes anteriores) el
    -- porcentaje debe ser el de una alicuota activa y se guarda su code. Un
    -- tax_rate ausente o fuera de 0..100 lo siguen rechazando las guardas de abajo.
    v_tax_rate_code := nullif(trim(v_item ->> 'tax_rate_code'), '');

    if v_tax_rate_code is not null then
      select t.pct into v_tax_rate_pct
      from public.tax_rates_for_store(v_store_id) t
      where t.code = v_tax_rate_code
        and t.is_active;

      if not found then
        raise exception using
          errcode = 'PT400',
          message = format('La alicuota de IVA "%s" no existe o no esta activa en tu tienda', v_tax_rate_code);
      end if;

      if v_tax_rate is not null and v_tax_rate <> v_tax_rate_pct then
        raise exception using
          errcode = 'PT400',
          message = format(
            'El porcentaje de IVA enviado (%s %%) no coincide con la alicuota "%s" (%s %%)',
            v_tax_rate, v_tax_rate_code, v_tax_rate_pct
          );
      end if;

      v_tax_rate := v_tax_rate_pct;
    elsif v_tax_rate is not null and v_tax_rate >= 0 and v_tax_rate <= 100 then
      select t.code into v_tax_rate_code
      from public.tax_rate_for_pct(v_store_id, v_tax_rate, true) t;

      if not found then
        raise exception using
          errcode = 'PT400',
          message = format('El porcentaje de IVA %s %% no corresponde a ninguna alicuota activa', v_tax_rate);
      end if;
    end if;

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

      -- C13 — si el producto pertenece a una receta empaque -> unidad activa, las
      -- unidades por empaque las fija la receta, no el cliente.
      -- PRO-12 — lado unidad: recetas activas de las que el producto es el UNICO
      -- componente (sus unidades son las del empaque). Puede salir de varios
      -- empaques: valen las unidades de cualquiera de ellos.
      select array_agg(distinct pc.units_per_pack order by pc.units_per_pack) into v_unit_pack_sizes
      from public.product_pack_components pc
      join public.product_pack_conversions c on c.id = pc.conversion_id
      where pc.unit_product_id = v_product_id
        and c.store_id = v_store_id
        and c.is_active = true
        and pc.units_per_pack = c.total_units;

      if v_unit_pack_sizes is not null then
        -- El producto es la UNIDAD del par: entran pack_count x unidades del par.
        if not (v_units_per_pack = any(v_unit_pack_sizes)) then
          raise exception using
            errcode = 'PT400',
            message = format(
              'Las unidades por empaque enviadas (%s) no coinciden con la conversion registrada del producto (%s)',
              v_units_per_pack, array_to_string(v_unit_pack_sizes, ', ')
            );
        end if;

        v_quantity := v_pack_count * v_units_per_pack;
      else
        -- PRO-12 — lado empaque: total de unidades de su receta activa (1 a 1 o surtida).
        select c.total_units into v_pair_units
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
      cost_currency,
      tax_rate_code
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
      v_cost_currency,
      v_tax_rate_code
    );

    -- COM-02 — vinculo proveedor-producto de la linea. El producto ya esta
    -- bloqueado: nadie mas crea, reactiva ni desactiva sus vinculos mientras tanto.
    select id, last_cost_ref, last_cost_ves, is_active
    into v_sp_id, v_old_cost_ref, v_old_cost_ves, v_sp_active
    from public.supplier_products
    where supplier_id = p_supplier_id
      and product_id = v_product_id
      and store_id = v_store_id;

    v_sp_is_new := v_sp_id is null;

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

      -- Camino de siempre: crea el vinculo que falte, reactiva el inactivo y
      -- registra el costo de la linea con origen 'compra'.
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
    elsif v_sp_is_new then
      -- COM-02 — pedido de un producto que el proveedor no tenia: el vinculo nace
      -- con el costo de la linea (con IVA, como al recibir). Todavia no es una
      -- compra recibida: origen 'vinculacion' y sin fecha de ultima compra;
      -- receive_purchase registrara el costo con origen 'compra'.
      insert into public.supplier_products (
        supplier_id,
        product_id,
        supplier_sku,
        last_cost_ref,
        last_cost_ves,
        store_id
      )
      values (
        p_supplier_id,
        v_product_id,
        v_supplier_sku,
        v_cost_with_tax_ref,
        v_cost_with_tax_ves,
        v_store_id
      )
      returning id into v_sp_id;

      perform public.append_supplier_product_price_history(
        v_sp_id,
        null,
        null,
        v_cost_with_tax_ref,
        v_cost_with_tax_ves,
        'vinculacion',
        'Pedido ' || v_purchase.purchase_number
      );
    elsif not v_sp_active then
      -- COM-02 — pedido sobre un vinculo desactivado: se reactiva (lo mismo que
      -- hace la recepcion) sin tocar su costo ni su historial.
      update public.supplier_products
      set is_active = true,
          updated_at = now()
      where id = v_sp_id
        and store_id = v_store_id;
    end if;

    if v_sp_is_new then
      v_new_sp_ids := v_new_sp_ids || v_sp_id;
    end if;

    -- COM-02 — linea por empaque sobre un vinculo creado en ESTA compra: su
    -- empaque queda en el catalogo del proveedor; el primero es el
    -- predeterminado. Un vinculo que ya existia conserva sus empaques tal cual.
    if v_entry_mode = 'pack'
       and v_sp_id = any(v_new_sp_ids)
       and not exists (
         select 1
         from public.supplier_product_pack_units u
         where u.supplier_product_id = v_sp_id
           and u.units_per_pack = v_units_per_pack
           and lower(u.label) = lower(v_pack_label)
       ) then
      insert into public.supplier_product_pack_units (
        supplier_product_id,
        label,
        units_per_pack,
        is_default
      )
      values (
        v_sp_id,
        v_pack_label,
        v_units_per_pack,
        not exists (
          select 1
          from public.supplier_product_pack_units u
          where u.supplier_product_id = v_sp_id
            and u.is_default
            and u.is_active
        )
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
exception
  -- R6 — tasa, costos, empaques x unidades o totales que no caben en sus columnas.
  when numeric_value_out_of_range then
    raise exception using
      errcode = 'PT400',
      message = 'Alguna cantidad o monto de la compra esta fuera del rango permitido';
  -- R6 — numero de compra repetido en la tienda. Cualquier otro choque sigue igual.
  when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'purchases_store_number_unique' then
      raise exception using
        errcode = 'PT409',
        message = format('Ya existe una compra con el numero %s', p_purchase_number);
    end if;
    raise;
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

commit;

notify pgrst, 'reload schema';
