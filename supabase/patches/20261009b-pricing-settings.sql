-- =============================================================================
-- 20261009b — ajustes de precios por tienda: semaforo de ganancia, chips de %
--             recomendados y % de ganancia sugerido por categoria (PRO-09)
-- Proyecto: BodegaHub (plan ux-mejoras, Ola 1; reglas 10, 10b y 13)
-- Requiere: 20260716-multi-store.sql (app_settings es una fila por tienda),
--           20261006i (funcion public.reject_non_finite_numeric) y 20261007a
--           (categories.tax_rate_id, app_settings.default_tax_rate_id).
--
--   1. app_settings (una fila por tienda, columnas; NO clave-valor):
--        * margin_yellow_from_pct numeric(6,2) not null default 15
--            por debajo de este % la ganancia es roja; desde aqui, amarilla.
--        * margin_green_from_pct  numeric(6,2) not null default 25
--            desde este % la ganancia es verde.
--        * markup_chips_pct numeric(6,2)[] not null default '{12,20,30}'
--            % de ganancia recomendados que ofrece el bloque de precio.
--      Mismos valores por defecto que @bodega/core (packages/core/src/pricing.ts:
--      DEFAULT_MARGIN_THRESHOLDS y DEFAULT_MARKUP_CHIPS). Las tiendas que ya
--      existen los reciben por el default de la columna: no se migra nada.
--      Checks:
--        * app_settings_margin_thresholds_check:
--            0 <= amarillo < verde <= 1000
--        * app_settings_markup_chips_check (public.is_valid_markup_chips):
--            arreglo de una dimension con 1 a 6 valores, cada uno > 0 y <= 1000,
--            sin NULL y sin duplicados (12 y 12.00 son el mismo valor).
--   2. categories.default_markup_pct numeric(6,2) null: % de ganancia sugerido
--      de la categoria (NULL = sin sugerencia). Check
--      categories_default_markup_pct_check: NULL o (> 0 y <= 1000).
--   3. NaN / Infinity: Infinity no cabe en numeric(6,2) (22003) y los checks de
--      arriba ya rechazan NaN (compara mayor
--      que todo: no pasa "<= 1000"). Ademas se
--      regeneran los dos triggers trg_zz_reject_non_finite_numeric_* de
--      app_settings y categories (20261006i los crea desde el catalogo: una
--      columna numeric nueva no entra sola), para que respondan con su PT400
--      "Valor numerico invalido en <columna>" tambien en las columnas nuevas.
--      Mismo generador que 20261006i, acotado a estas dos tablas. El arreglo de
--      chips no es una columna numeric (es numeric[]): lo cubre solo su check.
--
--   "Alicuota por defecto para categorias nuevas": YA existe desde 20261007a
--   (app_settings.default_tax_rate_id, sincronizada por trigger con
--   default_tax_rate). Este parche no la duplica ni la toca.
--
--   Seguridad: no cambia politicas ni grants. Las columnas nuevas quedan bajo
--   las politicas de fila que ya existen (app_settings: lectura de la propia
--   tienda, escritura solo admin de la tienda; categories: las suyas) y bajo
--   los grants de tabla vigentes (no hay grants por columna en estas tablas).
--   public.is_valid_markup_chips es pura (no lee ni escribe tablas); la ejecuta
--   quien escribe la fila, por eso authenticated conserva execute.
--
-- No toca stock, dinero, precios ni ninguna RPC. El semaforo es una alerta:
-- nada aqui bloquea una venta ni cambia un precio.
-- Idempotente, una sola transaccion. Ejecutar en SQL Editor o via db-up ANTES
-- de desplegar el BFF que lee estas columnas.
-- OJO: tras reaplicar 20261006i no hace falta reaplicar este (su barrido ya
-- incluye las columnas nuevas).
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Validacion del arreglo de chips. Un check no admite subconsultas: va en
--    una funcion inmutable. coalesce(..., false): con '{}' array_ndims es NULL y
--    un check con resultado NULL se da por cumplido.
-- -----------------------------------------------------------------------------

create or replace function public.is_valid_markup_chips(p_chips numeric[])
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(
    array_ndims(p_chips) = 1
    and cardinality(p_chips) between 1 and 6
    and not exists (
      select 1
      from unnest(p_chips) as chip(pct)
      where chip.pct is null or not (chip.pct > 0 and chip.pct <= 1000)
    )
    and (select count(distinct chip.pct) from unnest(p_chips) as chip(pct)) = cardinality(p_chips),
    false
  );
$$;

comment on function public.is_valid_markup_chips(numeric[]) is
  'Chips de % de ganancia validos: 1 a 6 valores, cada uno > 0 y <= 1000, sin NULL ni duplicados.';

revoke all on function public.is_valid_markup_chips(numeric[]) from public, anon;
grant execute on function public.is_valid_markup_chips(numeric[]) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. app_settings: semaforo y chips.
-- -----------------------------------------------------------------------------

alter table public.app_settings
  add column if not exists margin_yellow_from_pct numeric(6,2) not null default 15,
  add column if not exists margin_green_from_pct numeric(6,2) not null default 25,
  add column if not exists markup_chips_pct numeric(6,2)[] not null default '{12,20,30}'::numeric(6,2)[];

comment on column public.app_settings.margin_yellow_from_pct is
  'Semaforo de ganancia: por debajo de este % es rojo; desde este %, amarillo.';
comment on column public.app_settings.margin_green_from_pct is
  'Semaforo de ganancia: desde este % es verde.';
comment on column public.app_settings.markup_chips_pct is
  '% de ganancia recomendados del bloque de precio (1 a 6, sin duplicados).';

alter table public.app_settings drop constraint if exists app_settings_margin_thresholds_check;
alter table public.app_settings
  add constraint app_settings_margin_thresholds_check
  check (
    margin_yellow_from_pct >= 0
    and margin_yellow_from_pct < margin_green_from_pct
    and margin_green_from_pct <= 1000
  );

alter table public.app_settings drop constraint if exists app_settings_markup_chips_check;
alter table public.app_settings
  add constraint app_settings_markup_chips_check
  check (public.is_valid_markup_chips(markup_chips_pct));

-- -----------------------------------------------------------------------------
-- 3. categories: % de ganancia sugerido (opcional).
-- -----------------------------------------------------------------------------

alter table public.categories
  add column if not exists default_markup_pct numeric(6,2);

comment on column public.categories.default_markup_pct is
  '% de ganancia sugerido para los productos de la categoria (NULL = sin sugerencia). Es una sugerencia: no cambia precios.';

alter table public.categories drop constraint if exists categories_default_markup_pct_check;
alter table public.categories
  add constraint categories_default_markup_pct_check
  check (default_markup_pct is null or (default_markup_pct > 0 and default_markup_pct <= 1000));

-- -----------------------------------------------------------------------------
-- 4. Triggers de 20261006i (NaN / Infinity -> PT400) regenerados para las dos
--    tablas con columnas numeric nuevas. Mismo generador, acotado a ellas.
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
    where c.oid in ('public.app_settings'::regclass, 'public.categories'::regclass)
      and a.attnum > 0
      and not a.attisdropped
      and a.attgenerated = ''
      and a.atttypid = 'numeric'::regtype
    group by c.oid
    order by c.oid::regclass::text
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

commit;

notify pgrst, 'reload schema';
