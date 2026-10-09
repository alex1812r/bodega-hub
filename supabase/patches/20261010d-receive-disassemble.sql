-- =============================================================================
-- 20261010d — desarmar al recibir: la linea de compra de un empaque con receta
--             se abre en sus componentes en la misma transaccion que la recibe
--             (COM-14; plan ux-mejoras, Ola 1; reglas 7 y 9)
-- Proyecto: BodegaHub
-- Requiere: 20261006a (assert_store_context, libro de stock), 20261006c
--           (receive_purchase vigente, stock_request_hash), 20261009d
--           (receta de empaque por componentes y convert_pack_to_units de 5
--           argumentos), 20261010a y 20261010b (create_purchase vigente).
--
--   1. Modelo.
--        * purchase_items.disassemble_on_receive boolean not null default
--          false: la marca "Desarmar al recibir" de la linea. La escribe
--          create_purchase desde el payload y la puede cambiar la recepcion.
--        * purchase_items.disassembled_conversion_id uuid null: el
--          conversion_id (stock_movements.conversion_id) de la apertura que
--          hizo la recepcion. NULL = la linea no se desarmo.
--        * purchases.receive_client_request_id / receive_request_hash: clave
--          de idempotencia de la recepcion y huella de lo que se pidio.
--      Una linea marcada de una compra recibida SIEMPRE tiene su
--      disassembled_conversion_id: no existe el estado "pendiente de desarmar".
--   2. Camino elegido: ATOMICO en los dos sitios (sin compensacion).
--        * Pedido que se recibe: RPC nueva
--          receive_purchase_and_disassemble(p_purchase_id, p_disassemble,
--          p_client_request_id). En UNA transaccion llama a receive_purchase y
--          despues a convert_pack_to_units por cada linea marcada. No
--          reimplementa ninguna de las dos: las invoca.
--        * Compra que nace recibida: create_purchase (misma firma de 14
--          argumentos) invoca convert_pack_to_units por cada linea marcada al
--          final de su propia transaccion. Se eligio esto y no "crear y luego
--          desarmar en una segunda llamada" porque create_purchase ya se
--          redefine aqui para guardar la marca, la segunda llamada exigiria un
--          estado pendiente, su boton y su ruta, y asi el reintento idempotente
--          de la compra (p_client_request_id) cubre tambien el desarme.
--      Si una apertura falla (receta desactivada, incompleta, reparto que no
--      suma) se revierte TODO: ni compra recibida ni stock movido, y el PT4xx
--      llega al usuario.
--   3. Semantica de stock y costo SIN cambios (regla 9). El resultado es el de
--      "recibir" y despues "abrir N empaques" a mano: N = quantity de la linea
--      (lo que entro al stock del empaque), costo del empaque = el que dejo la
--      recepcion, reparto y promedio ponderado de convert_pack_to_units. El
--      empaque queda con stock neto 0 (+N compra, -N conversion_salida) y cada
--      componente sube lo de la receta o lo del reparto enviado.
--   4. Bloqueos. convert_pack_to_units bloquea la cabecera de la receta y luego
--      empaque + componentes por id; receive_purchase y create_purchase
--      bloquean documento y luego los productos de la compra por id. Encadenadas
--      tal cual, los componentes se bloquearian DESPUES de productos de id
--      mayor y la cabecera despues de los productos. Por eso, antes de llamar a
--      ninguna, purchase_disassemble_lock bloquea: cabeceras de las recetas
--      (order by id) y despues TODOS los productos implicados (los de la compra
--      + los componentes) en una sentencia "order by id for update". Orden
--      global: documento -> cabeceras de receta -> productos por id.
--   5. Idempotencia.
--        * Recepcion: con p_client_request_id, repetir la misma llamada devuelve
--          la compra ya recibida sin mover nada; la misma clave con otro
--          contenido es PT409. Sin clave (o con otra), recibir dos veces es
--          PT409 "Solo se pueden recibir compras en estado pedido", como hoy.
--        * Cada apertura lleva una clave DERIVADA de la linea
--          (purchase_disassemble_request_id = md5 de su id): una linea de compra
--          no se puede desarmar dos veces por este camino aunque cambie la
--          clave de la recepcion.
--   6. create_purchase: copia integra de 20261010b mas:
--        * disassemble_on_receive por linea (booleano JSON opcional; otra cosa
--          es PT400). Ausente o false = la compra de siempre: mismo resultado y
--          misma huella de idempotencia (el BFF solo envia la clave cuando es
--          true).
--        * una linea marcada exige que su producto sea el empaque de una receta
--          ACTIVA; si no, PT400 nombrando el producto (pedido o recibida).
--        * la marca se guarda en la linea; si la compra nace recibida, se
--          bloquea como en el punto 4 y se abre al final.
--   7. receive_purchase y convert_pack_to_units NO se redefinen.
--   8. Receta desactivada entre el pedido y la recepcion: la recepcion responde
--      PT409 nombrando el producto y no recibe nada. El usuario desmarca la
--      linea en la confirmacion (p_disassemble sin esa linea) o reactiva la
--      receta. Producto o componente inactivo: no se rechaza (igual que
--      receive_purchase y convert_pack_to_units).
--   9. Anular o devolver una compra desarmada: cancel_purchase / return_purchase
--      no cambian; retiran los empaques de la linea y, como ya se abrieron,
--      responden lo mismo que tras abrirlos a mano (stock insuficiente).
--
-- p_disassemble de receive_purchase_and_disassemble:
--   null              -> se desarman las lineas marcadas, con su receta.
--   [ {"purchase_item_id": uuid, "components": [{"unit_product_id": uuid,
--      "units": entero >= 0}] | null}, ... ]
--                     -> la lista ES el conjunto de lineas a desarmar (las demas
--                        quedan desmarcadas; [] = no desarmar ninguna).
--                        components es el reparto real de convert_pack_to_units
--                        (surtidos); sin el, la receta.
--
-- OJO: si se reaplica 20261006c, 20261006f, 20261006h, 20261007a, 20261009d,
-- 20261010a o 20261010b (todos redefinen create_purchase) HAY QUE REAPLICAR
-- 20261010d y correr verify-patches.sql.
-- Idempotente, una sola transaccion. Ejecutar en SQL Editor o via db-up.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Modelo
-- -----------------------------------------------------------------------------

alter table public.purchase_items
  add column if not exists disassemble_on_receive boolean not null default false,
  add column if not exists disassembled_conversion_id uuid;

comment on column public.purchase_items.disassemble_on_receive is
  'Marca "Desarmar al recibir": al recibir la compra, los empaques de la linea se abren en los componentes de su receta.';
comment on column public.purchase_items.disassembled_conversion_id is
  'conversion_id (stock_movements.conversion_id) de la apertura hecha al recibir. NULL = la linea no se desarmo.';

alter table public.purchases
  add column if not exists receive_client_request_id uuid,
  add column if not exists receive_request_hash text;

comment on column public.purchases.receive_client_request_id is
  'Clave de idempotencia de la recepcion (receive_purchase_and_disassemble).';
comment on column public.purchases.receive_request_hash is
  'Huella de lo pedido con receive_client_request_id. La misma clave con otra huella se rechaza.';

-- -----------------------------------------------------------------------------
-- 2. Funciones internas (no son RPC: sin execute para los roles de PostgREST)
-- -----------------------------------------------------------------------------

-- Clave de idempotencia de la apertura de UNA linea de compra: siempre la misma
-- para la misma linea.
create or replace function public.purchase_disassemble_request_id(p_purchase_item_id uuid)
returns uuid
language sql
immutable
set search_path = public
as $$
  select md5('purchase-disassemble:' || p_purchase_item_id::text)::uuid;
$$;

-- Nombres de los productos de p_pack_ids que existen en la tienda y NO son el
-- empaque de una receta activa (NULL si todos la tienen).
create or replace function public.purchase_disassemble_missing_recipes(
  p_store_id uuid,
  p_pack_ids uuid[]
)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select string_agg(p.name, ', ' order by p.name, p.id)
  from public.products p
  where p.id = any(p_pack_ids)
    and p.store_id = p_store_id
    and not exists (
      select 1
      from public.product_pack_conversions c
      where c.pack_product_id = p.id
        and c.store_id = p_store_id
        and c.is_active = true
    );
$$;

-- Bloqueos de una recepcion con desarme, ANTES de recibir y de abrir: las
-- cabeceras de las recetas activas de p_pack_ids (order by id) y despues, en una
-- sola sentencia y por id, p_product_ids + p_pack_ids + sus componentes.
create or replace function public.purchase_disassemble_lock(
  p_store_id uuid,
  p_pack_ids uuid[],
  p_product_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
begin
  perform 1
  from public.product_pack_conversions c
  where c.pack_product_id = any(p_pack_ids)
    and c.store_id = p_store_id
    and c.is_active = true
  order by c.id
  for update;

  select array_agg(distinct ids.id)
  into v_ids
  from (
    select unnest(coalesce(p_product_ids, '{}'::uuid[]) || coalesce(p_pack_ids, '{}'::uuid[])) as id
    union
    select pc.unit_product_id
    from public.product_pack_components pc
    join public.product_pack_conversions c on c.id = pc.conversion_id
    where c.pack_product_id = any(p_pack_ids)
      and c.store_id = p_store_id
      and c.is_active = true
  ) as ids;

  perform 1
  from public.products
  where id = any(v_ids)
    and store_id = p_store_id
  order by id
  for update;
end;
$$;

-- Abre los empaques de cada linea marcada y aun sin desarmar de una compra YA
-- recibida, invocando convert_pack_to_units (que valida rol, receta, reparto y
-- stock, reparte el costo y deja los movimientos). p_disassemble aporta el
-- reparto de las lineas que lo traigan. Quien llama ya tomo los bloqueos.
create or replace function public.purchase_disassemble_lines(
  p_purchase_id uuid,
  p_disassemble jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_purchase_number text;
  v_item public.purchase_items;
  v_components jsonb;
  v_result jsonb;
begin
  v_store_id := public.assert_store_context();

  select purchase_number into v_purchase_number
  from public.purchases
  where id = p_purchase_id
    and store_id = v_store_id
    and status = 'recibido';

  if not found then
    raise exception using errcode = 'PT409', message = 'Solo se desarman lineas de una compra recibida';
  end if;

  for v_item in
    select *
    from public.purchase_items
    where purchase_id = p_purchase_id
      and disassemble_on_receive
      and disassembled_conversion_id is null
    order by product_id, id
  loop
    select e.value -> 'components'
    into v_components
    from jsonb_array_elements(coalesce(p_disassemble, '[]'::jsonb)) as e(value)
    where e.value ->> 'purchase_item_id' = v_item.id::text;

    v_result := public.convert_pack_to_units(
      v_item.product_id,
      v_item.quantity,
      'Desarme al recibir ' || v_purchase_number,
      public.purchase_disassemble_request_id(v_item.id),
      v_components
    );

    update public.purchase_items
    set disassembled_conversion_id = (v_result ->> 'conversionId')::uuid
    where id = v_item.id;
  end loop;
end;
$$;

revoke all on function public.purchase_disassemble_request_id(uuid) from public, anon, authenticated;
revoke all on function public.purchase_disassemble_missing_recipes(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.purchase_disassemble_lock(uuid, uuid[], uuid[]) from public, anon, authenticated;
revoke all on function public.purchase_disassemble_lines(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.purchase_disassemble_request_id(uuid) to service_role;
grant execute on function public.purchase_disassemble_missing_recipes(uuid, uuid[]) to service_role;
grant execute on function public.purchase_disassemble_lock(uuid, uuid[], uuid[]) to service_role;
grant execute on function public.purchase_disassemble_lines(uuid, jsonb) to service_role;

-- -----------------------------------------------------------------------------
-- 3. create_purchase: 20261010b + marca de la linea y desarme de la compra que
--    nace recibida
-- -----------------------------------------------------------------------------

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
  v_disassemble_ids uuid[];
  v_missing_recipes text;
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

    -- COM-14 — la marca "Desarmar al recibir" es un booleano de JSON o no va.
    if v_item ? 'disassemble_on_receive'
       and jsonb_typeof(v_item -> 'disassemble_on_receive') is distinct from 'boolean' then
      raise exception using
        errcode = 'PT400',
        message = 'Marca de desarmar al recibir invalida en item de compra';
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

  -- COM-14 — productos de las lineas marcadas "Desarmar al recibir". Si la compra
  -- nace recibida, sus empaques se abren al final: las cabeceras de receta y los
  -- componentes se bloquean AQUI, junto con los productos de la compra y por id,
  -- antes que ningun otro producto (la sentencia de abajo repite el bloqueo de
  -- los que ya quedaron tomados).
  select array_agg(distinct (e.value ->> 'product_id')::uuid)
  into v_disassemble_ids
  from jsonb_array_elements(p_items) as e(value)
  where e.value -> 'disassemble_on_receive' = 'true'::jsonb;

  if v_disassemble_ids is not null and p_status = 'recibido' then
    perform public.purchase_disassemble_lock(v_store_id, v_disassemble_ids, v_product_ids);
  end if;

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

  -- COM-14 — una linea marcada exige que su producto sea el empaque de una receta
  -- activa, en un pedido y en una compra recibida. Un producto que no existe lo
  -- rechaza el bucle de abajo con su PT404.
  if v_disassemble_ids is not null then
    v_missing_recipes := public.purchase_disassemble_missing_recipes(v_store_id, v_disassemble_ids);

    if v_missing_recipes is not null then
      raise exception using
        errcode = 'PT400',
        message = format(
          'Sin receta de apertura activa: %s. No se puede marcar «Desarmar al recibir» en esas líneas',
          v_missing_recipes
        );
    end if;
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
      tax_rate_code,
      disassemble_on_receive
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
      v_tax_rate_code,
      coalesce((v_item -> 'disassemble_on_receive') = 'true'::jsonb, false)
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

  -- COM-14 — la compra nace recibida: los empaques de las lineas marcadas se
  -- abren ahora, en esta misma transaccion, invocando convert_pack_to_units. Si
  -- una apertura falla no queda ni la compra.
  if p_status = 'recibido' and v_disassemble_ids is not null then
    perform public.purchase_disassemble_lines(v_purchase.id, null);
  end if;

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

-- -----------------------------------------------------------------------------
-- 4. Recepcion de un pedido con desarme, atomica
-- -----------------------------------------------------------------------------

create or replace function public.receive_purchase_and_disassemble(
  p_purchase_id uuid,
  p_disassemble jsonb default null,
  p_client_request_id uuid default null
)
returns public.purchases
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_purchase public.purchases;
  v_request_hash text;
  v_entry jsonb;
  v_item_ids uuid[] := '{}';
  v_item_id uuid;
  v_pack_ids uuid[];
  v_product_ids uuid[];
  v_missing text;
begin
  v_store_id := public.assert_store_context();

  if coalesce(public.current_user_role()::text, '') not in ('admin', 'almacen') then
    raise exception using errcode = 'PT403', message = 'No autorizado para recibir compras';
  end if;

  -- Un null de JSON es lo mismo que no enviar la lista.
  if jsonb_typeof(p_disassemble) = 'null' then
    p_disassemble := null;
  end if;

  -- Documento primero. Su bloqueo serializa dos recepciones de la misma compra.
  select * into v_purchase
  from public.purchases
  where id = p_purchase_id
    and store_id = v_store_id
  for update;

  if not found then
    raise exception using errcode = 'PT404', message = 'Compra no encontrada';
  end if;

  v_request_hash := public.stock_request_hash(jsonb_build_array(
    'receive_purchase_and_disassemble', p_purchase_id, p_disassemble
  ));

  -- Reintento de la misma recepcion: la compra ya recibida, sin mover nada.
  if p_client_request_id is not null
     and v_purchase.receive_client_request_id = p_client_request_id then
    if v_purchase.receive_request_hash is distinct from v_request_hash
       or v_purchase.status <> 'recibido' then
      raise exception using
        errcode = 'PT409',
        message = 'La clave de idempotencia ya se uso en otra recepcion de esta compra. Revisa la compra antes de reintentar.';
    end if;

    return v_purchase;
  end if;

  -- Cualquier otro estado lo rechaza receive_purchase con su PT409 de siempre.
  if v_purchase.status <> 'pedido' then
    return public.receive_purchase(p_purchase_id);
  end if;

  if p_disassemble is not null then
    if jsonb_typeof(p_disassemble) <> 'array' then
      raise exception using
        errcode = 'PT400',
        message = 'La lista de lineas a desarmar debe ser una lista';
    end if;

    for v_entry in select value from jsonb_array_elements(p_disassemble)
    loop
      if jsonb_typeof(v_entry) is distinct from 'object'
         or jsonb_typeof(v_entry -> 'purchase_item_id') is distinct from 'string'
         or (v_entry ->> 'purchase_item_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception using
          errcode = 'PT400',
          message = 'Cada linea a desarmar requiere purchase_item_id';
      end if;

      v_item_id := (v_entry ->> 'purchase_item_id')::uuid;

      if v_item_id = any(v_item_ids) then
        raise exception using
          errcode = 'PT400',
          message = 'La lista de lineas a desarmar repite una linea';
      end if;

      if not exists (
        select 1
        from public.purchase_items
        where id = v_item_id
          and purchase_id = p_purchase_id
      ) then
        raise exception using
          errcode = 'PT400',
          message = 'Una linea a desarmar no pertenece a la compra';
      end if;

      v_item_ids := v_item_ids || v_item_id;
    end loop;

    -- La lista manda sobre la marca guardada con el pedido.
    update public.purchase_items
    set disassemble_on_receive = (id = any(v_item_ids))
    where purchase_id = p_purchase_id
      and disassemble_on_receive is distinct from (id = any(v_item_ids));
  end if;

  select
    array_agg(distinct product_id),
    array_agg(distinct product_id) filter (where disassemble_on_receive)
  into v_product_ids, v_pack_ids
  from public.purchase_items
  where purchase_id = p_purchase_id;

  if v_pack_ids is not null then
    -- Cabeceras de receta y TODOS los productos (compra + componentes) por id,
    -- antes de recibir: ni receive_purchase ni convert_pack_to_units toman
    -- despues un bloqueo fuera de orden.
    perform public.purchase_disassemble_lock(v_store_id, v_pack_ids, v_product_ids);

    v_missing := public.purchase_disassemble_missing_recipes(v_store_id, v_pack_ids);

    if v_missing is not null then
      raise exception using
        errcode = 'PT409',
        message = format(
          'Sin receta de apertura activa: %s. Desmarca «Desarmar al recibir» en esas líneas o activa su receta',
          v_missing
        );
    end if;
  end if;

  v_purchase := public.receive_purchase(p_purchase_id);

  if v_pack_ids is not null then
    perform public.purchase_disassemble_lines(p_purchase_id, p_disassemble);
  end if;

  if p_client_request_id is not null then
    update public.purchases
    set receive_client_request_id = p_client_request_id,
        receive_request_hash = v_request_hash
    where id = p_purchase_id
      and store_id = v_store_id
    returning * into v_purchase;
  end if;

  return v_purchase;
end;
$$;

revoke all on function public.receive_purchase_and_disassemble(uuid, jsonb, uuid) from public, anon;
grant execute on function public.receive_purchase_and_disassemble(uuid, jsonb, uuid) to authenticated, service_role;

commit;

notify pgrst, 'reload schema';
