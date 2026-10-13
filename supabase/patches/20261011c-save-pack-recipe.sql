-- =============================================================================
-- 20261011c — guardar la receta de un empaque en UNA transaccion (INV-09; plan
--             ux-mejoras, decision D28c)
-- Proyecto: BodegaHub
-- Requiere: 20261006a (assert_store_context) y 20261009d (product_pack_conversions
--           como cabecera, product_pack_components y sus triggers).
--
-- Hasta hoy el BFF guardaba una receta con varias peticiones de PostgREST
-- (cabecera inactiva -> componentes -> desactivar la anterior -> activar) y
-- compensaba a mano si una fallaba. Y la regla de cadenas (un producto no es a
-- la vez empaque de una receta activa y componente de otra) solo vivia en el
-- BFF: dos guardados simultaneos (A con componente B, y B con componente C)
-- pasaban ambos la validacion y dejaban la cadena A -> B -> C.
--
-- Firma (unica):
--
--   public.save_pack_recipe(
--     p_pack_product_id uuid,
--     p_enabled         boolean,
--     p_total_units     integer default null,
--     p_label           text    default null,
--     p_components      jsonb   default null
--   ) returns jsonb
--
--   p_components = [{"unit_product_id": "<uuid>", "units_per_pack": <entero > 0>,
--                    "cost_weight": <numero > 0, opcional, por defecto 1>}]
--   p_enabled = false desactiva la receta activa del empaque (los demas
--   parametros se ignoran).
--
-- Contrato (docs/stock-integrity.md §1): security definer, search_path = public,
-- assert_store_context() primero, rol admin / almacen (PT403), errores PT400 /
-- PT403 / PT404 / PT409 en espanol. No toca stock ni dinero.
--
-- Orden de bloqueo (documento -> productos, el mismo de convert_pack_to_units):
--   1. la receta activa del empaque, si existe (for update);
--   2. el empaque y TODOS los componentes en una sentencia
--      "where id = any(v_ids) and store_id = v_store_id order by id for update".
--      Es lo que serializa dos guardados que comparten un producto: el segundo
--      espera y, al despertar, cada sentencia lee lo que confirmo el primero.
--   3. la receta activa del empaque otra vez (la pudo crear o reemplazar el
--      guardado que iba delante).
--
-- Validaciones, ya con los productos bloqueados:
--   PT400  forma: lista de 1 a 20 componentes, sin repetidos, unidades enteras
--          > 0, peso > 0, total >= 2 e igual a la suma, nombre <= 80; el empaque
--          no es componente de si mismo.
--   PT404  el empaque o un componente no existen en la tienda del usuario.
--   PT409  un componente es el EMPAQUE de una receta activa.
--   PT409  el empaque es componente de una receta activa de OTRO empaque y aun
--          no tiene receta propia. Si ya la tiene (datos anteriores a la regla:
--          ya era empaque y componente) la puede editar o reemplazar, igual que
--          en el BFF: no se crea ninguna cadena que no existiera. Con las dos
--          reglas y el bloqueo, ningun guardado por esta RPC crea una cadena.
--   Los textos son los que devolvia el BFF (PRO-12, contrato §2). Con UN
--   componente se usa la redaccion del par de siempre ("producto unidad"); con
--   varios, la del surtido ("componente").
--
-- Escritura (la semantica que tenia el BFF):
--   * misma receta (mismos productos, unidades, pesos y total): no escribe;
--     solo el nombre si cambio                                   -> "unchanged" / "renamed"
--   * receta de 1 componente y llega el MISMO producto con otras unidades: se
--     edita en sitio y conserva el id                            -> "updated"
--   * cualquier otro cambio: la receta vigente queda inactiva y se crea otra
--     activa con sus componentes                                 -> "created" / "replaced"
--   * p_enabled = false                                          -> "disabled" / "none"
--   Nunca borra ni cambia los productos de una receta ya escrita: las
--   conversiones historicas siguen enlazadas (conversion_mismatches).
--
-- Resultado: {"action", "conversionId" (receta activa o null),
--   "previousConversionId" (la que quedo inactiva o null), "packProductId",
--   "totalUnits", "label", "components": [{"unitProductId", "unitsPerPack",
--   "costWeight"}]}.
--
-- RIESGO RESIDUAL — escritura directa por tabla. authenticated conserva insert /
-- update / delete sobre product_pack_conversions y product_pack_components (RLS
-- admin / almacen de la tienda). Quien escriba la tabla sin pasar por esta RPC
-- no toma el bloqueo de productos ni pasa la regla de cadenas. No se anade un
-- trigger de respaldo: sin el bloqueo ordenado no cierra la carrera (dos
-- transacciones no se ven entre si), tomarlo fila a fila dentro de un trigger
-- rompe el orden de bloqueo de las demas RPC, y la excepcion de los datos
-- anteriores a la regla obligaria a una via de escape. El BFF ya no escribe esas
-- tablas (solo esta RPC). Pendiente para otro ticket: revocar insert / update /
-- delete de authenticated en las dos tablas, tras migrar los fixtures y
-- escenarios del laboratorio que escriben por PostgREST. Aqui NO se revoca nada.
--
-- Idempotente, una sola transaccion. Ejecutar en SQL Editor o via db-up.
-- NO aplicado a produccion.
-- =============================================================================

begin;

create or replace function public.save_pack_recipe(
  p_pack_product_id uuid,
  p_enabled boolean,
  p_total_units integer default null,
  p_label text default null,
  p_components jsonb default null
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
        units_per_pack = p_total_units
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

    insert into public.product_pack_conversions (store_id, pack_product_id, total_units, label, is_active)
    values (v_store_id, p_pack_product_id, p_total_units, v_label, true)
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

comment on function public.save_pack_recipe(uuid, boolean, integer, text, jsonb) is
  'Guarda, reemplaza o desactiva la receta de un empaque en una transaccion, con el empaque y sus componentes bloqueados y la regla de cadenas validada en base (INV-09).';

revoke all on function public.save_pack_recipe(uuid, boolean, integer, text, jsonb) from public, anon;
grant execute on function public.save_pack_recipe(uuid, boolean, integer, text, jsonb) to authenticated, service_role;

commit;

notify pgrst, 'reload schema';
