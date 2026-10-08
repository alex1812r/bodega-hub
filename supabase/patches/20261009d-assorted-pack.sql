-- =============================================================================
-- 20261009d — empaque surtido: receta con N componentes (PRO-12; plan ux-mejoras,
--             Ola 1; reglas 7 y 9)
-- Proyecto: BodegaHub
-- Requiere: 20260811 (product_pack_conversions, stock_movements.conversion_id),
--           20261006a (assert_store_context, libro de stock), 20261006c
--           (convert_pack_to_units vigente, stock_request_keys / _hash / _replay),
--           20261006d (vistas de integridad v2), 20261006i (funcion
--           public.reject_non_finite_numeric) y 20261007a (create_purchase
--           vigente).
--
-- Hasta hoy un empaque se abria en UN producto unidad (par 1 a 1). Desde aqui
-- un empaque tiene una RECETA: cabecera + N componentes. Un par de siempre es
-- una receta de 1 componente y se comporta exactamente igual.
--
--   1. Modelo.
--        * product_pack_conversions pasa a CABECERA de la receta: gana
--          label text null y total_units integer not null (> 0). Conserva
--          pack_product_id, store_id, is_active, created_at y updated_at.
--        * product_pack_components (id, conversion_id, store_id,
--          unit_product_id, units_per_pack > 0, cost_weight > 0 y finito,
--          unique (conversion_id, unit_product_id)): un renglon por producto
--          que sale del empaque.
--        * Columnas de compatibilidad de la cabecera (las leen y escriben el
--          BFF anterior y los fixtures; se mantienen solas por trigger):
--            units_per_pack   siempre = total_units (sigue not null y > 1).
--            unit_product_id  el componente cuando la receta tiene UNO solo;
--                             NULL en una receta surtida (pasa a ser nullable).
--          Quien inserta o edita la cabecera con (unit_product_id,
--          units_per_pack), como hasta hoy, obtiene la receta de 1 componente
--          equivalente (pisa los componentes que hubiera); quien edita
--          componentes o total_units ve la cabecera al dia.
--   2. Invariantes.
--        * Receta ACTIVA: tiene componentes y sum(units_per_pack) = total_units.
--          Lo exige un trigger de restriccion DIFERIDO (se evalua al commit):
--          cabecera + N componentes caben en una transaccion; si no cuadra,
--          PT400 y no queda nada. Por PostgREST (una transaccion por peticion)
--          el camino es: cabecera inactiva -> componentes -> activar.
--        * El empaque no es componente de si mismo; componentes, cabecera y
--          empaque son de la misma tienda; un componente no cambia de receta.
--        * NO se anade ninguna regla de cadenas (un producto empaque de una
--          receta y componente de otra): la base no la tenia y sigue sin
--          tenerla. La regla vigente esta en el BFF (assertUnitAvailable).
--   3. Indices: se ELIMINA el unico del lado unidad
--      (uq_product_pack_conversions_unit_active): un producto puede salir de
--      varios empaques. Se MANTIENE uq_product_pack_conversions_pack_active
--      (una sola receta activa por empaque).
--   4. Migracion: cada fila existente = cabecera (total_units = units_per_pack)
--      + 1 componente (unit_product_id, units_per_pack, cost_weight 1). Las
--      inactivas tambien (son la historia que usa conversion_mismatches).
--   5. convert_pack_to_units(p_pack_product_id, p_pack_quantity, p_reason,
--      p_client_request_id, p_components jsonb default null). Parte del cuerpo
--      de 20261006c. El parametro nuevo va AL FINAL y con default; se elimina
--      la firma de 4 argumentos (dos sobrecargas = PGRST203): una llamada con
--      los argumentos de hoy resuelve igual.
--        * Sin p_components: cada componente recibe units_per_pack x empaques.
--        * Con p_components ([{"unit_product_id": uuid, "units": entero >= 0}]):
--          reparto REAL de esta apertura. Debe sumar total_units x empaques,
--          sin repetir producto y solo con componentes de la receta activa; lo
--          demas es PT400 y no mueve nada. Los 0 se omiten (sin movimiento).
--        * Costo: valor transferido = empaques x costo del empaque (igual que
--          hoy). Se reparte entre los componentes que reciben unidades en
--          proporcion a unidades x cost_weight, redondeado a 4 decimales; el
--          residuo del redondeo va al componente de mayor (unidades x
--          cost_weight) y, si empatan, al de mayor id: la suma repartida es
--          SIEMPRE el valor transferido. Cada componente actualiza su costo por
--          promedio ponderado con la formula y el redondeo de 20261006c.
--        * Movimientos: 1 conversion_salida + 1 conversion_entrada por
--          componente con unidades, todos con el mismo conversion_id, con
--          stock_after NULL (lo fija stock_movements_apply). Bloqueo del
--          empaque y de TODOS los componentes de la receta en una sentencia
--          ordenada por id.
--        * Idempotencia (C6): misma clave y mismo contenido devuelve el
--          resultado original. Sin p_components la huella es la de 20261006c
--          (las claves ya guardadas siguen valiendo); con p_components la
--          huella lo incluye (otro reparto con la misma clave = PT409).
--        * Producto inactivo (empaque o componente): NO se rechaza, igual que
--          en 20261006c. El resultado trae isActive por componente para que la
--          pantalla avise.
--        * Con 1 componente: stock, costo, movimientos y las claves del
--          resultado que ya existian son identicos a 20261006c. El resultado
--          gana totalUnits y components (aditivo). En una receta surtida
--          unitsPerPack = total_units, unitCostRef = costo medio por unidad y
--          unitMovement = la entrada del primer componente por id.
--   6. create_purchase: copia literal de 20261007a. Solo cambia la lectura de
--      la receta en el modo empaque (C13):
--        * Lado unidad: el producto es el UNICO componente de una o varias
--          recetas activas -> las unidades por empaque enviadas deben ser las
--          de ALGUNA de ellas (antes: las del unico par posible). Un producto
--          que solo es componente de recetas surtidas no queda atado a ellas.
--        * Lado empaque: se contrasta con total_units (antes units_per_pack,
--          que vale lo mismo). Comprar un empaque surtido en modo empaque
--          ingresa EMPAQUES al costo del empaque, como cualquier empaque.
--   7. conversion_mismatches (vistas v2): mismas columnas y mismo orden. Por
--      cada conversion_id: unit_delta es la SUMA de las entradas; missing_link
--      si alguno de los productos que entraron no es (ni fue) componente de una
--      receta de ese empaque. Con 1 componente da lo mismo que 20261006d.
--   8. product_pack_roles (vista, security_invoker) y pack_role(products)
--      (relacion calculada de PostgREST): is_pack / is_component / numero de
--      recetas activas de las que el producto es componente, sin listas de ids.
--
-- Seguridad: RLS de product_pack_components igual que la cabecera (lectura de
-- la tienda propia; escritura admin / almacen de la tienda), sin acceso anon.
-- La cabecera conserva sus politicas y su camino de escritura (tabla directa).
--
-- Idempotente, una sola transaccion. Ejecutar en SQL Editor o via db-up.
-- OJO: reaplicar 20261006c reinstala convert_pack_to_units de 4 argumentos (dos
-- sobrecargas) y reaplicar 20261006c / f / h / 20261007a reinstala
-- create_purchase sin la lectura de componentes: volver a aplicar este parche.
-- OJO: reaplicar 20261006d reinstala conversion_mismatches del modelo 1 a 1
-- (marcaria como missing_link toda apertura de un surtido): idem.
-- OJO: cambiar la receta de un empaque que ya se abrio borrando componentes
-- deja sus conversiones historicas como missing_link (igual que hoy al cambiar
-- la unidad del par): para cambiar una receta, desactivarla y crear otra.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Cabecera: columnas nuevas. total_units nace de units_per_pack. El trigger
--    de updated_at se apaga durante el backfill: updated_at ordena las filas
--    historicas de un mismo par en conversion_mismatches.
-- -----------------------------------------------------------------------------

alter table public.product_pack_conversions
  add column if not exists label text,
  add column if not exists total_units integer;

alter table public.product_pack_conversions
  disable trigger trg_product_pack_conversions_updated_at;

update public.product_pack_conversions
set total_units = units_per_pack
where total_units is null;

alter table public.product_pack_conversions
  enable trigger trg_product_pack_conversions_updated_at;

alter table public.product_pack_conversions
  alter column total_units set not null,
  alter column unit_product_id drop not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.product_pack_conversions'::regclass
      and conname = 'product_pack_conversions_total_units_check'
  ) then
    alter table public.product_pack_conversions
      add constraint product_pack_conversions_total_units_check check (total_units > 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.product_pack_conversions'::regclass
      and conname = 'product_pack_conversions_units_mirror_check'
  ) then
    alter table public.product_pack_conversions
      add constraint product_pack_conversions_units_mirror_check check (units_per_pack = total_units);
  end if;
end;
$$;

comment on column public.product_pack_conversions.total_units is
  'Unidades que salen de un empaque. En una receta activa = suma de product_pack_components.units_per_pack.';
comment on column public.product_pack_conversions.label is
  'Nombre opcional de la receta (p. ej. "Surtido 6 sabores").';
comment on column public.product_pack_conversions.units_per_pack is
  'Compatibilidad: siempre igual a total_units (lo mantiene el trigger de la cabecera).';
comment on column public.product_pack_conversions.unit_product_id is
  'Compatibilidad: el componente cuando la receta tiene uno solo; NULL en una receta surtida.';

-- Un producto unidad puede salir de varios empaques: el unico pasa a indice normal.
drop index if exists public.uq_product_pack_conversions_unit_active;

create index if not exists idx_product_pack_conversions_unit_product_id
  on public.product_pack_conversions(unit_product_id)
  where unit_product_id is not null;

-- -----------------------------------------------------------------------------
-- 2. Componentes de la receta.
-- -----------------------------------------------------------------------------

create table if not exists public.product_pack_components (
  id uuid primary key default gen_random_uuid(),
  conversion_id uuid not null references public.product_pack_conversions(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  unit_product_id uuid not null references public.products(id) on delete cascade,
  units_per_pack integer not null,
  cost_weight numeric not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_pack_components_units_per_pack_check check (units_per_pack > 0),
  -- 'NaN' > 0 es verdadero en numeric: (x - x) = 0 solo se cumple con un finito.
  constraint product_pack_components_cost_weight_check
    check (cost_weight > 0 and (cost_weight - cost_weight) = 0),
  constraint product_pack_components_conversion_unit_unique unique (conversion_id, unit_product_id)
);

comment on table public.product_pack_components is
  'Componentes de la receta de un empaque (product_pack_conversions): que producto sale, cuantas unidades por empaque y su peso en el reparto del costo.';
comment on column public.product_pack_components.cost_weight is
  'Peso relativo del componente al repartir el costo del empaque: la parte de cada uno es proporcional a unidades x cost_weight.';

create index if not exists idx_product_pack_components_unit_product_id
  on public.product_pack_components(unit_product_id);

create index if not exists idx_product_pack_components_store_id
  on public.product_pack_components(store_id);

-- -----------------------------------------------------------------------------
-- 3. Migracion: cada fila de siempre = cabecera + 1 componente. Reaplicar no
--    inserta nada (una cabecera con algun componente no se toca).
-- -----------------------------------------------------------------------------

insert into public.product_pack_components (conversion_id, store_id, unit_product_id, units_per_pack, cost_weight)
select c.id, c.store_id, c.unit_product_id, c.units_per_pack, 1
from public.product_pack_conversions c
where c.unit_product_id is not null
  and not exists (
    select 1
    from public.product_pack_components pc
    where pc.conversion_id = c.id
  );

-- -----------------------------------------------------------------------------
-- 4. Triggers de la cabecera.
--    app.pack_recipe_sync = '1' (local a la transaccion) marca las escrituras
--    DERIVADAS (las que hace un trigger para mantener la otra tabla): asi cada
--    trigger distingue lo que escribe un usuario de lo que escribe su par y no
--    se pisan. No es una guarda de seguridad: la suma la exige el trigger
--    diferido de la seccion 6, que no la consulta.
-- -----------------------------------------------------------------------------

-- BEFORE: iguala total_units <-> units_per_pack y valida la cabecera.
create or replace function public.validate_product_pack_conversion()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_pack_store uuid;
  v_unit_store uuid;
  v_derived boolean := coalesce(current_setting('app.pack_recipe_sync', true), '') = '1';
begin
  if tg_op = 'INSERT' then
    new.total_units := coalesce(new.total_units, new.units_per_pack);
    new.units_per_pack := coalesce(new.units_per_pack, new.total_units);
  else
    if new.units_per_pack is distinct from old.units_per_pack
       and new.total_units is not distinct from old.total_units then
      new.total_units := new.units_per_pack;
    elsif new.total_units is distinct from old.total_units
       and new.units_per_pack is not distinct from old.units_per_pack then
      new.units_per_pack := new.total_units;
    end if;

    if not v_derived and old.unit_product_id is not null and new.unit_product_id is null then
      raise exception using
        errcode = 'PT400',
        message = 'El producto unidad no se puede dejar vacio: edita los componentes de la receta';
    end if;
  end if;

  if new.total_units is null then
    raise exception using errcode = 'PT400', message = 'La receta requiere el total de unidades del empaque';
  end if;

  if new.units_per_pack is distinct from new.total_units then
    raise exception using
      errcode = 'PT400',
      message = 'Las unidades por empaque y el total de unidades de la receta no coinciden';
  end if;

  select store_id into v_pack_store from public.products where id = new.pack_product_id;

  if v_pack_store is null then
    raise exception using errcode = 'PT400', message = 'Producto de empaque o unidad no encontrado';
  end if;

  if new.unit_product_id is not null then
    select store_id into v_unit_store from public.products where id = new.unit_product_id;

    if v_unit_store is null then
      raise exception using errcode = 'PT400', message = 'Producto de empaque o unidad no encontrado';
    end if;

    if v_pack_store <> v_unit_store then
      raise exception using errcode = 'PT400', message = 'Empaque y unidad deben pertenecer a la misma tienda';
    end if;

    if new.unit_product_id = new.pack_product_id then
      raise exception using errcode = 'PT400', message = 'El empaque no puede ser componente de si mismo';
    end if;
  end if;

  if new.store_id <> v_pack_store then
    raise exception using errcode = 'PT400', message = 'store_id del vinculo no coincide con los productos';
  end if;

  if tg_op = 'UPDATE' and exists (
    select 1
    from public.product_pack_components pc
    where pc.conversion_id = new.id
      and (pc.unit_product_id = new.pack_product_id or pc.store_id <> new.store_id)
  ) then
    raise exception using
      errcode = 'PT400',
      message = 'El empaque no puede ser componente de si mismo y sus componentes deben ser de la misma tienda';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_product_pack_conversion on public.product_pack_conversions;
create trigger trg_validate_product_pack_conversion
before insert or update on public.product_pack_conversions
for each row execute function public.validate_product_pack_conversion();

-- AFTER: quien escribe la cabecera al modo de siempre (unit_product_id +
-- units_per_pack) deja la receta de 1 componente equivalente. En un update solo
-- se dispara si la sentencia NOMBRA una de esas dos columnas: cambiar solo
-- total_units (modelo nuevo) no toca los componentes.
create or replace function public.product_pack_conversions_sync_component()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('app.pack_recipe_sync', true), '') = '1'
     or new.unit_product_id is null then
    return null;
  end if;

  if tg_op = 'UPDATE'
     and new.unit_product_id is not distinct from old.unit_product_id
     and new.total_units is not distinct from old.total_units then
    return null;
  end if;

  perform set_config('app.pack_recipe_sync', '1', true);

  delete from public.product_pack_components
  where conversion_id = new.id
    and unit_product_id <> new.unit_product_id;

  insert into public.product_pack_components as pc (conversion_id, store_id, unit_product_id, units_per_pack)
  values (new.id, new.store_id, new.unit_product_id, new.total_units)
  on conflict (conversion_id, unit_product_id) do update
    set units_per_pack = excluded.units_per_pack,
        store_id = excluded.store_id
    where pc.units_per_pack is distinct from excluded.units_per_pack
       or pc.store_id is distinct from excluded.store_id;

  perform set_config('app.pack_recipe_sync', '', true);

  return null;
end;
$$;

revoke all on function public.product_pack_conversions_sync_component() from public, anon, authenticated;

drop trigger if exists trg_product_pack_conversions_sync_component_ins on public.product_pack_conversions;
create trigger trg_product_pack_conversions_sync_component_ins
after insert on public.product_pack_conversions
for each row execute function public.product_pack_conversions_sync_component();

drop trigger if exists trg_product_pack_conversions_sync_component_upd on public.product_pack_conversions;
create trigger trg_product_pack_conversions_sync_component_upd
after update of unit_product_id, units_per_pack on public.product_pack_conversions
for each row execute function public.product_pack_conversions_sync_component();

-- -----------------------------------------------------------------------------
-- 5. Triggers de los componentes.
-- -----------------------------------------------------------------------------

drop trigger if exists trg_product_pack_components_updated_at on public.product_pack_components;
create trigger trg_product_pack_components_updated_at
before update on public.product_pack_components
for each row execute function public.set_updated_at();

-- BEFORE: tienda, empaque y receta del componente. Security definer para ver la
-- cabecera aunque sea de otra tienda (y rechazarla); no escribe nada.
create or replace function public.validate_product_pack_component()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_header public.product_pack_conversions;
  v_unit_store uuid;
begin
  if tg_op = 'UPDATE' and new.conversion_id is distinct from old.conversion_id then
    raise exception using errcode = 'PT400', message = 'Un componente no puede cambiarse de receta';
  end if;

  select * into v_header
  from public.product_pack_conversions
  where id = new.conversion_id;

  if not found then
    raise exception using errcode = 'PT400', message = 'La receta del empaque no existe';
  end if;

  new.store_id := coalesce(new.store_id, v_header.store_id);

  if new.store_id <> v_header.store_id then
    raise exception using
      errcode = 'PT400',
      message = 'El componente y la receta deben pertenecer a la misma tienda';
  end if;

  select store_id into v_unit_store from public.products where id = new.unit_product_id;

  if v_unit_store is null then
    raise exception using errcode = 'PT400', message = 'Producto componente no encontrado';
  end if;

  if v_unit_store <> v_header.store_id then
    raise exception using
      errcode = 'PT400',
      message = 'El componente y el empaque deben pertenecer a la misma tienda';
  end if;

  if new.unit_product_id = v_header.pack_product_id then
    raise exception using errcode = 'PT400', message = 'El empaque no puede ser componente de si mismo';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_product_pack_component() from public, anon, authenticated;

drop trigger if exists trg_validate_product_pack_component on public.product_pack_components;
create trigger trg_validate_product_pack_component
before insert or update on public.product_pack_components
for each row execute function public.validate_product_pack_component();

-- AFTER (por sentencia): deja en la cabecera el componente unico, o NULL si la
-- receta tiene varios o ninguno.
create or replace function public.product_pack_components_sync_header()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('app.pack_recipe_sync', true), '') = '1' then
    return null;
  end if;

  perform set_config('app.pack_recipe_sync', '1', true);

  update public.product_pack_conversions c
  set unit_product_id = s.unit_product_id
  from (
    select
      ch.conversion_id,
      case when count(pc.id) = 1 then min(pc.unit_product_id::text)::uuid end as unit_product_id
    from (select distinct conversion_id from changed) ch
    left join public.product_pack_components pc on pc.conversion_id = ch.conversion_id
    group by ch.conversion_id
  ) s
  where c.id = s.conversion_id
    and c.unit_product_id is distinct from s.unit_product_id;

  perform set_config('app.pack_recipe_sync', '', true);

  return null;
end;
$$;

revoke all on function public.product_pack_components_sync_header() from public, anon, authenticated;

drop trigger if exists trg_product_pack_components_sync_header_ins on public.product_pack_components;
create trigger trg_product_pack_components_sync_header_ins
after insert on public.product_pack_components
referencing new table as changed
for each statement execute function public.product_pack_components_sync_header();

drop trigger if exists trg_product_pack_components_sync_header_upd on public.product_pack_components;
create trigger trg_product_pack_components_sync_header_upd
after update on public.product_pack_components
referencing new table as changed
for each statement execute function public.product_pack_components_sync_header();

drop trigger if exists trg_product_pack_components_sync_header_del on public.product_pack_components;
create trigger trg_product_pack_components_sync_header_del
after delete on public.product_pack_components
referencing old table as changed
for each statement execute function public.product_pack_components_sync_header();

-- -----------------------------------------------------------------------------
-- 6. Invariante de la receta activa, DIFERIDO: se evalua al commit, con la
--    cabecera y los componentes ya escritos. Security definer: cuenta todas las
--    filas de la receta, no solo las que ve quien escribe.
-- -----------------------------------------------------------------------------

create or replace function public.assert_pack_recipe_consistent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conversion_id uuid;
  v_header public.product_pack_conversions;
  v_components integer;
  v_units bigint;
begin
  if tg_table_name = 'product_pack_conversions' then
    v_conversion_id := new.id;
  elsif tg_op = 'DELETE' then
    v_conversion_id := old.conversion_id;
  else
    v_conversion_id := new.conversion_id;
  end if;

  select * into v_header
  from public.product_pack_conversions
  where id = v_conversion_id;

  -- Receta borrada o inactiva: nada que exigir.
  if not found or not v_header.is_active then
    return null;
  end if;

  select count(*), coalesce(sum(pc.units_per_pack), 0)
  into v_components, v_units
  from public.product_pack_components pc
  where pc.conversion_id = v_conversion_id;

  if v_components = 0 then
    raise exception using
      errcode = 'PT400',
      message = 'La receta activa de un empaque debe tener al menos un componente';
  end if;

  if v_units <> v_header.total_units then
    raise exception using
      errcode = 'PT400',
      message = format(
        'Los componentes de la receta suman %s unidades y el empaque declara %s',
        v_units, v_header.total_units
      );
  end if;

  return null;
end;
$$;

revoke all on function public.assert_pack_recipe_consistent() from public, anon, authenticated;

drop trigger if exists trg_zz_pack_recipe_sum on public.product_pack_conversions;
create constraint trigger trg_zz_pack_recipe_sum
after insert or update on public.product_pack_conversions
deferrable initially deferred
for each row execute function public.assert_pack_recipe_consistent();

drop trigger if exists trg_zz_pack_recipe_sum on public.product_pack_components;
create constraint trigger trg_zz_pack_recipe_sum
after insert or update or delete on public.product_pack_components
deferrable initially deferred
for each row execute function public.assert_pack_recipe_consistent();

-- -----------------------------------------------------------------------------
-- 7. cost_weight no acepta NaN / Infinity con el PT400 de 20261006i (mismo
--    generador, acotado a esta tabla; tras reaplicar 20261006i no hace falta
--    reaplicar este parche: su barrido ya la incluye).
-- -----------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select
      c.oid::regclass as tbl,
      string_agg(format('(new.%1$I - new.%1$I) <> 0', a.attname), ' or ' order by a.attnum) as insert_when,
      string_agg(
        format('((new.%1$I - new.%1$I) <> 0 and new.%1$I is distinct from old.%1$I)', a.attname),
        ' or ' order by a.attnum
      ) as update_when,
      string_agg(quote_literal(a.attname), ', ' order by a.attnum) as args
    from pg_class c
    join pg_attribute a on a.attrelid = c.oid
    where c.oid = 'public.product_pack_components'::regclass
      and a.attnum > 0
      and not a.attisdropped
      and a.attgenerated = ''
      and a.atttypid = 'numeric'::regtype
    group by c.oid
  loop
    execute format('drop trigger if exists trg_zz_reject_non_finite_numeric_ins on %s', r.tbl);
    execute format('drop trigger if exists trg_zz_reject_non_finite_numeric_upd on %s', r.tbl);

    execute format(
      'create trigger trg_zz_reject_non_finite_numeric_ins before insert on %s for each row when (%s) '
      || 'execute function public.reject_non_finite_numeric(%s)',
      r.tbl, r.insert_when, r.args
    );
    execute format(
      'create trigger trg_zz_reject_non_finite_numeric_upd before update on %s for each row when (%s) '
      || 'execute function public.reject_non_finite_numeric(%s)',
      r.tbl, r.update_when, r.args
    );
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. RLS y grants de los componentes: como la cabecera (lectura de la tienda
--    propia; escritura admin / almacen de la tienda) y sin acceso para anon.
--    Supabase concede ALL por defecto a los roles de PostgREST.
-- -----------------------------------------------------------------------------

alter table public.product_pack_components enable row level security;

revoke all on public.product_pack_components from public, anon, authenticated;
grant select, insert, update, delete on public.product_pack_components to authenticated;
grant all on public.product_pack_components to service_role;

drop policy if exists "Authenticated users read product pack components"
  on public.product_pack_components;
create policy "Authenticated users read product pack components"
on public.product_pack_components for select
to authenticated
using (store_id = public.current_user_store_id());

drop policy if exists "Admins and warehouse manage product pack components"
  on public.product_pack_components;
create policy "Admins and warehouse manage product pack components"
on public.product_pack_components for all
to authenticated
using (
  store_id = public.current_user_store_id()
  and public.current_user_role() in ('admin', 'almacen')
)
with check (
  store_id = public.current_user_store_id()
  and public.current_user_role() in ('admin', 'almacen')
);

-- -----------------------------------------------------------------------------
-- 9. convert_pack_to_units — cuerpo de 20261006c + receta de N componentes.
--    Firma nueva (5 argumentos, el nuevo al final con default): se elimina la
--    de 4 para no dejar dos sobrecargas vivas (PGRST203).
-- -----------------------------------------------------------------------------

drop function if exists public.convert_pack_to_units(uuid, integer, text, uuid);

create or replace function public.convert_pack_to_units(
  p_pack_product_id uuid,
  p_pack_quantity integer,
  p_reason text default null,
  p_client_request_id uuid default null,
  p_components jsonb default null
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
  v_conversion_id uuid := gen_random_uuid();
  v_units_out integer;
  v_transferred_value numeric(14,4);
  v_unit_cost numeric(12,2);
  v_new_unit_cost numeric(12,2);
  v_pack_movement public.stock_movements;
  v_unit_movement public.stock_movements;
  v_first_unit_movement public.stock_movements;
  v_request_hash text;
  v_result jsonb;
  v_rows integer;
  -- Receta: arreglos paralelos ordenados por id de producto.
  v_component_ids uuid[];
  v_recipe_units integer[];
  v_weights numeric[];
  v_stocks integer[];
  v_costs numeric[];
  v_actives boolean[];
  v_units integer[];
  v_seen boolean[];
  v_count integer;
  v_recipe_total bigint;
  v_expected_units bigint;
  v_sent_units bigint;
  v_item jsonb;
  v_index integer;
  v_ids uuid[];
  v_weight_total numeric;
  v_residual_index integer;
  v_allocated numeric(14,4) := 0;
  v_share numeric(14,4);
  v_shares numeric[];
  v_component_cost numeric(12,2);
  v_components jsonb := '[]'::jsonb;
begin
  v_store_id := public.assert_store_context();

  if coalesce(public.current_user_role()::text, '') not in ('admin', 'almacen') then
    raise exception using errcode = 'PT403', message = 'No autorizado para convertir empaque a unidad';
  end if;

  -- Un null de JSON es lo mismo que no enviar la distribucion.
  if jsonb_typeof(p_components) = 'null' then
    p_components := null;
  end if;

  -- C6 — reintento de la misma conversion: se devuelve el resultado original.
  -- Sin distribucion la huella es la de 20261006c; con ella, la incluye.
  if p_client_request_id is not null then
    perform pg_advisory_xact_lock(
      hashtextextended('stock-request:' || v_store_id::text || ':' || p_client_request_id::text, 0)
    );

    if p_components is null then
      v_request_hash := public.stock_request_hash(jsonb_build_array(
        'convert_pack_to_units', p_pack_product_id, p_pack_quantity, p_reason
      ));
    else
      v_request_hash := public.stock_request_hash(jsonb_build_array(
        'convert_pack_to_units', p_pack_product_id, p_pack_quantity, p_reason, p_components
      ));
    end if;

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

  select
    count(*),
    array_agg(pc.unit_product_id order by pc.unit_product_id),
    array_agg(pc.units_per_pack order by pc.unit_product_id),
    array_agg(pc.cost_weight order by pc.unit_product_id),
    coalesce(sum(pc.units_per_pack), 0)
  into v_count, v_component_ids, v_recipe_units, v_weights, v_recipe_total
  from public.product_pack_components pc
  where pc.conversion_id = v_link.id
    and pc.store_id = v_store_id;

  if v_count = 0 or v_recipe_total <> v_link.total_units then
    raise exception using
      errcode = 'PT409',
      message = 'La receta del empaque esta incompleta: sus componentes no suman las unidades del empaque';
  end if;

  v_expected_units := v_link.total_units::bigint * p_pack_quantity;

  if p_components is not null then
    -- Reparto real de esta apertura: forma, pertenencia a la receta y suma.
    if jsonb_typeof(p_components) <> 'array' then
      raise exception using
        errcode = 'PT400',
        message = 'La distribucion de componentes debe ser una lista';
    end if;

    v_units := array_fill(0, array[v_count]);
    v_seen := array_fill(false, array[v_count]);
    v_sent_units := 0;

    for v_item in select value from jsonb_array_elements(p_components)
    loop
      if jsonb_typeof(v_item) is distinct from 'object'
         or jsonb_typeof(v_item -> 'unit_product_id') is distinct from 'string'
         or (v_item ->> 'unit_product_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         or jsonb_typeof(v_item -> 'units') is distinct from 'number'
         or (v_item ->> 'units') !~ '^[0-9]{1,9}$' then
        raise exception using
          errcode = 'PT400',
          message = 'Cada componente de la distribucion requiere unit_product_id y units (entero mayor o igual a cero)';
      end if;

      v_index := array_position(v_component_ids, (v_item ->> 'unit_product_id')::uuid);

      if v_index is null then
        raise exception using
          errcode = 'PT400',
          message = 'Un producto de la distribucion no es componente de la receta del empaque';
      end if;

      if v_seen[v_index] then
        raise exception using
          errcode = 'PT400',
          message = 'La distribucion repite un componente de la receta';
      end if;

      v_seen[v_index] := true;
      v_units[v_index] := (v_item ->> 'units')::integer;
      v_sent_units := v_sent_units + v_units[v_index];
    end loop;

    if v_sent_units <> v_expected_units then
      raise exception using
        errcode = 'PT400',
        message = format(
          'La distribucion debe sumar %s unidades (%s empaques x %s) y suma %s',
          v_expected_units, p_pack_quantity, v_link.total_units, v_sent_units
        );
    end if;
  end if;

  -- El empaque y TODOS los componentes de la receta, en una sola sentencia y en
  -- orden fijo.
  v_ids := v_component_ids || v_link.pack_product_id;

  perform 1
  from public.products
  where id = any(v_ids)
    and store_id = v_store_id
  order by id
  for update;

  if not found then
    raise exception using errcode = 'PT404', message = 'Producto de empaque no encontrado';
  end if;

  select * into v_pack
  from public.products
  where id = v_link.pack_product_id
    and store_id = v_store_id
  for update;

  if not found then
    raise exception using errcode = 'PT404', message = 'Producto de empaque no encontrado';
  end if;

  select
    count(*),
    array_agg(p.current_stock order by p.id),
    array_agg(coalesce(p.current_cost_ref, 0) order by p.id),
    array_agg(p.is_active order by p.id)
  into v_rows, v_stocks, v_costs, v_actives
  from public.products p
  where p.id = any(v_component_ids)
    and p.store_id = v_store_id;

  if v_rows <> v_count then
    raise exception using errcode = 'PT404', message = 'Producto unidad no encontrado';
  end if;

  if v_pack.current_stock < p_pack_quantity then
    raise exception using errcode = 'PT409', message = 'Stock insuficiente de empaque';
  end if;

  if v_expected_units > 2147483647 then
    raise exception using errcode = 'PT400', message = 'La cantidad de empaques es demasiado grande';
  end if;

  v_units_out := v_expected_units::integer;

  if p_components is null then
    select array_agg(u * p_pack_quantity order by ord)
    into v_units
    from unnest(v_recipe_units) with ordinality as r(u, ord);
  end if;

  v_transferred_value := p_pack_quantity::numeric * coalesce(v_pack.current_cost_ref, 0);
  v_unit_cost := round(v_transferred_value / v_units_out::numeric, 2);

  -- Reparto del valor entre los componentes que reciben unidades, en proporcion
  -- a unidades x cost_weight. El de mayor peso (si empatan, el de mayor id) se
  -- queda con el residuo del redondeo: la suma repartida es el valor transferido.
  select sum(v_units[i] * v_weights[i])
  into v_weight_total
  from generate_subscripts(v_units, 1) as i
  where v_units[i] > 0;

  select i
  into v_residual_index
  from generate_subscripts(v_units, 1) as i
  where v_units[i] > 0
  order by v_units[i] * v_weights[i] desc, i desc
  limit 1;

  v_shares := array_fill(0::numeric, array[v_count]);

  for v_index in 1 .. v_count
  loop
    if v_units[v_index] > 0 and v_index <> v_residual_index then
      v_share := round(v_transferred_value * (v_units[v_index] * v_weights[v_index]) / v_weight_total, 4);
      v_shares[v_index] := v_share;
      v_allocated := v_allocated + v_share;
    end if;
  end loop;

  v_shares[v_residual_index] := v_transferred_value - v_allocated;

  -- Costo de cada componente por promedio ponderado (formula de 20261006c).
  for v_index in 1 .. v_count
  loop
    continue when v_units[v_index] = 0;

    v_share := v_shares[v_index];
    v_component_cost := round(v_share / v_units[v_index]::numeric, 2);

    if v_stocks[v_index] <= 0 then
      v_new_unit_cost := v_component_cost;
    else
      v_new_unit_cost := round(
        (
          (v_stocks[v_index]::numeric * v_costs[v_index])
          + v_share
        ) / (v_stocks[v_index] + v_units[v_index])::numeric,
        2
      );
    end if;

    update public.products
    set current_cost_ref = v_new_unit_cost,
        updated_at = now()
    where id = v_component_ids[v_index]
      and store_id = v_store_id;

    get diagnostics v_rows = row_count;
    if v_rows <> 1 then
      raise exception using
        errcode = 'PT409',
        message = 'No se pudo actualizar el costo del producto unidad';
    end if;

    v_components := v_components || jsonb_build_object(
      'unitProductId', v_component_ids[v_index],
      'units', v_units[v_index],
      'costWeight', v_weights[v_index],
      'allocatedValueRef', v_share,
      'unitCostRef', v_component_cost,
      'newCostRef', v_new_unit_cost,
      'isActive', v_actives[v_index]
    );
  end loop;

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

  -- Una entrada por componente con unidades, en el mismo orden (por id).
  v_rows := 0;

  for v_index in 1 .. v_count
  loop
    continue when v_units[v_index] = 0;

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
      v_component_ids[v_index],
      'conversion_entrada'::public.stock_movement_type,
      v_units[v_index],
      v_conversion_id,
      p_reason,
      v_store_id,
      auth.uid()
    )
    returning * into v_unit_movement;

    if v_rows = 0 then
      v_first_unit_movement := v_unit_movement;
    end if;

    v_components := jsonb_set(
      v_components,
      array[v_rows::text, 'movement'],
      jsonb_build_object(
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

    v_rows := v_rows + 1;
  end loop;

  v_result := jsonb_build_object(
    'conversionId', v_conversion_id,
    'unitsPerPack', v_link.total_units,
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
      'id', v_first_unit_movement.id,
      'product_id', v_first_unit_movement.product_id,
      'type', v_first_unit_movement.type,
      'quantity_delta', v_first_unit_movement.quantity_delta,
      'stock_after', v_first_unit_movement.stock_after,
      'conversion_id', v_first_unit_movement.conversion_id,
      'reason', v_first_unit_movement.reason,
      'created_at', v_first_unit_movement.created_at
    ),
    'totalUnits', v_link.total_units,
    'components', v_components
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

revoke all on function public.convert_pack_to_units(uuid, integer, text, uuid, jsonb) from public, anon;
grant execute on function public.convert_pack_to_units(uuid, integer, text, uuid, jsonb) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 10. create_purchase — copia literal de 20261007a. Unico cambio: el modo
--     empaque (C13) lee la receta del modelo nuevo (ver cabecera, punto 6).
--     Misma firma de 14 argumentos.
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
-- 11. conversion_mismatches (20261006d) para recetas de N componentes. Mismas
--     columnas y mismo orden. Por conversion_id:
--       pack_delta       la salida del empaque
--       unit_delta       la SUMA de las entradas de todos los componentes
--       unit_product_id  una de las entradas (la de mayor id)
--       units_per_pack   unidades que entraron / empaques que salieron
--     La conversion se compara contra lo que ella misma registro:
--       missing_salida / missing_entrada  falta la salida o no hay entradas
--       missing_link                      algun producto que entro no es (ni fue)
--                                         componente de una receta de ese empaque
--       ratio_mismatch                    la salida no es negativa, las entradas
--                                         no suman positivo, o no entra un numero
--                                         entero de unidades (> 1) por empaque
--     current_units_per_pack (solo dato): total_units de la receta del empaque
--     que contiene ese componente, la activa primero.
-- -----------------------------------------------------------------------------

-- view: conversion_mismatches
create or replace view public.conversion_mismatches
with (security_invoker = true) as
with pairs as (
  select
    m.conversion_id,
    max(m.store_id::text)::uuid as movement_store_id,
    max(case when m.type = 'conversion_salida' then m.product_id::text end)::uuid as pack_product_id,
    max(case when m.type = 'conversion_entrada' then m.product_id::text end)::uuid as unit_product_id,
    sum(case when m.type = 'conversion_salida' then m.quantity_delta end) as pack_delta,
    sum(case when m.type = 'conversion_entrada' then m.quantity_delta end) as unit_delta
  from public.stock_movements m
  where m.conversion_id is not null
    and m.type in ('conversion_salida', 'conversion_entrada')
  group by m.conversion_id
),
linked as (
  select
    pr.*,
    coalesce(pp.store_id, up.store_id, pr.movement_store_id) as store_id,
    case
      when pr.pack_delta < 0 and pr.unit_delta > 0 and pr.unit_delta % (-pr.pack_delta) = 0
        then (pr.unit_delta / (-pr.pack_delta))::integer
    end as recorded_units_per_pack,
    (
      select c.total_units
      from public.product_pack_conversions c
      where c.pack_product_id = pr.pack_product_id
        and exists (
          select 1
          from public.product_pack_components pc
          where pc.conversion_id = c.id
            and pc.unit_product_id = pr.unit_product_id
        )
      order by c.is_active desc, c.updated_at desc nulls last, c.created_at desc
      limit 1
    ) as current_units_per_pack,
    (
      select count(distinct e.product_id)
      from public.stock_movements e
      where e.conversion_id = pr.conversion_id
        and e.type = 'conversion_entrada'
        and not exists (
          select 1
          from public.product_pack_components pc
          join public.product_pack_conversions c on c.id = pc.conversion_id
          where c.pack_product_id = pr.pack_product_id
            and pc.unit_product_id = e.product_id
        )
    ) as unlinked_components
  from pairs pr
  left join public.products pp on pp.id = pr.pack_product_id
  left join public.products up on up.id = pr.unit_product_id
)
select
  l.conversion_id,
  l.store_id,
  l.pack_product_id,
  l.unit_product_id,
  l.pack_delta::integer as pack_delta,
  l.unit_delta::integer as unit_delta,
  l.recorded_units_per_pack as units_per_pack,
  case
    when l.pack_product_id is null then 'missing_salida'
    when l.unit_product_id is null then 'missing_entrada'
    when l.current_units_per_pack is null or l.unlinked_components > 0 then 'missing_link'
    else 'ratio_mismatch'
  end::text as issue,
  l.current_units_per_pack
from linked l
where l.pack_product_id is null
   or l.unit_product_id is null
   or l.current_units_per_pack is null
   or l.unlinked_components > 0
   or l.recorded_units_per_pack is null
   or l.recorded_units_per_pack < 2
;

alter view public.conversion_mismatches set (security_invoker = true);
revoke all on public.conversion_mismatches from public, anon, authenticated, service_role;
grant select on public.conversion_mismatches to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 12. Rol de empaque de un producto, consultable desde PostgREST sin listas de
--     ids: vista + relacion calculada sobre products (como price_review en
--     20261009c).
--       GET /products?select=id,pack_role!inner(is_pack,is_component)
--           &pack_role.is_pack=is.false&pack_role.is_component=is.false
-- -----------------------------------------------------------------------------

create or replace view public.product_pack_roles
with (security_invoker = true) as
select
  p.id as product_id,
  p.store_id,
  exists (
    select 1
    from public.product_pack_conversions c
    where c.pack_product_id = p.id
      and c.is_active
  ) as is_pack,
  exists (
    select 1
    from public.product_pack_components pc
    join public.product_pack_conversions c on c.id = pc.conversion_id
    where pc.unit_product_id = p.id
      and c.is_active
  ) as is_component,
  (
    select count(*)
    from public.product_pack_components pc
    join public.product_pack_conversions c on c.id = pc.conversion_id
    where pc.unit_product_id = p.id
      and c.is_active
  )::integer as component_recipes
from public.products p;

comment on view public.product_pack_roles is
  'Rol de empaque de cada producto: is_pack (tiene receta activa), is_component (sale de alguna receta activa) y de cuantas.';

revoke all on public.product_pack_roles from public, anon, authenticated;
grant select on public.product_pack_roles to authenticated, service_role;

create or replace function public.pack_role(public.products)
returns setof public.product_pack_roles
rows 1
language sql
stable
set search_path = public
as $$
  select r.*
  from public.product_pack_roles r
  where r.product_id = $1.id;
$$;

comment on function public.pack_role(public.products) is
  'Relacion calculada de PostgREST: la fila de product_pack_roles del producto.';

revoke all on function public.pack_role(public.products) from public, anon;
grant execute on function public.pack_role(public.products) to authenticated, service_role;

commit;

notify pgrst, 'reload schema';
