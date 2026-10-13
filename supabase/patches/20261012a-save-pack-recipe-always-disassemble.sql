-- =============================================================================
-- 20261012a — la preferencia "Desarmar siempre al recibir compras" de la receta
--             se guarda por save_pack_recipe (INT-02; plan ux-mejoras, D40)
-- Proyecto: BodegaHub
-- Requiere: 20261010e (columna product_pack_conversions.always_disassemble_on_receive)
--           y 20261011c (save_pack_recipe).
--
-- 20261010e (COM-14) anadio la preferencia a la cabecera de la receta y el BFF
-- la escribia por tabla directa (PostgREST). 20261011d (INV-L2) revoca insert /
-- update / delete de authenticated sobre product_pack_conversions y
-- product_pack_components: desde entonces el unico camino de escritura de un
-- usuario es save_pack_recipe, que no conocia la columna. Peor: al reemplazar una
-- receta (cabecera nueva, la anterior inactiva) la RPC creaba la cabecera nueva
-- sin la preferencia y esta se perdia.
--
-- Firma (unica; la de 5 argumentos de 20261011c se ELIMINA):
--
--   public.save_pack_recipe(
--     p_pack_product_id uuid,
--     p_enabled         boolean,
--     p_total_units     integer default null,
--     p_label           text    default null,
--     p_components      jsonb   default null,
--     p_always_disassemble_on_receive boolean default null
--   ) returns jsonb
--
-- El cuerpo es el de 20261011c letra por letra (mismas validaciones, mismos
-- bloqueos en el mismo orden, mismos mensajes y mismas acciones) mas la
-- preferencia:
--   * null (o argumento ausente) = NO cambia: la receta editada en sitio conserva
--     la suya, la receta que REEMPLAZA a otra hereda la de la anterior y una
--     receta nueva nace en false. Las llamadas con 5 argumentos (BFF de INV-09,
--     fixtures, escenarios) siguen resolviendo y se comportan igual que antes,
--     salvo que el reemplazo ya no pierde la preferencia.
--   * true / false = la receta queda con ese valor, en cualquiera de los caminos
--     (misma receta, edicion en sitio, reemplazo, alta).
--   * p_enabled = false la ignora (la receta inactiva conserva su valor).
--   "action" no cambia de significado: describe productos, unidades y nombre. Un
--   guardado que solo cambia la preferencia responde "unchanged" y si escribe la
--   columna. El resultado anade "alwaysDisassembleOnReceive" (valor con el que
--   queda la receta activa; ausente al desactivar).
--
-- Contrato (docs/stock-integrity.md §1): security definer, search_path = public,
-- assert_store_context() primero, rol admin / almacen (PT403), errores PT400 /
-- PT403 / PT404 / PT409 en espanol. No toca stock, costo ni dinero. Ninguna otra
-- funcion lee la columna: create_purchase, receive_purchase,
-- receive_purchase_and_disassemble y convert_pack_to_units no cambian, y la marca
-- que decide el desarme sigue viajando por linea de compra (20261010d).
--
-- La LECTURA de la preferencia no cambia: el BFF la lee de la cabecera por
-- PostgREST con el select que authenticated conserva tras 20261011d.
--
-- ORDEN DE DESPLIEGUE: 20261010e -> 20261011c -> este parche -> verify -> BFF
-- nuevo -> 20261011d -> verify. El BFF de INV-09 (5 argumentos) funciona sobre la
-- base con este parche. El BFF nuevo sobre una base SIN este parche: guardar una
-- receta sin tocar la casilla funciona (no envia el argumento); guardarla
-- tocando la casilla responde 409 ("Esta base aun no admite guardar la receta de
-- un empaque de forma segura...") sin escribir nada.
--
-- Reaplicar 20261011c reinstala la firma de 5 argumentos y deja DOS sobrecargas
-- (PGRST203 en toda llamada de 5 argumentos): volver a aplicar este parche justo
-- despues (verify-patches.sql lo marca en fail). Reaplicar 20261010e o 20261011d
-- no afecta a este parche.
--
-- Idempotente, una sola transaccion. Ejecutar en SQL Editor o via db-up.
-- NO aplicado a produccion.
-- =============================================================================

begin;

-- La firma de 5 argumentos (20261011c) se elimina: con las dos, una llamada por
-- PostgREST con los 5 argumentos de siempre seria ambigua (PGRST203).
drop function if exists public.save_pack_recipe(uuid, boolean, integer, text, jsonb);

create or replace function public.save_pack_recipe(
  p_pack_product_id uuid,
  p_enabled boolean,
  p_total_units integer default null,
  p_label text default null,
  p_components jsonb default null,
  p_always_disassemble_on_receive boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_label text;
  v_count integer := 0;
  v_item jsonb;
  v_raw text;
  v_number numeric;
  v_weight numeric;
  v_ids uuid[] := '{}'::uuid[];
  v_units integer[] := '{}'::integer[];
  v_weights numeric[] := '{}'::numeric[];
  v_sum bigint := 0;
  v_single boolean := false;
  v_self boolean := false;
  v_lock_ids uuid[];
  v_locked integer;
  v_existing public.product_pack_conversions;
  v_has_existing boolean;
  v_existing_count integer := 0;
  v_same boolean := false;
  v_pack_name text;
  v_new_id uuid;
  v_action text;
  v_always boolean := false;
begin
  v_store_id := public.assert_store_context();

  if coalesce(public.current_user_role()::text, '') not in ('admin', 'almacen') then
    raise exception using errcode = 'PT403', message = 'No autorizado para guardar la receta de un empaque';
  end if;

  if p_pack_product_id is null then
    raise exception using errcode = 'PT400', message = 'Selecciona el producto del empaque.';
  end if;

  if p_enabled is null then
    raise exception using errcode = 'PT400', message = 'Indica si el empaque está activo.';
  end if;

  -- ---------------------------------------------------------------------------
  -- Forma de la receta (no necesita leer nada).
  -- ---------------------------------------------------------------------------
  if p_enabled then
    if p_components is null or jsonb_typeof(p_components) <> 'array' then
      raise exception using errcode = 'PT400', message = 'Los componentes del empaque deben ser una lista.';
    end if;

    v_count := jsonb_array_length(p_components);

    if v_count < 1 or v_count > 20 then
      raise exception using errcode = 'PT400', message = 'Un empaque lleva entre 1 y 20 componentes.';
    end if;

    for v_item in select value from jsonb_array_elements(p_components)
    loop
      if jsonb_typeof(v_item) <> 'object' then
        raise exception using
          errcode = 'PT400',
          message = 'Cada componente del empaque requiere su producto y sus unidades.';
      end if;

      v_raw := v_item ->> 'unit_product_id';

      if v_raw is null
         or v_raw !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
        raise exception using errcode = 'PT400', message = 'Selecciona el producto de cada componente.';
      end if;

      if v_raw::uuid = any(v_ids) then
        raise exception using
          errcode = 'PT400',
          message = 'Un producto no puede repetirse entre los componentes del empaque.';
      end if;

      if v_raw::uuid = p_pack_product_id then
        v_self := true;
      end if;

      if jsonb_typeof(v_item -> 'units_per_pack') is distinct from 'number' then
        raise exception using
          errcode = 'PT400',
          message = 'Las unidades de cada componente deben ser un entero mayor a cero.';
      end if;

      v_number := (v_item ->> 'units_per_pack')::numeric;

      if v_number <= 0 or v_number <> trunc(v_number) or v_number > 2147483647 then
        raise exception using
          errcode = 'PT400',
          message = 'Las unidades de cada componente deben ser un entero mayor a cero.';
      end if;

      -- Sin peso (ausente o null de JSON) vale 1. Un numero de JSON siempre es finito.
      if coalesce(jsonb_typeof(v_item -> 'cost_weight'), 'null') = 'null' then
        v_weight := 1;
      elsif jsonb_typeof(v_item -> 'cost_weight') <> 'number' then
        raise exception using
          errcode = 'PT400',
          message = 'El peso de costo de cada componente debe ser un número mayor a cero.';
      else
        v_weight := (v_item ->> 'cost_weight')::numeric;

        if v_weight <= 0 then
          raise exception using
            errcode = 'PT400',
            message = 'El peso de costo de cada componente debe ser un número mayor a cero.';
        end if;
      end if;

      v_ids := v_ids || v_raw::uuid;
      v_units := v_units || v_number::integer;
      v_weights := v_weights || v_weight;
      v_sum := v_sum + v_number::bigint;
    end loop;

    v_single := v_count = 1;

    if v_self then
      raise exception using
        errcode = 'PT400',
        message = case
          when v_single then 'El empaque y la unidad deben ser productos distintos.'
          else 'El empaque no puede ser componente de sí mismo.'
        end;
    end if;

    if p_total_units is null or p_total_units < 2 then
      raise exception using
        errcode = 'PT400',
        message = 'Indica el total de unidades del empaque (mínimo 2).';
    end if;

    if v_sum <> p_total_units then
      raise exception using
        errcode = 'PT400',
        message = format(
          'Los componentes suman %s unidades y el empaque declara %s.', v_sum, p_total_units
        );
    end if;

    v_label := nullif(btrim(p_label), '');

    if char_length(v_label) > 80 then
      raise exception using
        errcode = 'PT400',
        message = 'El nombre de la receta admite hasta 80 caracteres.';
    end if;
  end if;

  -- ---------------------------------------------------------------------------
  -- Bloqueo: documento (receta activa del empaque) -> productos por id.
  -- ---------------------------------------------------------------------------
  perform 1
  from public.product_pack_conversions
  where store_id = v_store_id
    and pack_product_id = p_pack_product_id
    and is_active = true
  for update;

  v_lock_ids := v_ids || p_pack_product_id;

  perform 1
  from public.products
  where id = any(v_lock_ids)
    and store_id = v_store_id
  order by id
  for update;

  if not exists (
    select 1 from public.products where id = p_pack_product_id and store_id = v_store_id
  ) then
    raise exception using errcode = 'PT404', message = 'Producto no encontrado.';
  end if;

  select count(*) into v_locked
  from public.products
  where id = any(v_lock_ids)
    and store_id = v_store_id;

  if v_locked <> cardinality(v_lock_ids) then
    raise exception using
      errcode = 'PT404',
      message = case
        when v_single then 'Producto unidad no encontrado.'
        else 'Producto componente no encontrado.'
      end;
  end if;

  -- Con los productos bloqueados: la receta vigente (otro guardado del mismo
  -- empaque ya termino; lo que confirmo se ve desde aqui).
  select * into v_existing
  from public.product_pack_conversions
  where store_id = v_store_id
    and pack_product_id = p_pack_product_id
    and is_active = true
  for update;

  v_has_existing := found;

  if not p_enabled then
    if v_has_existing then
      update public.product_pack_conversions
      set is_active = false
      where id = v_existing.id;
    end if;

    return jsonb_build_object(
      'action', case when v_has_existing then 'disabled' else 'none' end,
      'conversionId', null,
      'previousConversionId', v_existing.id,
      'packProductId', p_pack_product_id,
      'totalUnits', null,
      'label', null,
      'components', '[]'::jsonb
    );
  end if;

  -- ---------------------------------------------------------------------------
  -- Regla de cadenas, en los dos sentidos.
  -- ---------------------------------------------------------------------------
  if exists (
    select 1
    from public.product_pack_conversions c
    where c.store_id = v_store_id
      and c.is_active = true
      and c.pack_product_id = any(v_ids)
  ) then
    raise exception using
      errcode = 'PT409',
      message = case
        when v_single then
          'El producto unidad es un empaque con receta activa: no puede salir de otro empaque.'
        else
          'Un componente es un empaque con receta activa: no puede salir de otro empaque.'
      end;
  end if;

  if not v_has_existing then
    select coalesce(nullif(btrim(p.name), ''), 'otro empaque') into v_pack_name
    from public.product_pack_components pc
    join public.product_pack_conversions c on c.id = pc.conversion_id
    join public.products p on p.id = c.pack_product_id
    where pc.store_id = v_store_id
      and pc.unit_product_id = p_pack_product_id
      and c.is_active = true
    order by c.created_at, c.id
    limit 1;

    if found then
      raise exception using
        errcode = 'PT409',
        message = format(
          'Este producto ya es unidad de %s; no puede ser a la vez un empaque.', v_pack_name
        );
    end if;
  end if;

  -- ---------------------------------------------------------------------------
  -- Escritura.
  -- ---------------------------------------------------------------------------
  if v_has_existing then
    select count(*) into v_existing_count
    from public.product_pack_components pc
    where pc.conversion_id = v_existing.id;

    v_same := v_existing.total_units = p_total_units
      and v_existing_count = v_count
      and not exists (
        select 1
        from unnest(v_ids, v_units, v_weights) as n(id, units, weight)
        where not exists (
          select 1
          from public.product_pack_components pc
          where pc.conversion_id = v_existing.id
            and pc.unit_product_id = n.id
            and pc.units_per_pack = n.units
            and pc.cost_weight = n.weight
        )
      );
  end if;

  -- Preferencia "Desarmar siempre al recibir compras" con la que queda la receta:
  -- la que llega o, si no llega (null), la de la receta vigente. Sin receta
  -- vigente (v_existing vacio) y sin argumento: false.
  v_always := coalesce(p_always_disassemble_on_receive, v_existing.always_disassemble_on_receive, false);

  if v_same then
    -- Misma receta: no se escribe; solo el nombre si cambio.
    if v_existing.label is distinct from v_label then
      update public.product_pack_conversions
      set label = v_label
      where id = v_existing.id;

      v_action := 'renamed';
    else
      v_action := 'unchanged';
    end if;

    -- La preferencia es una columna aparte de la cabecera: se escribe solo si
    -- cambia y no altera "action" (que describe productos, unidades y nombre).
    if v_existing.always_disassemble_on_receive is distinct from v_always then
      update public.product_pack_conversions
      set always_disassemble_on_receive = v_always
      where id = v_existing.id;
    end if;

    v_new_id := v_existing.id;
  elsif v_has_existing
     and v_single
     and v_existing_count = 1
     and exists (
       select 1
       from public.product_pack_components pc
       where pc.conversion_id = v_existing.id
         and pc.unit_product_id = v_ids[1]
     ) then
    -- Par de siempre con el mismo producto unidad: se edita en sitio (conserva
    -- el id). El trigger de la cabecera deja el componente al dia.
    update public.product_pack_conversions
    set unit_product_id = v_ids[1],
        units_per_pack = p_total_units,
        always_disassemble_on_receive = v_always
    where id = v_existing.id;

    v_action := 'updated';
    v_new_id := v_existing.id;
    v_label := v_existing.label;
  else
    -- Otros productos (o par <-> surtido): la vigente queda inactiva con sus
    -- componentes intactos y se crea otra. Sentencias separadas: el trigger del
    -- componente necesita ver la cabecera.
    if v_has_existing then
      update public.product_pack_conversions
      set is_active = false
      where id = v_existing.id;
    end if;

    insert into public.product_pack_conversions (
      store_id, pack_product_id, total_units, label, is_active, always_disassemble_on_receive
    )
    values (v_store_id, p_pack_product_id, p_total_units, v_label, true, v_always)
    returning id into v_new_id;

    insert into public.product_pack_components (conversion_id, store_id, unit_product_id, units_per_pack, cost_weight)
    select v_new_id, v_store_id, n.id, n.units, n.weight
    from unnest(v_ids, v_units, v_weights) as n(id, units, weight);

    v_action := case when v_has_existing then 'replaced' else 'created' end;
  end if;

  return jsonb_build_object(
    'action', v_action,
    'conversionId', v_new_id,
    'previousConversionId', case when v_action = 'replaced' then v_existing.id end,
    'packProductId', p_pack_product_id,
    'totalUnits', p_total_units,
    'label', v_label,
    'alwaysDisassembleOnReceive', v_always,
    'components', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'unitProductId', pc.unit_product_id,
            'unitsPerPack', pc.units_per_pack,
            'costWeight', pc.cost_weight
          )
          order by pc.unit_product_id
        ),
        '[]'::jsonb
      )
      from public.product_pack_components pc
      where pc.conversion_id = v_new_id
    )
  );
end;
$$;

comment on function public.save_pack_recipe(uuid, boolean, integer, text, jsonb, boolean) is
  'Guarda, reemplaza o desactiva la receta de un empaque en una transaccion, con el empaque y sus componentes bloqueados y la regla de cadenas validada en base (INV-09). Tambien guarda la preferencia "Desarmar siempre al recibir compras" de la cabecera (INT-02).';

revoke all on function public.save_pack_recipe(uuid, boolean, integer, text, jsonb, boolean) from public, anon;
grant execute on function public.save_pack_recipe(uuid, boolean, integer, text, jsonb, boolean) to authenticated, service_role;

commit;

notify pgrst, 'reload schema';
