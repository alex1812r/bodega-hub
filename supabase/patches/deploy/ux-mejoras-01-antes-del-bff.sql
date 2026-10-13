-- =============================================================================
-- ux-mejoras 01 — parches que van ANTES de desplegar el BFF
-- Proyecto: BodegaHub · plan ux-mejoras
--
-- Que es: los 24 parches del plan ux-mejoras que se aplican antes del BFF nuevo, concatenados en el
-- orden de despliegue (que NO es el alfabetico de sus nombres):
--   20261007a-tax-rates, 20261007b-tax-rates-store-override, 20261008a-register-payment-idempotency,
--   20261009a-product-margin-pct, 20261009b-pricing-settings, 20261009c-price-review, 20261009d-assorted-pack,
--   20261009e-supplier-preferred, 20261009f-price-and-product-idempotency, 20261010a-purchase-auto-link,
--   20261010b-purchase-inactive-product, 20261010d-receive-disassemble,
--   20261010e-pack-recipe-always-disassemble, 20261010f-receive-disassemble-invariant,
--   20261011a-inventory-overview, 20261011b-adjust-stock-inactive, 20261011c-save-pack-recipe,
--   20261012a-save-pack-recipe-always-disassemble, 20261012b-price-review-disassemble,
--   20261013a-report-money-views, 20261013b-report-inventory-views, 20261015a-cash-close-diff-alert,
--   20261017a-reprice-idempotency, 20261018a-reports-exclude-draft-sales
--
-- Cuando se ejecuta (secuencia completa):
--   1. comprobaciones previas de docs/despliegue-ux-mejoras.md, seccion 1 (serie de integridad de stock completa,
--      administradores con permisos de venta ya concedidos, ventana sin operacion, app movil, scripts propios,
--      compras con paid_ref / paid_ves desalineados). Leerlas ahi: no se repiten aqui.
--   2. ESTE ARCHIVO (01).
--   3. supabase/patches/verify-patches.sql. Deben quedar en fail TRES filas, y solo esas, las que exigen los dos
--      parches del archivo 02:
--        - la de la politica de lectura de payments de 20261010c;
--        - la de privilegios de 20261011d (escritura directa de las recetas de empaque revocada);
--        - la de RLS de product_pack_components de 20261009d (que exige el estado final de 20261011d).
--      Cualquier otra fila en fail: parar y revisar antes de desplegar el BFF.
--   4. desplegar el BFF.
--   5. supabase/patches/deploy/ux-mejoras-02-despues-del-bff.sql.
--   6. supabase/patches/verify-patches.sql: ninguna fila en fail.
--
-- Idempotente: cada parche lo es y va en su propia transaccion (begin / commit propios); este archivo se puede
-- ejecutar otra vez sin romper datos, y el verify queda igual. Si un parche falla, los anteriores ya quedaron
-- aplicados: corregir la causa y volver a ejecutar el archivo entero.
--
-- Avisos de cada parche (que migra, que bloquea, que cambia a la vista y que hay que reaplicar si se reaplica un
-- parche anterior): docs/despliegue-ux-mejoras.md, secciones 2 y 3, y la cabecera de cada parche mas abajo.
--
-- ARCHIVO GENERADO por scripts/build-deploy-sql.mjs (npm run deploy:sql). NO editarlo a mano: se cambia el parche
-- en supabase/patches/ (o la lista del script) y se regenera. Los parches van tal cual, uno tras otro, cada uno
-- precedido de una linea `-- ===== <archivo> =====`.
-- =============================================================================

-- ===== 20261007a-tax-rates.sql =====
-- =============================================================================
-- 20261007a — catalogo de alicuotas de IVA (tax_rates) y tax_rate_code en compras (SHR-10)
-- Proyecto: BodegaHub (plan ux-mejoras, Ola 0; regla 13: "el IVA es un catalogo,
--           no un numero")
-- Requiere: 20260716-multi-store.sql, 20260809-category-tax-rate.sql y la serie
--           20261006a … i completa (create_purchase parte de la version de
--           20261006h; los triggers de NaN son los de 20261006i).
--
--   1. public.tax_rates: alicuotas de IVA. store_id NULL = global (todas las
--      tiendas); store_id = alicuota propia de esa tienda. Semilla global:
--      exento 0, reducida 8, general 16.
--        * Unicidad: dos indices unicos parciales, (code) entre las globales y
--          (store_id, code) dentro de cada tienda. Un mismo code PUEDE existir
--          como global y en una tienda: la fila de la tienda MANDA sobre la
--          global en esa tienda (tax_rates_for_store). Asi el admin de una
--          tienda desactiva o cambia "reducida" para si sin tocar a las demas.
--        * code y store_id no cambian nunca (PT400): purchase_items guarda el
--          code como texto. Para "renombrar" se crea otra y se desactiva la vieja.
--        * No se borran por PostgREST (sin privilegio de delete): se desactivan.
--        * RLS: lectura = globales + las de la tienda del usuario; alta y
--          cambio = admin de la tienda sobre las suyas (mismo camino que
--          app_settings). Las globales solo se escriben por conexion directa
--          (SQL Editor) o service_role.
--   2. categories.tax_rate_id (FK). categories.tax_rate sigue existiendo durante
--      la transicion y se mantiene igual al pct de la alicuota por trigger, en
--      los dos sentidos:
--        * llega / cambia tax_rate_id  -> tax_rate := pct de la alicuota (debe ser
--          global o de la tienda de la categoria; si no, PT400);
--        * un escritor antiguo solo cambia tax_rate -> se busca la alicuota de la
--          tienda (propia o global, activa primero) con ese pct y se fija
--          tax_rate_id; si no existe ninguna, PT400: no se inventan porcentajes;
--        * cambia el pct de una alicuota -> se copia a las categorias (y ajustes)
--          que la usan. Las lineas de compra NO cambian: su tax_rate es snapshot.
--   3. purchase_items.tax_rate_code (nullable): code de la alicuota de la linea.
--      purchase_items.tax_rate sigue siendo el porcentaje congelado.
--   4. app_settings.default_tax_rate_id (FK). app_settings es una fila por tienda
--      con la columna default_tax_rate: se anade la columna hermana y se migra.
--      Sincronizada por trigger con default_tax_rate; a diferencia de
--      categories, un porcentaje sin alicuota NO se rechaza (deja
--      default_tax_rate_id en NULL): este parche no cambia lo que acepta hoy la
--      pantalla de Configuracion (lo hace PRO-09 al quitar el campo numerico).
--   5. Migracion de datos: 16 -> general, 8 -> reducida, 0 -> exento. Cualquier
--      otro porcentaje que exista en categories o en app_settings crea en ESA
--      tienda la alicuota 'otro-<pct>' INACTIVA. Quedan listadas en la vista
--      tax_rates_pending_review (y en un NOTICE al aplicar) para que el admin
--      las revise. purchase_items historico recibe tax_rate_code cuando su
--      porcentaje corresponde a una alicuota de su tienda; tax_rate no se toca.
--   6. create_purchase acepta "tax_rate_code" opcional en cada linea de p_items:
--        * con tax_rate_code -> debe existir y estar ACTIVA para la tienda; el
--          porcentaje de la linea es el de la alicuota; si ademas viene tax_rate
--          y no coincide, PT400;
--        * solo tax_rate (clientes actuales) -> debe ser el pct de una alicuota
--          ACTIVA de la tienda; se guarda su code; si no, PT400;
--        * ninguno de los dos -> igual que antes (PT400 "Cada item debe enviar
--          costos/subtotales/impuesto en REF y VES").
--      Copia de 20261006h con ese unico anadido: misma firma de 14 argumentos,
--      misma idempotencia (p_items entra tal cual en el hash), mismo orden de
--      bloqueos, mismos calculos de costo y totales, movimientos con stock_after
--      NULL y ninguna escritura de current_stock.
--
-- Idempotente, una sola transaccion. Ejecutar en SQL Editor o via db-up.
-- Reaplicar 20261006c, f o h reinstala el create_purchase anterior (sin
-- tax_rate_code): volver a aplicar este parche despues.
-- OJO: actualiza todas las filas de categories (tax_rate_id) y las de
-- purchase_items con porcentaje reconocido (tax_rate_code) la primera vez.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Tabla tax_rates
-- -----------------------------------------------------------------------------

create table if not exists public.tax_rates (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references public.stores(id) on delete cascade,
  code text not null,
  label text not null,
  pct numeric(5,2) not null,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tax_rates_code_format check (code ~ '^[a-z0-9]+([.-][a-z0-9]+)*$' and length(code) <= 40),
  constraint tax_rates_label_not_blank check (btrim(label) <> ''),
  constraint tax_rates_pct_range check (pct >= 0 and pct <= 100)
);

comment on table public.tax_rates is
  'Alicuotas de IVA. store_id NULL = global; con store_id = propia de la tienda y manda sobre la global del mismo code (tax_rates_for_store).';

create unique index if not exists tax_rates_global_code_unique
  on public.tax_rates (code)
  where store_id is null;

create unique index if not exists tax_rates_store_code_unique
  on public.tax_rates (store_id, code)
  where store_id is not null;

drop trigger if exists trg_tax_rates_updated_at on public.tax_rates;
create trigger trg_tax_rates_updated_at
before update on public.tax_rates
for each row execute function public.set_updated_at();

-- code y ambito son la identidad de la alicuota: purchase_items.tax_rate_code la
-- guarda como texto.
create or replace function public.tax_rates_guard_identity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.code is distinct from old.code or new.store_id is distinct from old.store_id then
    raise exception using
      errcode = 'PT400',
      message = 'El codigo y la tienda de una alicuota de IVA no se pueden cambiar: crea una nueva y desactiva la anterior';
  end if;

  return new;
end;
$$;

revoke all on function public.tax_rates_guard_identity() from public, anon, authenticated;
grant execute on function public.tax_rates_guard_identity() to service_role;

drop trigger if exists trg_tax_rates_guard_identity on public.tax_rates;
create trigger trg_tax_rates_guard_identity
before update on public.tax_rates
for each row execute function public.tax_rates_guard_identity();

alter table public.tax_rates enable row level security;

drop policy if exists "Authenticated users read tax rates" on public.tax_rates;
create policy "Authenticated users read tax rates"
on public.tax_rates for select
to authenticated
using (store_id is null or store_id = public.current_user_store_id());

drop policy if exists "Admins insert tax rates" on public.tax_rates;
create policy "Admins insert tax rates"
on public.tax_rates for insert
to authenticated
with check (
  store_id = public.current_user_store_id()
  and public.current_user_role() = 'admin'
);

drop policy if exists "Admins update tax rates" on public.tax_rates;
create policy "Admins update tax rates"
on public.tax_rates for update
to authenticated
using (
  store_id = public.current_user_store_id()
  and public.current_user_role() = 'admin'
)
with check (
  store_id = public.current_user_store_id()
  and public.current_user_role() = 'admin'
);

revoke all on public.tax_rates from public, anon, authenticated;
grant select, insert, update on public.tax_rates to authenticated;
grant all on public.tax_rates to service_role;

insert into public.tax_rates (store_id, code, label, pct, is_active, sort_order)
values
  (null, 'exento', 'Exento', 0, true, 10),
  (null, 'reducida', 'Reducida', 8, true, 20),
  (null, 'general', 'General', 16, true, 30)
on conflict (code) where store_id is null do nothing;

-- -----------------------------------------------------------------------------
-- 2. Resolucion de alicuotas de una tienda. Security invoker: quien las llama
--    por PostgREST solo ve lo que le deja el RLS (globales + su tienda); dentro
--    de create_purchase y de los triggers corren como propietario.
-- -----------------------------------------------------------------------------

-- Alicuotas vigentes para una tienda: las suyas mas las globales cuyo code no
-- haya redefinido la tienda.
create or replace function public.tax_rates_for_store(p_store_id uuid)
returns setof public.tax_rates
language sql
stable
set search_path = public
as $$
  select t.*
  from public.tax_rates t
  where t.store_id = p_store_id
     or (
       t.store_id is null
       and not exists (
         select 1
         from public.tax_rates o
         where o.store_id = p_store_id
           and o.code = t.code
       )
     );
$$;

revoke all on function public.tax_rates_for_store(uuid) from public, anon;
grant execute on function public.tax_rates_for_store(uuid) to authenticated, service_role;

-- Alicuota de la tienda con ese porcentaje (0 o 1 fila). Si hay varias: activa
-- primero, despues sort_order y code.
create or replace function public.tax_rate_for_pct(p_store_id uuid, p_pct numeric, p_only_active boolean)
returns setof public.tax_rates
language sql
stable
set search_path = public
as $$
  select t.*
  from public.tax_rates_for_store(p_store_id) t
  where t.pct = p_pct
    and (t.is_active or not coalesce(p_only_active, true))
  order by t.is_active desc, t.sort_order, t.code, t.id
  limit 1;
$$;

revoke all on function public.tax_rate_for_pct(uuid, numeric, boolean) from public, anon, authenticated;
grant execute on function public.tax_rate_for_pct(uuid, numeric, boolean) to service_role;

-- -----------------------------------------------------------------------------
-- 3. Columnas nuevas
-- -----------------------------------------------------------------------------

alter table public.categories
  add column if not exists tax_rate_id uuid references public.tax_rates(id) on delete restrict;

create index if not exists idx_categories_tax_rate_id on public.categories (tax_rate_id);

alter table public.purchase_items
  add column if not exists tax_rate_code text;

alter table public.app_settings
  add column if not exists default_tax_rate_id uuid references public.tax_rates(id) on delete restrict;

-- -----------------------------------------------------------------------------
-- 4. Migracion de datos. Solo toca filas que aun no tienen alicuota: aplicar el
--    parche otra vez no cambia nada.
-- -----------------------------------------------------------------------------

-- 4a. Porcentajes sin alicuota -> 'otro-<pct>' inactiva en su tienda.
insert into public.tax_rates (store_id, code, label, pct, is_active, sort_order)
select distinct
  src.store_id,
  'otro-' || trim_scale(src.pct)::text,
  'Otro ' || replace(trim_scale(src.pct)::text, '.', ',') || ' %',
  src.pct,
  false,
  900
from (
  select c.store_id, c.tax_rate as pct
  from public.categories c
  where c.tax_rate_id is null
  union
  select s.store_id, s.default_tax_rate
  from public.app_settings s
  where s.default_tax_rate_id is null
) src
where (src.pct - src.pct) = 0
  and src.pct >= 0
  and src.pct <= 100
  and not exists (
    select 1
    from public.tax_rates_for_store(src.store_id) t
    where t.pct = src.pct
  )
on conflict (store_id, code) where store_id is not null do nothing;

-- 4b. categories.tax_rate_id por porcentaje.
update public.categories c
set tax_rate_id = (select t.id from public.tax_rate_for_pct(c.store_id, c.tax_rate, false) t)
where c.tax_rate_id is null
  and exists (select 1 from public.tax_rate_for_pct(c.store_id, c.tax_rate, false));

-- 4c. app_settings.default_tax_rate_id por porcentaje.
update public.app_settings s
set default_tax_rate_id = (select t.id from public.tax_rate_for_pct(s.store_id, s.default_tax_rate, false) t)
where s.default_tax_rate_id is null
  and exists (select 1 from public.tax_rate_for_pct(s.store_id, s.default_tax_rate, false));

-- 4d. purchase_items.tax_rate_code de las lineas historicas con correspondencia.
with pairs as (
  select distinct pu.store_id, pi.tax_rate
  from public.purchase_items pi
  join public.purchases pu on pu.id = pi.purchase_id
  where pi.tax_rate_code is null
    and pi.tax_rate is not null
),
mapped as (
  select p.store_id, p.tax_rate, m.code
  from pairs p
  cross join lateral public.tax_rate_for_pct(p.store_id, p.tax_rate, false) m
)
update public.purchase_items pi
set tax_rate_code = mapped.code
from public.purchases pu, mapped
where pu.id = pi.purchase_id
  and mapped.store_id = pu.store_id
  and mapped.tax_rate = pi.tax_rate
  and pi.tax_rate_code is null;

-- -----------------------------------------------------------------------------
-- 5. Sincronizacion tax_rate <-> tax_rate_id. Security definer: solo leen
--    tax_rates y deben ver las de la tienda de la FILA, no las del usuario.
--    Un NaN / Infinity se deja pasar: lo rechaza despues, con su propio mensaje,
--    trg_zz_reject_non_finite_numeric_* (20261006i).
-- -----------------------------------------------------------------------------

create or replace function public.categories_sync_tax_rate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rate public.tax_rates;
begin
  if (new.tax_rate - new.tax_rate) <> 0 then
    return new;
  end if;

  -- Escritor nuevo: manda tax_rate_id y tax_rate se deriva.
  if new.tax_rate_id is not null
     and (tg_op = 'INSERT' or new.tax_rate_id is distinct from old.tax_rate_id) then
    select * into v_rate
    from public.tax_rates t
    where t.id = new.tax_rate_id
      and (t.store_id is null or t.store_id = new.store_id);

    if not found then
      raise exception using
        errcode = 'PT400',
        message = 'La alicuota de IVA indicada no existe para esta tienda';
    end if;

    new.tax_rate := v_rate.pct;
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.tax_rate_id is not null
     and new.tax_rate is not distinct from old.tax_rate
     and new.store_id is not distinct from old.store_id then
    return new;
  end if;

  -- Escritor antiguo: solo cambio tax_rate. Si la alicuota que ya tiene la
  -- categoria vale ese porcentaje (p. ej. le cambiaron el pct), se conserva.
  if new.tax_rate_id is not null and exists (
    select 1
    from public.tax_rates t
    where t.id = new.tax_rate_id
      and (t.store_id is null or t.store_id = new.store_id)
      and t.pct = new.tax_rate
  ) then
    return new;
  end if;

  select * into v_rate
  from public.tax_rate_for_pct(new.store_id, new.tax_rate, false);

  if not found then
    raise exception using
      errcode = 'PT400',
      message = format(
        'No existe una alicuota de IVA de %s %%: elige una del catalogo o creala en Configuracion',
        trim_scale(new.tax_rate)
      );
  end if;

  new.tax_rate_id := v_rate.id;
  return new;
end;
$$;

revoke all on function public.categories_sync_tax_rate() from public, anon, authenticated;
grant execute on function public.categories_sync_tax_rate() to service_role;

drop trigger if exists trg_categories_sync_tax_rate on public.categories;
create trigger trg_categories_sync_tax_rate
before insert or update on public.categories
for each row execute function public.categories_sync_tax_rate();

-- app_settings: misma sincronizacion, pero un porcentaje sin alicuota no se
-- rechaza (default_tax_rate_id queda en NULL). Un default_tax_rate_id que no sea
-- de la tienda si se rechaza.
create or replace function public.app_settings_sync_default_tax_rate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rate public.tax_rates;
begin
  if (new.default_tax_rate - new.default_tax_rate) <> 0 then
    return new;
  end if;

  if new.default_tax_rate_id is not null
     and (tg_op = 'INSERT' or new.default_tax_rate_id is distinct from old.default_tax_rate_id) then
    select * into v_rate
    from public.tax_rates t
    where t.id = new.default_tax_rate_id
      and (t.store_id is null or t.store_id = new.store_id);

    if not found then
      raise exception using
        errcode = 'PT400',
        message = 'La alicuota de IVA indicada no existe para esta tienda';
    end if;

    new.default_tax_rate := v_rate.pct;
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.default_tax_rate_id is not null
     and new.default_tax_rate is not distinct from old.default_tax_rate
     and new.store_id is not distinct from old.store_id then
    return new;
  end if;

  if new.default_tax_rate_id is not null and exists (
    select 1
    from public.tax_rates t
    where t.id = new.default_tax_rate_id
      and (t.store_id is null or t.store_id = new.store_id)
      and t.pct = new.default_tax_rate
  ) then
    return new;
  end if;

  new.default_tax_rate_id := (
    select t.id from public.tax_rate_for_pct(new.store_id, new.default_tax_rate, false) t
  );
  return new;
end;
$$;

revoke all on function public.app_settings_sync_default_tax_rate() from public, anon, authenticated;
grant execute on function public.app_settings_sync_default_tax_rate() to service_role;

drop trigger if exists trg_app_settings_sync_default_tax_rate on public.app_settings;
create trigger trg_app_settings_sync_default_tax_rate
before insert or update on public.app_settings
for each row execute function public.app_settings_sync_default_tax_rate();

-- Cambio del pct de una alicuota: se copia a las columnas derivadas. Los
-- triggers de arriba ven que la alicuota de la fila ya vale ese porcentaje y la
-- conservan.
create or replace function public.tax_rates_propagate_pct()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.categories
  set tax_rate = new.pct
  where tax_rate_id = new.id
    and tax_rate is distinct from new.pct;

  update public.app_settings
  set default_tax_rate = new.pct
  where default_tax_rate_id = new.id
    and default_tax_rate is distinct from new.pct;

  return null;
end;
$$;

revoke all on function public.tax_rates_propagate_pct() from public, anon, authenticated;
grant execute on function public.tax_rates_propagate_pct() to service_role;

drop trigger if exists trg_tax_rates_propagate_pct on public.tax_rates;
create trigger trg_tax_rates_propagate_pct
after update of pct on public.tax_rates
for each row
when (new.pct is distinct from old.pct)
execute function public.tax_rates_propagate_pct();

-- -----------------------------------------------------------------------------
-- 6. tax_rates.pct es numeric: mismos dos triggers de 20261006i (rechazan NaN /
--    Infinity con PT400). Mismo generador, acotado a esta tabla.
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
    where c.oid = 'public.tax_rates'::regclass
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
-- 7. Reporte para el admin: alicuotas 'otro-<pct>' creadas por la migracion que
--    siguen inactivas, con las categorias que las usan. security_invoker: cada
--    usuario ve solo las de su tienda (store_name solo lo ve quien lee stores).
--      select * from public.tax_rates_pending_review;
-- -----------------------------------------------------------------------------

create or replace view public.tax_rates_pending_review
with (security_invoker = true)
as
select
  t.id as tax_rate_id,
  t.store_id,
  s.name as store_name,
  t.code,
  t.label,
  t.pct,
  (select count(*)::integer from public.categories c where c.tax_rate_id = t.id) as categories_count,
  (
    select coalesce(array_agg(c.name order by c.name), array[]::text[])
    from public.categories c
    where c.tax_rate_id = t.id
  ) as category_names,
  exists (select 1 from public.app_settings a where a.default_tax_rate_id = t.id) as is_store_default,
  t.created_at
from public.tax_rates t
left join public.stores s on s.id = t.store_id
where t.code like 'otro-%'
  and not t.is_active;

comment on view public.tax_rates_pending_review is
  'Alicuotas otro-<pct> inactivas creadas por la migracion 20261007a: el admin debe reasignar sus categorias a una alicuota del catalogo o activarlas.';

revoke all on public.tax_rates_pending_review from public, anon;
grant select on public.tax_rates_pending_review to authenticated, service_role;

do $$
declare
  r record;
  v_total integer := 0;
begin
  for r in
    select * from public.tax_rates_pending_review order by store_name nulls last, pct
  loop
    v_total := v_total + 1;
    raise notice 'tax_rates por revisar: tienda % (%) · % (% %%) · categorias: % · por defecto de la tienda: %',
      coalesce(r.store_name, '?'), r.store_id, r.code, r.pct, r.category_names, r.is_store_default;
  end loop;

  raise notice 'tax_rates por revisar: % alicuota(s) otro-<pct> inactiva(s) (select * from public.tax_rates_pending_review)', v_total;
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. create_purchase — copia de 20261006h + tax_rate_code por linea. Misma firma.
--    Unicos cambios: dos variables, el bloque "SHR-10" tras leer los montos de
--    la linea y la columna tax_rate_code en el insert de purchase_items.
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

commit;

notify pgrst, 'reload schema';

-- ===== 20261007b-tax-rates-store-override.sql =====
-- =============================================================================
-- 20261007b — cambio atomico de una alicuota de IVA para la tienda (SHR-10)
-- Proyecto: BodegaHub (plan ux-mejoras, Ola 0)
-- Requiere: 20261007a-tax-rates.sql (tabla tax_rates, tax_rates_for_store y los
--           triggers de sincronizacion de categories / app_settings).
--
--   public.override_tax_rate_for_store(p_tax_rate_id, p_label, p_pct,
--                                      p_is_active, p_sort_order)
--
--   Unico camino del BFF (PATCH /api/tax-rates/{id}) para cambiar una alicuota.
--   Cada parametro en NULL deja el valor como esta. Todo ocurre en UNA
--   transaccion: o queda aplicado entero o no cambia nada.
--     * Alicuota propia de la tienda -> se actualiza.
--     * Alicuota global -> las globales no se escriben: la tienda recibe su
--       propia fila con el mismo code (copia de la global) y sobre ella se
--       aplica el cambio. Si otra transaccion la creo a la vez, se reutiliza
--       (no se duplica). Un cambio que no cambia nada de una global no crea fila.
--     * En los dos casos, las categories.tax_rate_id y el
--       app_settings.default_tax_rate_id de ESA tienda que apuntaban a la global
--       del mismo code pasan a la fila de la tienda (los triggers de 20261007a
--       copian el porcentaje).
--   Rechazos:
--     * 42501 sin tienda activa (assert_store_context); PT403 si el rol no es admin.
--     * PT400: label vacio, pct fuera de 0..100 o no finito, sort_order negativo.
--     * PT404: la alicuota no existe para la tienda (id inexistente, de otra
--       tienda, o global que la tienda ya redefinio: su fila propia es la vigente).
--     * PT409: desactivar una alicuota que usan categorias activas de la tienda
--       o que es su alicuota por defecto. Mismo texto que
--       buildTaxRateInUseMessage (src/modules/settings/services/taxRates.schemas.ts).
--   Bloqueos, siempre en este orden: la alicuota (for update), las categorias
--   de la tienda que la usan (order by id) y la fila de app_settings.
--   No toca purchase_items (su tax_rate es snapshot), stock ni dinero.
--
-- Idempotente (create or replace), una sola transaccion. No migra ni toca filas.
-- Ejecutar en SQL Editor o via db-up, despues de 20261007a.
-- =============================================================================

begin;

create or replace function public.override_tax_rate_for_store(
  p_tax_rate_id uuid,
  p_label text default null,
  p_pct numeric default null,
  p_is_active boolean default null,
  p_sort_order integer default null
)
returns public.tax_rates
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_rate public.tax_rates;
  v_global_id uuid;
  v_label text;
  v_pct numeric(5,2);
  v_is_active boolean;
  v_sort_order integer;
  v_active_categories integer;
  v_is_default boolean;
  v_usage text;
  v_prefix text;
begin
  v_store_id := public.assert_store_context();

  if coalesce(public.current_user_role()::text, '') <> 'admin' then
    raise exception using errcode = 'PT403', message = 'No autorizado para modificar alicuotas de IVA';
  end if;

  if p_tax_rate_id is null then
    raise exception using errcode = 'PT400', message = 'La alicuota de IVA es obligatoria';
  end if;

  if p_label is not null and btrim(p_label) = '' then
    raise exception using errcode = 'PT400', message = 'El nombre de la alicuota es obligatorio.';
  end if;

  -- (x - x) <> 0 detecta NaN e Infinity sin literales (igual que 20261006i).
  if p_pct is not null and ((p_pct - p_pct) <> 0 or p_pct < 0 or p_pct > 100) then
    raise exception using errcode = 'PT400', message = 'El porcentaje debe estar entre 0 y 100.';
  end if;

  if p_sort_order is not null and p_sort_order < 0 then
    raise exception using errcode = 'PT400', message = 'El orden de la alicuota no puede ser negativo';
  end if;

  select * into v_rate
  from public.tax_rates t
  where t.id = p_tax_rate_id
    and (t.store_id is null or t.store_id = v_store_id);

  if not found then
    raise exception using errcode = 'PT404', message = 'Alicuota de IVA no encontrada.';
  end if;

  if v_rate.store_id is null then
    -- Global que la tienda ya redefinio: para ella no existe (tax_rates_for_store).
    if exists (
      select 1
      from public.tax_rates o
      where o.store_id = v_store_id
        and o.code = v_rate.code
    ) then
      raise exception using errcode = 'PT404', message = 'Alicuota de IVA no encontrada.';
    end if;

    if coalesce(btrim(p_label), v_rate.label) = v_rate.label
       and coalesce(p_pct::numeric(5,2), v_rate.pct) = v_rate.pct
       and coalesce(p_is_active, v_rate.is_active) = v_rate.is_active
       and coalesce(p_sort_order, v_rate.sort_order) = v_rate.sort_order then
      return v_rate;
    end if;

    v_global_id := v_rate.id;

    -- Copia de la global en la tienda. Si otra transaccion la crea a la vez,
    -- esta espera en el indice unico y reutiliza la fila ya creada.
    insert into public.tax_rates (store_id, code, label, pct, is_active, sort_order)
    values (v_store_id, v_rate.code, v_rate.label, v_rate.pct, v_rate.is_active, v_rate.sort_order)
    on conflict (store_id, code) where store_id is not null do nothing;

    select * into strict v_rate
    from public.tax_rates t
    where t.store_id = v_store_id
      and t.code = v_rate.code
    for update;
  else
    select * into strict v_rate
    from public.tax_rates t
    where t.id = p_tax_rate_id
    for update;

    select t.id into v_global_id
    from public.tax_rates t
    where t.store_id is null
      and t.code = v_rate.code;
  end if;

  perform 1
  from public.categories c
  where c.store_id = v_store_id
    and (c.tax_rate_id = v_rate.id or c.tax_rate_id = v_global_id)
  order by c.id
  for update;

  perform 1
  from public.app_settings s
  where s.store_id = v_store_id
  for update;

  -- La fila de la tienda manda sobre la global del mismo code: lo que en la
  -- tienda apuntaba a la global pasa a la fila propia.
  if v_global_id is not null then
    update public.categories
    set tax_rate_id = v_rate.id
    where store_id = v_store_id
      and tax_rate_id = v_global_id;

    update public.app_settings
    set default_tax_rate_id = v_rate.id
    where store_id = v_store_id
      and default_tax_rate_id = v_global_id;
  end if;

  v_label := coalesce(btrim(p_label), v_rate.label);
  v_pct := coalesce(p_pct, v_rate.pct);
  v_is_active := coalesce(p_is_active, v_rate.is_active);
  v_sort_order := coalesce(p_sort_order, v_rate.sort_order);

  if v_rate.is_active and not v_is_active then
    select count(*)::integer into v_active_categories
    from public.categories c
    where c.store_id = v_store_id
      and c.tax_rate_id = v_rate.id
      and c.is_active;

    v_is_default := exists (
      select 1
      from public.app_settings s
      where s.store_id = v_store_id
        and s.default_tax_rate_id = v_rate.id
    );

    if v_active_categories > 0 or v_is_default then
      v_prefix := 'No se puede desactivar la alicuota "' || v_rate.label || '": ';
      v_usage := case
        when v_active_categories = 1 then 'la usa 1 categoria activa'
        else 'la usan ' || v_active_categories || ' categorias activas'
      end;

      raise exception using
        errcode = 'PT409',
        message = case
          when v_active_categories > 0 and v_is_default then
            v_prefix || v_usage || ' y es la alicuota por defecto de la tienda. Reasigna esas categorias y elige otra por defecto antes de desactivarla.'
          when v_is_default then
            v_prefix || 'es la alicuota por defecto de la tienda (' || v_usage || '). Elige otra por defecto antes de desactivarla.'
          else
            v_prefix || v_usage || '. Reasignalas a otra alicuota antes de desactivarla.'
        end;
    end if;
  end if;

  update public.tax_rates
  set label = v_label,
      pct = v_pct,
      is_active = v_is_active,
      sort_order = v_sort_order
  where id = v_rate.id
  returning * into v_rate;

  return v_rate;
end;
$$;

comment on function public.override_tax_rate_for_store(uuid, text, numeric, boolean, integer) is
  'Cambia una alicuota de IVA para la tienda del usuario (admin) en una transaccion: actualiza la propia o crea la fila de la tienda a partir de la global y le traspasa categorias y alicuota por defecto.';

revoke all on function public.override_tax_rate_for_store(uuid, text, numeric, boolean, integer) from public, anon;
grant execute on function public.override_tax_rate_for_store(uuid, text, numeric, boolean, integer) to authenticated, service_role;

commit;

notify pgrst, 'reload schema';

-- ===== 20261008a-register-payment-idempotency.sql =====
-- =============================================================================
-- 20261008a — clave de idempotencia de register_payment (PAG-06a, P4-3)
-- Proyecto: BodegaHub (plan ux-mejoras, Ola 1, modulo Pagos)
-- Requiere: 20261006c-purchases-inventory-rpc-hardening.sql (stock_request_hash)
--           y 20261006h-rls-store-scope-and-finite-guards.sql (register_payment
--           vigente, assert_finite_numeric).
--
-- P4-3 (docs/stock-integrity.md): register_payment no tenia clave de
-- idempotencia; un reintento de POST /api/payments tras un corte de red creaba
-- un segundo pago con su asiento de caja / baul. Mismo patron que C6
-- (create_purchase):
--   * p_client_request_id uuid default null, unica por tienda
--     (payments.client_request_id + huella payments.client_request_hash).
--   * Misma tienda + misma clave + mismo contenido + mismo usuario -> devuelve
--     el pago original SIN insertar pago ni tocar documento, caja o baul.
--   * Misma clave con otro contenido, otro usuario o un pago ya anulado -> PT409.
--   * Dos peticiones simultaneas con la misma clave se serializan con un
--     advisory lock transaccional por (tienda, clave) tomado antes de leer
--     ningun saldo; el indice unico queda de respaldo.
--   * Sin clave: comportamiento identico al de 20261006h.
--
-- La semantica monetaria NO cambia: el cuerpo es copia literal del de 20261006h
-- y solo se anaden el parametro, el bloque del replay y las dos columnas del
-- insert. create_sale_with_payments la llama con argumentos por nombre y sin
-- clave: no se toca.
--
-- Firma nueva (13 argumentos): se elimina la de 12 para no dejar dos
-- sobrecargas vivas (PGRST203). Reaplicar 20261006b, c, f, g o h reinstala la
-- de 12: volver a aplicar este parche despues.
--
-- Idempotente, una sola transaccion. No migra ni toca filas existentes.
-- Ejecutar en SQL Editor o via db-up.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Esquema: clave y huella en payments
-- -----------------------------------------------------------------------------

alter table public.payments
  add column if not exists client_request_id uuid;

alter table public.payments
  add column if not exists client_request_hash text;

comment on column public.payments.client_request_id is
  'Clave de idempotencia enviada por el cliente al registrar el pago (unica por tienda).';
comment on column public.payments.client_request_hash is
  'Huella del contenido enviado con client_request_id. La misma clave con otra huella se rechaza.';

create unique index if not exists payments_store_client_request_unique
  on public.payments (store_id, client_request_id)
  where client_request_id is not null;

-- -----------------------------------------------------------------------------
-- 2. Funcion interna (no es RPC: sin execute para los roles de PostgREST)
-- -----------------------------------------------------------------------------

-- Pago ya registrado con esa clave en la tienda. NULL si no hay ninguno; el
-- pago si es un reintento legitimo; PT409 en cualquier otro caso.
create or replace function public.payment_idempotent_replay(
  p_store_id uuid,
  p_client_request_id uuid,
  p_client_request_hash text
)
returns public.payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.payments;
begin
  select * into v_payment
  from public.payments
  where store_id = p_store_id
    and client_request_id = p_client_request_id;

  if not found then
    return null;
  end if;

  if v_payment.client_request_hash is distinct from p_client_request_hash
     or v_payment.created_by is distinct from auth.uid()
     or v_payment.status = 'anulado' then
    raise exception using
      errcode = 'PT409',
      message = 'La clave de idempotencia ya se usó en otro pago. Revisa el pago registrado antes de reintentar.';
  end if;

  return v_payment;
end;
$$;

revoke all on function public.payment_idempotent_replay(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.payment_idempotent_replay(uuid, uuid, text) to service_role;

-- -----------------------------------------------------------------------------
-- 3. register_payment — copia de 20261006h + P4-3 (clave de idempotencia)
-- -----------------------------------------------------------------------------

drop function if exists public.register_payment(
  uuid, uuid, public.payment_method, numeric, text, text, text, text,
  public.payment_method, numeric, jsonb, jsonb
);

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
  p_change_denominations jsonb default null,
  p_client_request_id uuid default null
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
  v_request_hash text;
begin
  v_store_id := public.assert_store_context();
  -- N4 — NaN / Infinity no son menores que 0 y atravesaban las guardas de abajo.
  perform public.assert_finite_numeric(p_amount, 'el monto del pago');
  perform public.assert_finite_numeric(p_change_amount, 'el monto del vuelto');

  -- P4-3 — reintento del mismo envio. El advisory lock serializa dos peticiones
  -- simultaneas con la misma clave ANTES de leer ningun saldo: la segunda espera
  -- el commit de la primera y encuentra su pago (nunca llega al indice unico).
  -- Un replay devuelve el pago original sin tocar documento, caja ni baul.
  if p_client_request_id is not null then
    perform pg_advisory_xact_lock(
      hashtextextended('payment-request:' || v_store_id::text || ':' || p_client_request_id::text, 0)
    );

    v_request_hash := public.stock_request_hash(jsonb_build_array(
      'register_payment',
      p_sale_id,
      p_purchase_id,
      p_method,
      round(p_amount, 2)::text,
      nullif(trim(p_bank_name), ''),
      nullif(trim(p_phone), ''),
      p_reference_code,
      p_notes,
      case when round(coalesce(p_change_amount, 0), 2) > 0 then p_change_method end,
      round(coalesce(p_change_amount, 0), 2)::text,
      p_received_denominations,
      p_change_denominations
    ));
    v_payment := public.payment_idempotent_replay(v_store_id, p_client_request_id, v_request_hash);

    if v_payment.id is not null then
      return v_payment;
    end if;
  end if;

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
    if coalesce(public.current_user_role()::text, '') not in ('admin', 'contador', 'vendedor') then
      raise exception 'No autorizado para registrar pagos de ventas' using errcode = 'PT403';
    end if;
    select * into v_sale from public.sales where id = p_sale_id and store_id = v_store_id for update;
    if not found then raise exception 'Venta no encontrada' using errcode = 'PT404'; end if;
    -- C8 — una venta cancelada o devuelta no admite cobros: el pago la devolvia a
    -- pendiente_pago y permitia devolverla (y reponer stock) otra vez.
    if v_sale.status in ('cancelada', 'devuelta') then
      raise exception 'No se puede registrar un pago en una venta cancelada o devuelta' using errcode = 'PT409';
    end if;
    -- R17 — ni un borrador (la misma guarda de return_sale): el cobro lo pasaba a
    -- pendiente_pago / pagada sin que su stock hubiera salido nunca.
    if v_sale.status not in ('pagada', 'pendiente_pago') then
      raise exception 'No se puede registrar un pago en una venta en borrador' using errcode = 'PT409';
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
    if coalesce(public.current_user_role()::text, '') not in ('admin', 'contador') then
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
    received_denominations, change_denominations,
    client_request_id, client_request_hash
  ) values (
    v_direction, p_sale_id, p_purchase_id, v_contact_id, p_method, v_currency, p_amount, v_amount_ves, v_amount_ref,
    v_rate, nullif(trim(p_bank_name), ''), nullif(trim(p_phone), ''), p_reference_code, p_notes, auth.uid(), v_store_id,
    v_change_method, case when v_change_method is null then 0 else v_change_amount end, v_change_ves, v_change_ref,
    p_received_denominations, p_change_denominations,
    p_client_request_id, case when p_client_request_id is not null then v_request_hash end
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
    -- R5 — la sesion se bloquea antes de escribir en cash_movements y se revalida
    -- que siga abierta: close_cash_session y el autocierre la toman for update,
    -- asi que o el cierre espera a este cobro y lo incluye, o el cobro espera al
    -- cierre y se rechaza. Orden: documento -> productos -> pago -> sesion -> baul.
    select * into v_session from public.cash_sessions
    where id = v_session.id and status = 'open' for share;
    if not found then
      raise exception 'La sesión de caja se cerró mientras se registraba el cobro. Abre la caja y vuelve a intentarlo'
        using errcode = 'PT409';
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
    -- R5 — la sesion se bloquea antes de escribir en cash_movements y se revalida
    -- que siga abierta: close_cash_session y el autocierre la toman for update,
    -- asi que o el cierre espera a este cobro y lo incluye, o el cobro espera al
    -- cierre y se rechaza. Orden: documento -> productos -> pago -> sesion -> baul.
    select * into v_session from public.cash_sessions
    where id = v_session.id and status = 'open' for share;
    if not found then
      raise exception 'La sesión de caja se cerró mientras se registraba el cobro. Abre la caja y vuelve a intentarlo'
        using errcode = 'PT409';
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
  public.payment_method, numeric, jsonb, jsonb, uuid
) from public, anon;
grant execute on function public.register_payment(
  uuid, uuid, public.payment_method, numeric, text, text, text, text,
  public.payment_method, numeric, jsonb, jsonb, uuid
) to authenticated, service_role;

commit;

notify pgrst, 'reload schema';

-- ===== 20261009a-product-margin-pct.sql =====
-- =============================================================================
-- 20261009a — % de ganancia del producto como columna generada (PRO-07)
-- Proyecto: BodegaHub (plan ux-mejoras, Ola 1)
-- Requiere: tabla public.products (schema base). No depende de otros parches.
--
--   products.margin_pct = (sale_price_ref - current_cost_ref) / current_cost_ref * 100
--
--   Ganancia = markup sobre el costo, todo en REF. current_cost_ref YA incluye
--   el IVA: aqui no se aplica ningun impuesto. Mismo calculo que markupPct de
--   @bodega/core (packages/core/src/pricing.ts), con sus mismos 6 decimales,
--   para que la banda del filtro del listado (GET /api/products?margin=...) y
--   la del semaforo que pinta la pantalla coincidan siempre.
--     * Costo 0 -> NULL ("Sin costo"): nunca division por cero.
--     * Precio por debajo del costo -> % negativo.
--   PostgREST no filtra ni ordena por expresion: por eso es una columna
--   GENERADA y ALMACENADA. Nadie la escribe; Postgres la recalcula sola cuando
--   cambia sale_price_ref o current_cost_ref (ediciones, update_product_price,
--   compras recibidas, importacion). No toca stock, dinero ni ninguna RPC.
--
--   Indice (store_id, margin_pct): filtro por banda y orden por % del listado.
--
-- OJO al aplicarlo: anadir una columna generada almacenada reescribe la tabla
-- products con bloqueo exclusivo durante la reescritura (corta con el catalogo
-- de una bodega; aplicarlo fuera de hora pico). No dispara triggers de fila.
-- Los triggers trg_zz_reject_non_finite_numeric_* (20261006i) ignoran las
-- columnas generadas: no hace falta reaplicar ese parche.
--
-- Idempotente (add column / create index if not exists), una sola transaccion.
-- Ejecutar en SQL Editor o via db-up ANTES de desplegar el BFF que filtra y
-- ordena por margin_pct.
-- =============================================================================

begin;

alter table public.products
  add column if not exists margin_pct numeric
  generated always as (
    case
      when current_cost_ref > 0
        then round((sale_price_ref - current_cost_ref) / current_cost_ref * 100, 6)
    end
  ) stored;

comment on column public.products.margin_pct is
  'Ganancia sobre el costo en % (markup en REF; el costo ya incluye IVA). NULL si el costo es 0. Columna generada: no se escribe.';

create index if not exists products_store_margin_pct_idx
  on public.products (store_id, margin_pct);

commit;

notify pgrst, 'reload schema';

-- ===== 20261009b-pricing-settings.sql =====
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

-- ===== 20261009c-price-review.sql =====
-- =============================================================================
-- 20261009c — cola "Por revisar" de precios (PRO-11; plan ux-mejoras, Ola 1;
--             reglas 9, 10 y 10b)
-- Proyecto: BodegaHub
-- Requiere: 20261006a (public.stock_movements_seq y stock_movements.seq),
--           20261006h (update_product_price vigente, assert_finite_numeric y
--           RLS por tienda de product_price_history), 20261006i (funcion
--           public.reject_non_finite_numeric), 20261009a (products.margin_pct)
--           y 20261009b (umbrales del semaforo en app_settings).
--
-- Regla 10b: al fijar un precio se guarda el costo y la banda de ganancia del
-- momento. Si despues el costo SUBE y la banda actual es PEOR que la guardada
-- (verde -> amarillo, amarillo -> rojo, verde -> rojo), el producto entra en
-- "Por revisar" hasta que se cambie el precio o se elija "Mantener precio",
-- que vuelve a guardar costo y banda. Nada aqui cambia un precio por su cuenta
-- ni bloquea una venta.
--
--   1. product_price_history gana tres columnas (las tres o ninguna):
--        * cost_ref_snapshot    numeric  costo vigente al guardar la fila.
--        * margin_band_snapshot text     'red' | 'yellow' | 'green' | 'none'
--                                        ('none' = producto sin costo).
--        * snapshot_seq         bigint   posicion de la fila en el libro de la
--                                        tienda: sale de la MISMA secuencia que
--                                        stock_movements.seq. Las fechas no
--                                        sirven para ordenar (now() es el inicio
--                                        de la transaccion): con la secuencia,
--                                        "la ultima instantanea del producto" y
--                                        "las compras recibidas despues de ella"
--                                        son comparaciones exactas. Solo consume
--                                        numeros de la secuencia: no escribe ni
--                                        lee stock.
--      Las filas anteriores al parche quedan con las tres en NULL: no se
--      inventa un costo historico.
--   2. margin_band_from_thresholds(pct, amarillo_desde, verde_desde): la regla
--      de bordes de @bodega/core (packages/core/src/pricing.ts, marginBand):
--      rojo < amarillo_desde; amarillo < verde_desde; verde >= verde_desde;
--      NULL (sin costo) -> 'none'. margin_band_rank: rojo 0 < amarillo 1 < verde 2.
--      product_margin_band(store_id, pct): la misma regla con los umbrales de
--      app_settings de la tienda (15 / 25 si la tienda no tiene fila).
--   3. update_product_price: copia literal de 20261006h. Misma firma, mismas
--      validaciones, permisos, bloqueos, errores y efecto sobre products. Lo
--      unico nuevo: la fila de historial que ya insertaba lleva la instantanea
--      (costo vigente y banda que resulta con el precio nuevo).
--   4. keep_product_price(p_product_id, p_reason): "Mantener precio". Mismo rol
--      que update_product_price (admin / almacen; PT403), bloquea el producto
--      (PT404 si no es de la tienda) e inserta una fila de historial con precio
--      anterior = nuevo = actual y la instantanea actual. No toca products ni
--      stock. Igual que update_product_price, no distingue producto inactivo.
--   5. Linea base, para que un producto que nunca paso por update_product_price
--      tambien pueda entrar en la cola:
--        a. Backfill: una fila 'Línea base de ganancia' (precio anterior = nuevo
--           = actual, costo y banda actuales) por cada producto SIN ninguna fila
--           con instantanea. Reaplicar el parche no inserta nada mas (un producto
--           con instantanea nunca recibe otra linea base: eso lo sacaria de la
--           cola sin que nadie lo decidiera).
--        b. Altas: trigger trg_products_price_baseline (after insert, security
--           definer, tienda del propio producto) que inserta esa misma fila. Un
--           insert por producto; no escribe products (no cruza con
--           products_stock_guard) y vale igual para el formulario, la
--           importacion masiva y las RPC que crean productos.
--   6. Vista products_price_review (security_invoker): una fila por producto
--      ACTIVO cuyo costo actual es mayor que el de su ultima instantanea y cuya
--      banda actual es peor que la de esa instantanea ('none' en cualquiera de
--      los dos lados no entra). Trae el % anterior (precio vigente sobre el
--      costo de la instantanea), el % actual y la compra recibida mas reciente
--      posterior a la instantanea que incluye el producto (NULL si el costo
--      cambio por otra via: edicion, importacion), con su proveedor.
--      price_review(products): relacion calculada de PostgREST (una fila como
--      mucho) para que el listado de productos filtre "solo en la cola" con
--      products?select=...,price_review!inner(...) sin pasar listas de ids.
--   7. Triggers de 20261006i regenerados para product_price_history (la columna
--      numeric nueva no entra sola). Mismo generador, acotado a esa tabla.
--
-- No toca stock, dinero, precios, politicas ni las RPC de compras
-- (create_purchase / receive_purchase siguen escribiendo current_cost_ref como
-- hasta ahora; la cola se entera sola porque compara contra products).
-- Idempotente, una sola transaccion. Ejecutar en SQL Editor o via db-up ANTES
-- de desplegar el BFF que lee la vista y llama a keep_product_price.
-- OJO: reaplicar 20261006g o 20261006h reinstala update_product_price sin la
-- instantanea: volver a aplicar este parche despues. Tras reaplicar 20261006i
-- no hace falta reaplicar este (su barrido ya incluye la columna nueva).
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Columnas de la instantanea.
-- -----------------------------------------------------------------------------

alter table public.product_price_history
  add column if not exists cost_ref_snapshot numeric,
  add column if not exists margin_band_snapshot text,
  add column if not exists snapshot_seq bigint;

comment on column public.product_price_history.cost_ref_snapshot is
  'Costo del producto (REF, ya con IVA) al guardar la fila. NULL en filas anteriores a 20261009c.';
comment on column public.product_price_history.margin_band_snapshot is
  'Banda de ganancia al guardar la fila: red | yellow | green | none (sin costo). NULL en filas anteriores a 20261009c.';
comment on column public.product_price_history.snapshot_seq is
  'Posicion de la instantanea en el libro (misma secuencia que stock_movements.seq). NULL si la fila no tiene instantanea.';

alter table public.product_price_history drop constraint if exists product_price_history_margin_band_snapshot_check;
alter table public.product_price_history
  add constraint product_price_history_margin_band_snapshot_check
  check (margin_band_snapshot is null or margin_band_snapshot in ('red', 'yellow', 'green', 'none'));

alter table public.product_price_history drop constraint if exists product_price_history_snapshot_complete_check;
alter table public.product_price_history
  add constraint product_price_history_snapshot_complete_check
  check (num_nulls(cost_ref_snapshot, margin_band_snapshot, snapshot_seq) in (0, 3));

create index if not exists idx_product_price_history_product_created
  on public.product_price_history (product_id, created_at desc);

create index if not exists idx_product_price_history_product_snapshot
  on public.product_price_history (product_id, snapshot_seq desc)
  where snapshot_seq is not null;

-- -----------------------------------------------------------------------------
-- 2. Bandas del semaforo. Misma regla de bordes que marginBand de @bodega/core.
-- -----------------------------------------------------------------------------

create or replace function public.margin_band_from_thresholds(
  p_margin_pct numeric,
  p_yellow_from_pct numeric,
  p_green_from_pct numeric
)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_margin_pct is null then 'none'
    when p_margin_pct < p_yellow_from_pct then 'red'
    when p_margin_pct < p_green_from_pct then 'yellow'
    else 'green'
  end;
$$;

comment on function public.margin_band_from_thresholds(numeric, numeric, numeric) is
  'Banda del semaforo de ganancia: red < amarillo_desde; yellow < verde_desde; green >= verde_desde; none sin % (sin costo).';

create or replace function public.margin_band_rank(p_band text)
returns integer
language sql
immutable
set search_path = public
as $$
  select case p_band
    when 'red' then 0
    when 'yellow' then 1
    when 'green' then 2
  end;
$$;

comment on function public.margin_band_rank(text) is
  'Orden de las bandas: red 0 < yellow 1 < green 2. NULL para none: no se compara.';

create or replace function public.product_margin_band(p_store_id uuid, p_margin_pct numeric)
returns text
language sql
stable
set search_path = public
as $$
  select public.margin_band_from_thresholds(
    p_margin_pct,
    coalesce((select a.margin_yellow_from_pct from public.app_settings a where a.store_id = p_store_id), 15),
    coalesce((select a.margin_green_from_pct from public.app_settings a where a.store_id = p_store_id), 25)
  );
$$;

comment on function public.product_margin_band(uuid, numeric) is
  'Banda de ganancia de un % con los umbrales de la tienda (app_settings; 15 / 25 si no hay fila).';

revoke all on function public.margin_band_from_thresholds(numeric, numeric, numeric) from public, anon;
grant execute on function public.margin_band_from_thresholds(numeric, numeric, numeric) to authenticated, service_role;
revoke all on function public.margin_band_rank(text) from public, anon;
grant execute on function public.margin_band_rank(text) to authenticated, service_role;
revoke all on function public.product_margin_band(uuid, numeric) from public, anon;
grant execute on function public.product_margin_band(uuid, numeric) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. update_product_price — copia de 20261006h + instantanea en el historial.
-- -----------------------------------------------------------------------------

create or replace function public.update_product_price(
  p_product_id uuid,
  p_new_sale_price_ref numeric,
  p_reason text default null
)
returns public.products
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_product public.products;
  v_old_price numeric(12,2);
begin
  v_store_id := public.assert_store_context();
  -- N4 — NaN / Infinity no son menores que 0 y atravesaban las guardas de abajo.
  perform public.assert_finite_numeric(p_new_sale_price_ref, 'el precio de venta');

  -- N6 — rol nulo = no autorizado, y PT403 en vez de P0001.
  if coalesce(public.current_user_role()::text, '') not in ('admin', 'almacen') then
    raise exception using errcode = 'PT403', message = 'No autorizado para cambiar precios';
  end if;

  if p_new_sale_price_ref < 0 then
    raise exception 'El precio no puede ser negativo';
  end if;

  select * into v_product
  from public.products
  where id = p_product_id
    and store_id = v_store_id
  for update;

  if not found then
    raise exception using errcode = 'PT404', message = 'Producto no encontrado';
  end if;

  v_old_price := v_product.sale_price_ref;

  update public.products
  set sale_price_ref = p_new_sale_price_ref
  where id = p_product_id
    and store_id = v_store_id
  returning * into v_product;

  if not found then
    raise exception using errcode = 'PT404', message = 'Producto no encontrado';
  end if;

  -- PRO-11 — la fila guarda el costo vigente y la banda que deja el precio nuevo
  -- (v_product ya trae el margin_pct recalculado por el update de arriba).
  insert into public.product_price_history (
    product_id,
    old_sale_price_ref,
    new_sale_price_ref,
    reason,
    changed_by,
    cost_ref_snapshot,
    margin_band_snapshot,
    snapshot_seq
  )
  values (
    p_product_id,
    v_old_price,
    p_new_sale_price_ref,
    p_reason,
    auth.uid(),
    v_product.current_cost_ref,
    public.product_margin_band(v_store_id, v_product.margin_pct),
    nextval('public.stock_movements_seq')
  );

  return v_product;
end;
$$;

revoke all on function public.update_product_price(uuid, numeric, text) from public, anon;
grant execute on function public.update_product_price(uuid, numeric, text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. keep_product_price — "Mantener precio": nueva instantanea, mismo precio.
-- -----------------------------------------------------------------------------

create or replace function public.keep_product_price(
  p_product_id uuid,
  p_reason text default null
)
returns public.product_price_history
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_product public.products;
  v_history public.product_price_history;
begin
  v_store_id := public.assert_store_context();

  if coalesce(public.current_user_role()::text, '') not in ('admin', 'almacen') then
    raise exception using errcode = 'PT403', message = 'No autorizado para mantener precios';
  end if;

  select * into v_product
  from public.products
  where id = p_product_id
    and store_id = v_store_id
  for update;

  if not found then
    raise exception using errcode = 'PT404', message = 'Producto no encontrado';
  end if;

  insert into public.product_price_history (
    product_id,
    old_sale_price_ref,
    new_sale_price_ref,
    reason,
    changed_by,
    cost_ref_snapshot,
    margin_band_snapshot,
    snapshot_seq
  )
  values (
    p_product_id,
    v_product.sale_price_ref,
    v_product.sale_price_ref,
    coalesce(nullif(btrim(p_reason), ''), 'Precio mantenido'),
    auth.uid(),
    v_product.current_cost_ref,
    public.product_margin_band(v_store_id, v_product.margin_pct),
    nextval('public.stock_movements_seq')
  )
  returning * into v_history;

  return v_history;
end;
$$;

comment on function public.keep_product_price(uuid, text) is
  'Mantener precio: fila de historial sin cambio de precio con el costo y la banda actuales. No toca products ni stock.';

revoke all on function public.keep_product_price(uuid, text) from public, anon;
grant execute on function public.keep_product_price(uuid, text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 5. Linea base: trigger para las altas y backfill para los productos que ya
--    existen. new.margin_pct ya viene calculado en un trigger AFTER.
-- -----------------------------------------------------------------------------

create or replace function public.products_price_baseline()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.product_price_history (
    product_id,
    old_sale_price_ref,
    new_sale_price_ref,
    reason,
    changed_by,
    cost_ref_snapshot,
    margin_band_snapshot,
    snapshot_seq
  )
  values (
    new.id,
    new.sale_price_ref,
    new.sale_price_ref,
    'Línea base de ganancia',
    auth.uid(),
    new.current_cost_ref,
    public.product_margin_band(new.store_id, new.margin_pct),
    nextval('public.stock_movements_seq')
  );

  return null;
end;
$$;

comment on function public.products_price_baseline() is
  'Linea base de ganancia de un producto nuevo: fila de historial con su costo y banda iniciales.';

revoke all on function public.products_price_baseline() from public, anon, authenticated;

drop trigger if exists trg_products_price_baseline on public.products;
create trigger trg_products_price_baseline
after insert on public.products
for each row
execute function public.products_price_baseline();

-- Un valor no finito en precio o costo (dato corrupto anterior a 20261006i) haria
-- fallar el insert y con el todo el parche: ese producto se queda sin linea base.
insert into public.product_price_history (
  product_id,
  old_sale_price_ref,
  new_sale_price_ref,
  reason,
  changed_by,
  cost_ref_snapshot,
  margin_band_snapshot,
  snapshot_seq
)
select
  p.id,
  p.sale_price_ref,
  p.sale_price_ref,
  'Línea base de ganancia',
  null,
  p.current_cost_ref,
  public.margin_band_from_thresholds(
    p.margin_pct,
    coalesce(a.margin_yellow_from_pct, 15),
    coalesce(a.margin_green_from_pct, 25)
  ),
  nextval('public.stock_movements_seq')
from public.products p
left join public.app_settings a on a.store_id = p.store_id
where (p.sale_price_ref - p.sale_price_ref) = 0
  and (p.current_cost_ref - p.current_cost_ref) = 0
  and not exists (
    select 1
    from public.product_price_history h
    where h.product_id = p.id
      and h.snapshot_seq is not null
  );

-- -----------------------------------------------------------------------------
-- 6. Vista de la cola y relacion calculada para PostgREST.
-- -----------------------------------------------------------------------------

create or replace view public.products_price_review
with (security_invoker = true) as
select
  p.id as product_id,
  p.store_id,
  p.name,
  p.sku,
  p.sale_price_ref,
  s.cost_ref_snapshot as previous_cost_ref,
  p.current_cost_ref,
  round((p.sale_price_ref - s.cost_ref_snapshot) / nullif(s.cost_ref_snapshot, 0) * 100, 6) as previous_margin_pct,
  p.margin_pct as current_margin_pct,
  s.margin_band_snapshot as previous_band,
  b.current_band,
  public.margin_band_rank(b.current_band) as current_band_rank,
  round((p.sale_price_ref - s.cost_ref_snapshot) / nullif(s.cost_ref_snapshot, 0) * 100, 6) - p.margin_pct as margin_drop_pct,
  s.created_at as snapshot_at,
  pu.id as purchase_id,
  pu.purchase_number,
  m.created_at as purchase_received_at,
  pu.supplier_id,
  c.name as supplier_name
from public.products p
join lateral (
  select h.cost_ref_snapshot, h.margin_band_snapshot, h.snapshot_seq, h.created_at
  from public.product_price_history h
  where h.product_id = p.id
    and h.snapshot_seq is not null
  order by h.snapshot_seq desc
  limit 1
) s on true
left join public.app_settings a on a.store_id = p.store_id
cross join lateral (
  select public.margin_band_from_thresholds(
    p.margin_pct,
    coalesce(a.margin_yellow_from_pct, 15),
    coalesce(a.margin_green_from_pct, 25)
  ) as current_band
) b
left join lateral (
  select sm.purchase_id, sm.created_at
  from public.stock_movements sm
  where sm.product_id = p.id
    and sm.type = 'compra'
    and sm.purchase_id is not null
    and sm.seq > s.snapshot_seq
  order by sm.seq desc
  limit 1
) m on true
left join public.purchases pu on pu.id = m.purchase_id
left join public.contacts c on c.id = pu.supplier_id
where p.is_active
  and s.cost_ref_snapshot > 0
  and p.current_cost_ref > s.cost_ref_snapshot
  and public.margin_band_rank(b.current_band) < public.margin_band_rank(s.margin_band_snapshot);

comment on view public.products_price_review is
  'Cola "Por revisar": productos activos cuyo costo subio y cuya banda de ganancia es peor que la de su ultima instantanea de precio.';

-- Supabase concede ALL por defecto a los roles de PostgREST sobre lo que se crea en public.
revoke all on public.products_price_review from public, anon, authenticated;
grant select on public.products_price_review to authenticated, service_role;

create or replace function public.price_review(public.products)
returns setof public.products_price_review
rows 1
language sql
stable
set search_path = public
as $$
  select r.*
  from public.products_price_review r
  where r.product_id = $1.id;
$$;

comment on function public.price_review(public.products) is
  'Relacion calculada de PostgREST: la fila de products_price_review del producto, si esta en la cola.';

revoke all on function public.price_review(public.products) from public, anon;
grant execute on function public.price_review(public.products) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 7. Triggers de 20261006i (NaN / Infinity -> PT400) regenerados para
--    product_price_history. Mismo generador, acotado a esa tabla.
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
    where c.oid = 'public.product_price_history'::regclass
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

commit;

notify pgrst, 'reload schema';

-- ===== 20261009d-assorted-pack.sql =====
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

-- ===== 20261009e-supplier-preferred.sql =====
-- =============================================================================
-- 20261009e — proveedor habitual del producto (PRO-14; plan ux-mejoras, Ola 1;
--             §0b N3 y reglas 7 y 9)
-- Proyecto: BodegaHub
-- Requiere: 20260716 (store_id en supplier_products y contacts), 20261006h
--           (register_supplier_product_price vigente, assert_finite_numeric y
--           RLS por tienda de supplier_products).
--
-- Un producto tiene como mucho UN proveedor habitual entre sus vinculos
-- proveedor-producto, y el habitual es siempre un vinculo ACTIVO de un proveedor
-- ACTIVO.
--
--   1. supplier_products.is_preferred boolean not null default false.
--      * check supplier_products_preferred_active_check: un vinculo inactivo
--        nunca es habitual (vale aunque alguien apague los triggers).
--      * indice unico parcial uq_supplier_products_preferred (product_id) where
--        is_preferred: uno por producto. SIN "and is_active": con ese filtro un
--        habitual inactivo podria convivir con otro activo; el check ya impide
--        que exista.
--   2. supplier_products_next_preferred(product_id): el relevo determinista. De
--      los vinculos activos de proveedores activos (proveedor / ambos), el de
--      compra mas reciente (last_purchased_at); sin compras, el mas antiguo por
--      created_at; desempate por id.
--   3. Trigger trg_supplier_products_preferred_guard (before insert / update /
--      delete por fila):
--        * vinculo inactivo -> is_preferred = false;
--        * un vinculo que ENTRA a los activos de un producto (alta, reactivacion
--          o cambio de producto) queda habitual si el producto no tiene ninguno
--          y su proveedor esta activo: "el primer vinculo es el habitual". Vale
--          para el formulario de contactos, create_purchase / receive_purchase
--          (insert ... on conflict ... is_active = true) y cualquier camino
--          futuro, sin tocarlos;
--        * marcar habitual a un proveedor inactivo o que ya no es proveedor ->
--          PT400;
--        * bloquea el producto (for no key update) cuando decide o suelta el
--          habitual, para que dos altas simultaneas no elijan dos.
--      Trigger trg_supplier_products_preferred_handoff (after update / delete
--      por fila, solo si la fila ERA habitual): si el habitual se desactiva, se
--      borra o se mueve de producto, el habitual pasa al relevo del punto 2 o el
--      producto queda sin habitual. Quitar la marca a un vinculo que sigue
--      activo NO dispara relevo (es una decision de quien escribe).
--      Trigger trg_contacts_release_preferred_supplier (after update de
--      is_active / type en contacts): al desactivar un proveedor o dejarlo solo
--      como cliente, sus vinculos habituales se sueltan y cada producto pasa al
--      relevo. Reactivar el proveedor no le devuelve el habitual.
--   4. Backfill: cada producto con vinculos activos y sin habitual recibe UNO
--      (el relevo del punto 2). Reaplicar el parche no cambia un habitual ya
--      elegido.
--   5. RPC save_product_suppliers(p_product_id, p_suppliers jsonb): estado
--      DESEADO completo de los vinculos activos del producto, en una
--      transaccion. p_suppliers = [{supplier_id, cost_ref?, supplier_sku?,
--      is_preferred?}] (maximo 50).
--        * crea los que faltan (reactiva el que existia inactivo), cambia
--          supplier_sku si la clave viene, DESACTIVA (no borra) los activos que
--          no vienen y fija el habitual;
--        * cost_ref: si viene y el vinculo es nuevo o el costo cambia, pasa por
--          register_supplier_product_price (origen 'vinculacion' en un vinculo
--          nuevo o reactivado, 'ajuste' en uno existente; modo 'unit'): mismo
--          historial y mismas reglas que el resto de caminos. Sin cost_ref el
--          costo no se toca;
--        * el mismo proveedor dos veces se FUNDE en una fila: gana la ultima
--          aparicion (costo y sku) y es habitual si alguna lo marca;
--        * habitual: el marcado; si ninguno, se conserva el actual si sigue en
--          la lista; si no, el primero de la lista con proveedor activo; lista
--          vacia = sin vinculos activos y sin habitual;
--        * PT400: lista invalida o de mas de 50, proveedor inexistente / de otra
--          tienda / que no es proveedor ni ambos, proveedor INACTIVO en un
--          vinculo nuevo o marcado habitual, mas de un habitual, costo negativo,
--          no finito o fuera de rango. PT403: rol distinto de admin / almacen.
--          PT404: producto que no es de la tienda.
--      Devuelve {product_id, suppliers[], preferred_supplier_id,
--      previous_preferred_supplier_id, preferred_changed,
--      preferred_auto_assigned}.
--
-- No toca stock, products (ni current_cost_ref), precios de venta, compras,
-- politicas ni las RPC existentes. No anade columnas numeric: los triggers de
-- 20261006i no necesitan regenerarse.
-- OJO: el backfill y los relevos pasan por trg_supplier_products_updated_at: el
-- vinculo que queda habitual estrena updated_at.
-- Idempotente, una sola transaccion. Ejecutar en SQL Editor o via db-up ANTES de
-- desplegar el BFF que llama a save_product_suppliers.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Columna, check e indice unico parcial
-- -----------------------------------------------------------------------------

alter table public.supplier_products
  add column if not exists is_preferred boolean not null default false;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.supplier_products'::regclass
      and conname = 'supplier_products_preferred_active_check'
  ) then
    alter table public.supplier_products
      add constraint supplier_products_preferred_active_check check (not is_preferred or is_active);
  end if;
end;
$$;

create unique index if not exists uq_supplier_products_preferred
  on public.supplier_products (product_id)
  where is_preferred;

-- -----------------------------------------------------------------------------
-- 2. Relevo determinista. Interna: no ejecutable por los roles de PostgREST.
-- -----------------------------------------------------------------------------

create or replace function public.supplier_products_next_preferred(p_product_id uuid)
returns uuid
language sql
security definer
set search_path = public
as $$
  select sp.id
  from public.supplier_products sp
  join public.contacts c on c.id = sp.supplier_id
  where sp.product_id = p_product_id
    and sp.is_active
    and c.is_active
    and c.type::text in ('proveedor', 'ambos')
  order by sp.last_purchased_at desc nulls last, sp.created_at, sp.id
  limit 1;
$$;

revoke all on function public.supplier_products_next_preferred(uuid) from public, anon, authenticated;
grant execute on function public.supplier_products_next_preferred(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 3a. Guard BEFORE: inactivo nunca habitual, primer vinculo = habitual, y
--     proveedor inactivo no puede pasar a habitual.
-- -----------------------------------------------------------------------------

create or replace function public.supplier_products_preferred_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enters boolean;
  v_becomes boolean;
  v_supplier_ok boolean;
begin
  if tg_op = 'DELETE' then
    if old.is_preferred then
      perform 1 from public.products where id = old.product_id for no key update;
    end if;
    return old;
  end if;

  -- v_enters: el vinculo entra a los activos del producto.
  -- v_becomes: el vinculo pasa a habitual en esta escritura.
  if tg_op = 'INSERT' then
    v_enters := true;
    v_becomes := new.is_preferred;
  else
    if old.is_preferred and (not new.is_active or new.product_id is distinct from old.product_id) then
      -- El habitual sale del producto: se serializa con las altas que lo buscan.
      perform 1 from public.products where id = old.product_id for no key update;
    end if;

    if new.product_id is distinct from old.product_id then
      -- El habitual no viaja con el vinculo a otro producto.
      new.is_preferred := false;
    end if;

    v_enters := not old.is_active or new.product_id is distinct from old.product_id;
    v_becomes := new.is_preferred
      and (not old.is_preferred or new.supplier_id is distinct from old.supplier_id);
  end if;

  if not new.is_active then
    new.is_preferred := false;
    return new;
  end if;

  if not v_enters and not v_becomes then
    return new;
  end if;

  select c.is_active and c.type::text in ('proveedor', 'ambos')
  into v_supplier_ok
  from public.contacts c
  where c.id = new.supplier_id;

  v_supplier_ok := coalesce(v_supplier_ok, false);

  if new.is_preferred then
    if not v_supplier_ok then
      raise exception using
        errcode = 'PT400',
        message = 'Un proveedor inactivo no puede ser el habitual del producto';
    end if;

    return new;
  end if;

  -- Entra sin marca: queda habitual si el producto no tiene ninguno.
  perform 1 from public.products where id = new.product_id for no key update;

  if v_supplier_ok and not exists (
    select 1
    from public.supplier_products sp
    where sp.product_id = new.product_id
      and sp.is_preferred
      and sp.id <> new.id
  ) then
    new.is_preferred := true;
  end if;

  return new;
end;
$$;

revoke all on function public.supplier_products_preferred_guard() from public, anon, authenticated;
grant execute on function public.supplier_products_preferred_guard() to service_role;

drop trigger if exists trg_supplier_products_preferred_guard on public.supplier_products;
create trigger trg_supplier_products_preferred_guard
before insert or update or delete on public.supplier_products
for each row execute function public.supplier_products_preferred_guard();

-- -----------------------------------------------------------------------------
-- 3b. Relevo AFTER: el habitual se desactivo, se borro o cambio de producto.
--     Se dispara al final de la sentencia: ve todas sus filas ya escritas.
-- -----------------------------------------------------------------------------

create or replace function public.supplier_products_preferred_handoff()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next uuid;
begin
  if tg_op = 'UPDATE' then
    if new.is_active and new.product_id = old.product_id then
      -- Sigue activo en el mismo producto: quien le quito la marca decide el resto.
      return null;
    end if;
  end if;

  if exists (
    select 1 from public.supplier_products sp
    where sp.product_id = old.product_id and sp.is_preferred
  ) then
    return null;
  end if;

  v_next := public.supplier_products_next_preferred(old.product_id);

  if v_next is not null then
    update public.supplier_products
    set is_preferred = true
    where id = v_next
      and not is_preferred;
  end if;

  return null;
end;
$$;

revoke all on function public.supplier_products_preferred_handoff() from public, anon, authenticated;
grant execute on function public.supplier_products_preferred_handoff() to service_role;

drop trigger if exists trg_supplier_products_preferred_handoff on public.supplier_products;
create trigger trg_supplier_products_preferred_handoff
after update or delete on public.supplier_products
for each row when (old.is_preferred)
execute function public.supplier_products_preferred_handoff();

-- -----------------------------------------------------------------------------
-- 3c. Proveedor desactivado (o que deja de ser proveedor): suelta sus
--     habituales y cada producto pasa al relevo. Productos en orden de id.
-- -----------------------------------------------------------------------------

create or replace function public.contacts_release_preferred_supplier()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link record;
  v_next uuid;
begin
  for v_link in
    select sp.id, sp.product_id
    from public.supplier_products sp
    where sp.supplier_id = new.id
      and sp.is_preferred
    order by sp.product_id
  loop
    perform 1 from public.products where id = v_link.product_id for no key update;

    update public.supplier_products
    set is_preferred = false
    where id = v_link.id;

    v_next := public.supplier_products_next_preferred(v_link.product_id);

    if v_next is not null then
      update public.supplier_products
      set is_preferred = true
      where id = v_next
        and not is_preferred;
    end if;
  end loop;

  return null;
end;
$$;

revoke all on function public.contacts_release_preferred_supplier() from public, anon, authenticated;
grant execute on function public.contacts_release_preferred_supplier() to service_role;

drop trigger if exists trg_contacts_release_preferred_supplier on public.contacts;
create trigger trg_contacts_release_preferred_supplier
after update of is_active, type on public.contacts
for each row
when (
  (old.is_active and not new.is_active)
  or (new.type is distinct from old.type and new.type::text not in ('proveedor', 'ambos'))
)
execute function public.contacts_release_preferred_supplier();

-- -----------------------------------------------------------------------------
-- 4. Backfill: un habitual por producto que tenga vinculos activos y ninguno
--    marcado. Mismo criterio que supplier_products_next_preferred. Un producto
--    que ya tiene habitual no entra: reaplicar no cambia nada.
-- -----------------------------------------------------------------------------

update public.supplier_products sp
set is_preferred = true
from (
  select distinct on (candidate.product_id) candidate.id
  from public.supplier_products candidate
  join public.contacts c on c.id = candidate.supplier_id
  where candidate.is_active
    and c.is_active
    and c.type::text in ('proveedor', 'ambos')
    and not exists (
      select 1
      from public.supplier_products chosen
      where chosen.product_id = candidate.product_id
        and chosen.is_preferred
    )
  order by candidate.product_id, candidate.last_purchased_at desc nulls last, candidate.created_at, candidate.id
) pick
where sp.id = pick.id;

-- -----------------------------------------------------------------------------
-- 5. save_product_suppliers
-- -----------------------------------------------------------------------------

create or replace function public.save_product_suppliers(
  p_product_id uuid,
  p_suppliers jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_item jsonb;
  v_supplier_id uuid;
  v_cost numeric;
  v_sku text;
  v_sets_sku boolean;
  v_mark boolean;
  v_idx integer;
  v_pass integer;
  v_total integer;
  v_marked integer;
  v_ids uuid[] := '{}';
  v_costs numeric[] := '{}';
  v_skus text[] := '{}';
  v_sku_sets boolean[] := '{}';
  v_marks boolean[] := '{}';
  v_names text[] := '{}';
  v_actives boolean[] := '{}';
  v_contact record;
  v_sp public.supplier_products;
  v_is_new boolean;
  v_is_target boolean;
  v_explicit boolean := false;
  v_previous uuid;
  v_target uuid;
  v_final uuid;
begin
  v_store_id := public.assert_store_context();

  if coalesce(public.current_user_role()::text, '') not in ('admin', 'almacen') then
    raise exception using errcode = 'PT403', message = 'No autorizado para gestionar los proveedores del producto';
  end if;

  if p_suppliers is null or jsonb_typeof(p_suppliers) <> 'array' then
    raise exception using errcode = 'PT400', message = 'La lista de proveedores no es válida';
  end if;

  if jsonb_array_length(p_suppliers) > 50 then
    raise exception using errcode = 'PT400', message = 'Un producto admite como máximo 50 proveedores';
  end if;

  -- 5.1 Lista deseada, en orden y con los proveedores repetidos fundidos.
  for v_item in
    select t.value
    from jsonb_array_elements(p_suppliers) with ordinality as t(value, ord)
    order by t.ord
  loop
    if jsonb_typeof(v_item) <> 'object'
       or coalesce(v_item ->> 'supplier_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception using errcode = 'PT400', message = 'Proveedor no encontrado';
    end if;

    v_supplier_id := (v_item ->> 'supplier_id')::uuid;

    v_cost := null;
    if jsonb_typeof(v_item -> 'cost_ref') = 'number' then
      v_cost := (v_item ->> 'cost_ref')::numeric;
    elsif v_item ? 'cost_ref' and jsonb_typeof(v_item -> 'cost_ref') <> 'null' then
      raise exception using errcode = 'PT400', message = 'El costo del proveedor debe ser un número';
    end if;

    perform public.assert_finite_numeric(v_cost, 'el costo del proveedor');

    if v_cost < 0 then
      raise exception using errcode = 'PT400', message = 'El costo del proveedor no puede ser negativo';
    end if;

    if v_cost > 9999999999.99 then
      raise exception using errcode = 'PT400', message = 'El costo del proveedor está fuera de rango';
    end if;

    v_cost := round(v_cost, 2);

    v_sets_sku := v_item ? 'supplier_sku';
    if v_sets_sku and jsonb_typeof(v_item -> 'supplier_sku') not in ('string', 'null') then
      raise exception using errcode = 'PT400', message = 'El código del proveedor no es válido';
    end if;
    v_sku := nullif(btrim(v_item ->> 'supplier_sku'), '');

    v_mark := false;
    if jsonb_typeof(v_item -> 'is_preferred') = 'boolean' then
      v_mark := (v_item ->> 'is_preferred')::boolean;
    elsif v_item ? 'is_preferred' and jsonb_typeof(v_item -> 'is_preferred') <> 'null' then
      raise exception using errcode = 'PT400', message = 'La marca de proveedor habitual no es válida';
    end if;

    v_idx := array_position(v_ids, v_supplier_id);

    if v_idx is null then
      v_ids := array_append(v_ids, v_supplier_id);
      v_costs := array_append(v_costs, v_cost);
      v_skus := array_append(v_skus, v_sku);
      v_sku_sets := array_append(v_sku_sets, v_sets_sku);
      v_marks := array_append(v_marks, v_mark);
    else
      -- Repetido: gana la ultima aparicion; habitual si alguna lo marca.
      v_costs[v_idx] := v_cost;
      v_skus[v_idx] := v_sku;
      v_sku_sets[v_idx] := v_sets_sku;
      v_marks[v_idx] := v_marks[v_idx] or v_mark;
    end if;
  end loop;

  v_total := coalesce(array_length(v_ids, 1), 0);

  select count(*) into v_marked from unnest(v_marks) as m(marked) where m.marked;

  if v_marked > 1 then
    raise exception using errcode = 'PT400', message = 'Solo un proveedor puede ser el habitual del producto';
  end if;

  -- 5.2 Proveedores de la tienda. for share ANTES de bloquear el producto: una
  --     desactivacion simultanea del proveedor espera aqui y su trigger encuentra
  --     ya escrito el habitual (mismo orden contacto -> producto que ese trigger).
  for v_idx in 1 .. v_total loop
    select c.name, c.is_active, c.type::text as type
    into v_contact
    from public.contacts c
    where c.id = v_ids[v_idx]
      and c.store_id = v_store_id
    for share;

    if not found or v_contact.type not in ('proveedor', 'ambos') then
      raise exception using errcode = 'PT400', message = 'Proveedor no encontrado';
    end if;

    v_names := array_append(v_names, v_contact.name);
    v_actives := array_append(v_actives, v_contact.is_active);
  end loop;

  -- 5.3 Producto de la tienda.
  perform 1
  from public.products
  where id = p_product_id
    and store_id = v_store_id
  for update;

  if not found then
    raise exception using errcode = 'PT404', message = 'Producto no encontrado';
  end if;

  select sp.supplier_id into v_previous
  from public.supplier_products sp
  where sp.product_id = p_product_id
    and sp.is_preferred;

  -- 5.4 Un proveedor inactivo no entra en un vinculo nuevo (ni reactivado).
  for v_idx in 1 .. v_total loop
    if not v_actives[v_idx] and not exists (
      select 1
      from public.supplier_products sp
      where sp.product_id = p_product_id
        and sp.supplier_id = v_ids[v_idx]
        and sp.is_active
    ) then
      raise exception using
        errcode = 'PT400',
        message = format('El proveedor %s está inactivo: no se puede vincular al producto', v_names[v_idx]);
    end if;
  end loop;

  -- 5.5 Habitual: el marcado; si no, el actual si sigue en la lista; si no, el
  --     primero de la lista con proveedor activo; si no hay, ninguno.
  v_idx := array_position(v_marks, true);

  if v_idx is not null then
    if not v_actives[v_idx] then
      raise exception using
        errcode = 'PT400',
        message = format('El proveedor %s está inactivo: no puede ser el habitual del producto', v_names[v_idx]);
    end if;

    v_target := v_ids[v_idx];
    v_explicit := true;
  else
    v_idx := array_position(v_ids, v_previous);

    if v_idx is not null and v_actives[v_idx] then
      v_target := v_previous;
    else
      for v_idx in 1 .. v_total loop
        if v_actives[v_idx] then
          v_target := v_ids[v_idx];
          exit;
        end if;
      end loop;
    end if;
  end if;

  -- 5.6 Se apaga el habitual anterior ANTES de encender el nuevo (indice unico)
  --     y se desactivan los vinculos activos que no vienen. Ninguno de los dos
  --     dispara relevo: tras el primero ya no queda fila habitual que soltar.
  update public.supplier_products
  set is_preferred = false
  where product_id = p_product_id
    and is_preferred
    and supplier_id is distinct from v_target;

  update public.supplier_products
  set is_active = false,
      updated_at = now()
  where product_id = p_product_id
    and is_active
    and not (supplier_id = any(v_ids));

  -- 5.7 Vinculos deseados: primero el habitual (asi ningun alta posterior ve el
  --     producto sin habitual), despues el resto en el orden de la lista.
  for v_pass in 1 .. 2 loop
    for v_idx in 1 .. v_total loop
      v_is_target := v_ids[v_idx] is not distinct from v_target;
      continue when v_is_target <> (v_pass = 1);

      select * into v_sp
      from public.supplier_products
      where product_id = p_product_id
        and supplier_id = v_ids[v_idx]
      for update;

      if not found then
        insert into public.supplier_products (
          store_id, supplier_id, product_id, supplier_sku, is_active, is_preferred
        )
        values (
          v_store_id, v_ids[v_idx], p_product_id, v_skus[v_idx], true, v_is_target
        )
        returning * into v_sp;

        v_is_new := true;
      elsif not v_sp.is_active then
        update public.supplier_products
        set is_active = true,
            is_preferred = v_is_target,
            supplier_sku = case when v_sku_sets[v_idx] then v_skus[v_idx] else supplier_sku end,
            updated_at = now()
        where id = v_sp.id
        returning * into v_sp;

        v_is_new := true;
      else
        v_is_new := false;

        if v_sp.is_preferred is distinct from v_is_target
           or (v_sku_sets[v_idx] and v_sp.supplier_sku is distinct from v_skus[v_idx]) then
          update public.supplier_products
          set is_preferred = v_is_target,
              supplier_sku = case when v_sku_sets[v_idx] then v_skus[v_idx] else supplier_sku end,
              updated_at = now()
          where id = v_sp.id
          returning * into v_sp;
        end if;
      end if;

      -- El costo pasa por register_supplier_product_price: mismo historial y
      -- mismas guardas que el resto de caminos. Sin cost_ref no se toca.
      if v_costs[v_idx] is not null
         and (v_is_new or v_costs[v_idx] is distinct from v_sp.last_cost_ref) then
        perform public.register_supplier_product_price(
          v_sp.id,
          v_costs[v_idx],
          null,
          case when v_is_new then 'vinculacion' else 'ajuste' end,
          null,
          null,
          'unit'
        );
      end if;
    end loop;
  end loop;

  select sp.supplier_id into v_final
  from public.supplier_products sp
  where sp.product_id = p_product_id
    and sp.is_preferred;

  return jsonb_build_object(
    'product_id', p_product_id,
    'preferred_supplier_id', v_final,
    'previous_preferred_supplier_id', v_previous,
    'preferred_changed', v_final is distinct from v_previous,
    'preferred_auto_assigned', (not v_explicit) and v_final is distinct from v_previous,
    'suppliers', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', sp.id,
            'supplier_id', sp.supplier_id,
            'supplier_name', c.name,
            'supplier_is_active', c.is_active,
            'cost_ref', sp.last_cost_ref,
            'supplier_sku', sp.supplier_sku,
            'is_preferred', sp.is_preferred,
            'last_purchased_at', sp.last_purchased_at,
            'updated_at', sp.updated_at
          )
          order by sp.is_preferred desc, c.name, sp.id
        )
        from public.supplier_products sp
        join public.contacts c on c.id = sp.supplier_id
        where sp.product_id = p_product_id
          and sp.is_active
      ),
      '[]'::jsonb
    )
  );
end;
$$;

comment on function public.save_product_suppliers(uuid, jsonb) is
  'Estado deseado de los proveedores de un producto: crea, actualiza, desactiva vinculos y fija el habitual. No toca products ni stock.';

revoke all on function public.save_product_suppliers(uuid, jsonb) from public, anon;
grant execute on function public.save_product_suppliers(uuid, jsonb) to authenticated, service_role;

commit;

notify pgrst, 'reload schema';

-- ===== 20261009f-price-and-product-idempotency.sql =====
-- =============================================================================
-- 20261009f — precio calculado y comprobado DENTRO de la base, y clave de
--             idempotencia del alta de producto (PRO-F9; hallazgos de caos
--             ALTA-1, ALTA-2 y M1 del modulo Productos; reglas 9, 10 y 10b)
-- Proyecto: BodegaHub
-- Requiere: 20261006c (stock_request_keys: idempotencia de adjust_stock),
--           20261006h (assert_finite_numeric) y 20261009c (update_product_price
--           con instantanea, keep_product_price y la cola "Por revisar").
--
-- ALTA-1: el reprecio masivo leia el costo en el BFF y despues llamaba a
-- update_product_price con un precio ya calculado. Si entre la lectura y la
-- llamada se recibia una compra, el precio quedaba calculado sobre un costo que
-- ya no existia (por debajo del costo nuevo), la respuesta era de exito y la
-- instantanea nueva sacaba al producto de la cola. M1: "Mantener precio"
-- confirmaba una ganancia que el usuario no habia visto. ALTA-2: reintentar un
-- alta de producto cuya respuesta se perdio creaba un segundo producto con su
-- inventario_inicial.
--
--   1. price_from_markup(costo, pct): precio = costo x (1 + pct / 100) a dos
--      decimales. MISMO redondeo que priceFromMarkup de @bodega/core
--      (packages/core/src/pricing.ts): costo al centimo, % a dos decimales,
--      producto exacto (numeric, sin coma flotante) y medio centimo hacia
--      arriba. Costo <= 0 -> 0. Diferencia conocida: un % con MAS de dos
--      decimales se redondea aqui en decimal exacto (1.005 -> 1.01) y en
--      @bodega/core con Math.round sobre coma flotante (1.005 * 100 =
--      100.4999... -> 1.00). El BFF envia el % ya redondeado con la regla de
--      @bodega/core, asi que por el BFF no hay diferencia.
--   2. assert_expected_cost_ref(costo_actual, costo_esperado): interna. Sin
--      costo esperado no hace nada; si viene y difiere del actual (a dos
--      decimales) -> PT409 'El costo cambió de X a Y; revisa el precio' con
--      hint COST_CHANGED.
--   3. reprice_product_to_markup(p_product_id, p_markup_pct, p_reason,
--      p_expected_cost_ref): bloquea el producto, lee SU costo bajo el bloqueo,
--      calcula el precio y delega en update_product_price (misma transaccion,
--      mismo historial e instantanea). Sin costo -> PT400 (hint NO_COST); % fuera
--      de (0, 1000] o no finito -> PT400; costo esperado distinto -> PT409 sin
--      cambiar nada.
--   4. update_product_price_checked(p_product_id, p_new_sale_price_ref,
--      p_reason, p_expected_cost_ref): precio fijo con la misma comprobacion de
--      costo esperado bajo el bloqueo; delega en update_product_price.
--   5. keep_product_price gana p_expected_cost_ref (al final, default null). Se
--      elimina la firma de dos argumentos para no dejar dos sobrecargas vivas
--      (PGRST203); las llamadas con dos argumentos siguen resolviendo.
--   6. products.client_request_id / client_request_hash + indice unico parcial
--      (store_id, client_request_id). Columnas opcionales: el formulario las
--      envia, la importacion masiva y las RPC que crean productos no. El BFF
--      reconoce el reintento por la violacion de ESE indice y devuelve el
--      producto ya creado; el stock inicial viaja a adjust_stock con una clave
--      derivada de la del producto (idempotencia de 20261006c).
--
-- update_product_price NO cambia (ni firma ni cuerpo): el camino sin costo
-- esperado da el mismo resultado que antes. No toca stock, dinero, politicas ni
-- las RPC de compras. No anade columnas numeric (los triggers de 20261006i no se
-- regeneran). Idempotente, una sola transaccion. Ejecutar en SQL Editor o via
-- db-up ANTES de desplegar el BFF que llama a las RPC nuevas.
-- OJO: reaplicar 20261009c reinstala keep_product_price(uuid, text) y deja dos
-- sobrecargas: volver a aplicar este parche despues.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Precio a partir de un % de ganancia. Mismo redondeo que @bodega/core.
-- -----------------------------------------------------------------------------

create or replace function public.price_from_markup(p_cost_ref numeric, p_markup_pct numeric)
returns numeric
language sql
immutable
set search_path = public
as $$
  select case
    when p_cost_ref is null or p_markup_pct is null or round(p_cost_ref, 2) <= 0 then 0
    -- Producto exacto en numeric; round() de numeric lleva el medio centimo hacia arriba.
    else greatest(round(round(p_cost_ref, 2) * (10000 + round(p_markup_pct, 2) * 100) * 0.0001, 2), 0)
  end;
$$;

comment on function public.price_from_markup(numeric, numeric) is
  'Precio = costo x (1 + pct / 100) a dos decimales, con el redondeo de priceFromMarkup de @bodega/core (costo al centimo, % a dos decimales, medio centimo hacia arriba).';

revoke all on function public.price_from_markup(numeric, numeric) from public, anon;
grant execute on function public.price_from_markup(numeric, numeric) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. Costo esperado: lo que el usuario vio al decidir. Interna (no es RPC).
-- -----------------------------------------------------------------------------

create or replace function public.assert_expected_cost_ref(p_current_cost_ref numeric, p_expected_cost_ref numeric)
returns void
language plpgsql
immutable
set search_path = public
as $$
begin
  if p_expected_cost_ref is null then
    return;
  end if;

  perform public.assert_finite_numeric(p_expected_cost_ref, 'el costo esperado');

  if round(coalesce(p_current_cost_ref, 0), 2) <> round(p_expected_cost_ref, 2) then
    raise exception using
      errcode = 'PT409',
      message = format(
        'El costo cambió de %s a %s; revisa el precio',
        round(p_expected_cost_ref, 2),
        round(coalesce(p_current_cost_ref, 0), 2)
      ),
      hint = 'COST_CHANGED';
  end if;
end;
$$;

revoke all on function public.assert_expected_cost_ref(numeric, numeric) from public, anon, authenticated;
grant execute on function public.assert_expected_cost_ref(numeric, numeric) to service_role;

-- -----------------------------------------------------------------------------
-- 3. reprice_product_to_markup — el precio se calcula con el producto bloqueado.
-- -----------------------------------------------------------------------------

create or replace function public.reprice_product_to_markup(
  p_product_id uuid,
  p_markup_pct numeric,
  p_reason text default null,
  p_expected_cost_ref numeric default null
)
returns public.products
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_product public.products;
begin
  v_store_id := public.assert_store_context();
  perform public.assert_finite_numeric(p_markup_pct, 'el % de ganancia');

  if coalesce(public.current_user_role()::text, '') not in ('admin', 'almacen') then
    raise exception using errcode = 'PT403', message = 'No autorizado para cambiar precios';
  end if;

  if p_markup_pct is null or p_markup_pct <= 0 or p_markup_pct > 1000 then
    raise exception using
      errcode = 'PT400',
      message = 'El % de ganancia debe ser mayor que 0 y como máximo 1000';
  end if;

  -- El bloqueo dura hasta el final de la transaccion: update_product_price, mas
  -- abajo, ve el mismo costo que se uso para calcular.
  select * into v_product
  from public.products
  where id = p_product_id
    and store_id = v_store_id
  for update;

  if not found then
    raise exception using errcode = 'PT404', message = 'Producto no encontrado';
  end if;

  if coalesce(v_product.current_cost_ref, 0) <= 0 then
    raise exception using
      errcode = 'PT400',
      message = 'Sin costo no se puede calcular el precio',
      hint = 'NO_COST';
  end if;

  perform public.assert_expected_cost_ref(v_product.current_cost_ref, p_expected_cost_ref);

  return public.update_product_price(
    p_product_id,
    public.price_from_markup(v_product.current_cost_ref, p_markup_pct),
    p_reason
  );
end;
$$;

comment on function public.reprice_product_to_markup(uuid, numeric, text, numeric) is
  'Reprecio a un % de ganancia: lee el costo con el producto bloqueado, calcula el precio y delega en update_product_price. Con costo esperado distinto del actual responde PT409 sin cambiar nada.';

revoke all on function public.reprice_product_to_markup(uuid, numeric, text, numeric) from public, anon;
grant execute on function public.reprice_product_to_markup(uuid, numeric, text, numeric) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. update_product_price_checked — precio fijo sobre el costo que se vio.
-- -----------------------------------------------------------------------------

create or replace function public.update_product_price_checked(
  p_product_id uuid,
  p_new_sale_price_ref numeric,
  p_reason text default null,
  p_expected_cost_ref numeric default null
)
returns public.products
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_product public.products;
begin
  v_store_id := public.assert_store_context();

  if coalesce(public.current_user_role()::text, '') not in ('admin', 'almacen') then
    raise exception using errcode = 'PT403', message = 'No autorizado para cambiar precios';
  end if;

  select * into v_product
  from public.products
  where id = p_product_id
    and store_id = v_store_id
  for update;

  if not found then
    raise exception using errcode = 'PT404', message = 'Producto no encontrado';
  end if;

  perform public.assert_expected_cost_ref(v_product.current_cost_ref, p_expected_cost_ref);

  return public.update_product_price(p_product_id, p_new_sale_price_ref, p_reason);
end;
$$;

comment on function public.update_product_price_checked(uuid, numeric, text, numeric) is
  'Cambio de precio con costo esperado: bloquea el producto, responde PT409 si el costo ya no es el que vio el usuario y, si coincide, delega en update_product_price.';

revoke all on function public.update_product_price_checked(uuid, numeric, text, numeric) from public, anon;
grant execute on function public.update_product_price_checked(uuid, numeric, text, numeric) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 5. keep_product_price — copia de 20261009c + costo esperado. Firma nueva
--    (3 argumentos): se elimina la de 2 (PGRST203).
-- -----------------------------------------------------------------------------

drop function if exists public.keep_product_price(uuid, text);

create or replace function public.keep_product_price(
  p_product_id uuid,
  p_reason text default null,
  p_expected_cost_ref numeric default null
)
returns public.product_price_history
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_product public.products;
  v_history public.product_price_history;
begin
  v_store_id := public.assert_store_context();

  if coalesce(public.current_user_role()::text, '') not in ('admin', 'almacen') then
    raise exception using errcode = 'PT403', message = 'No autorizado para mantener precios';
  end if;

  select * into v_product
  from public.products
  where id = p_product_id
    and store_id = v_store_id
  for update;

  if not found then
    raise exception using errcode = 'PT404', message = 'Producto no encontrado';
  end if;

  -- M1 — la instantanea que se guarda es la que el usuario acepto, o ninguna.
  perform public.assert_expected_cost_ref(v_product.current_cost_ref, p_expected_cost_ref);

  insert into public.product_price_history (
    product_id,
    old_sale_price_ref,
    new_sale_price_ref,
    reason,
    changed_by,
    cost_ref_snapshot,
    margin_band_snapshot,
    snapshot_seq
  )
  values (
    p_product_id,
    v_product.sale_price_ref,
    v_product.sale_price_ref,
    coalesce(nullif(btrim(p_reason), ''), 'Precio mantenido'),
    auth.uid(),
    v_product.current_cost_ref,
    public.product_margin_band(v_store_id, v_product.margin_pct),
    nextval('public.stock_movements_seq')
  )
  returning * into v_history;

  return v_history;
end;
$$;

comment on function public.keep_product_price(uuid, text, numeric) is
  'Mantener precio: fila de historial sin cambio de precio con el costo y la banda actuales. Con costo esperado distinto del actual responde PT409 sin insertar. No toca products ni stock.';

revoke all on function public.keep_product_price(uuid, text, numeric) from public, anon;
grant execute on function public.keep_product_price(uuid, text, numeric) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 6. Clave de idempotencia del alta de producto.
-- -----------------------------------------------------------------------------

alter table public.products
  add column if not exists client_request_id uuid,
  add column if not exists client_request_hash text;

comment on column public.products.client_request_id is
  'Clave de idempotencia enviada por el cliente al crear el producto (unica por tienda). NULL en importaciones, RPC y productos anteriores a 20261009f.';
comment on column public.products.client_request_hash is
  'Huella del contenido enviado con client_request_id. La misma clave con otra huella se rechaza.';

create unique index if not exists products_store_client_request_unique
  on public.products (store_id, client_request_id)
  where client_request_id is not null;

commit;

notify pgrst, 'reload schema';

-- ===== 20261010a-purchase-auto-link.sql =====
-- =============================================================================
-- 20261010a — vinculo automatico proveedor-producto al comprar (COM-02; plan
--             ux-mejoras, Ola 1; §0b y reglas 7 y 9)
-- Proyecto: BodegaHub
-- Requiere: 20261006c / f / h (create_purchase de 14 argumentos, idempotencia,
--           bloqueos ordenados, guardas), 20261007a (tax_rate_code), 20261009d
--           (create_purchase VIGENTE: receta de empaque por componentes) y
--           20261009e (supplier_products.is_preferred y sus triggers).
--
-- REDEFINE public.create_purchase (misma firma de 14 argumentos). PARTE DE LA
-- VERSION DE 20261009d: copia literal de su cuerpo (IVA por tax_rate_code de
-- 20261007a, lectura de la receta en modo empaque de 20261009d, idempotencia por
-- p_client_request_id, documento -> productos "order by id for update", guardas
-- de formato y de NaN) mas lo que sigue. No define ninguna otra funcion ni toca
-- tablas, indices, politicas o triggers.
--
--   1. Vinculo por linea. Hasta hoy el vinculo proveedor-producto solo se creaba
--      (o se reactivaba) al RECIBIR: en create_purchase con estado 'recibido' y
--      en receive_purchase. Un 'pedido' de un producto que el proveedor no tenia
--      quedaba sin vinculo hasta la recepcion. Desde aqui toda compra confirmada
--      deja vinculada cada una de sus lineas, en la misma transaccion:
--        * recibido: sin cambios. insert ... on conflict: crea el vinculo que
--          falte, reactiva el inactivo, registra el costo de la linea (con IVA)
--          y la fecha de ultima compra; historial con origen 'compra'.
--        * pedido, sin vinculo: se crea con el costo de la linea (con IVA) y el
--          supplier_sku enviado; historial con origen 'vinculacion' y nota
--          'Pedido <numero>'; last_purchased_at queda NULL (no se ha recibido).
--        * pedido, vinculo inactivo: se reactiva sin tocar costo ni historial.
--        * pedido, vinculo activo: no se toca.
--      Nunca se duplica: unique (supplier_id, product_id) y el producto esta
--      bloqueado mientras se decide.
--   2. Empaque del proveedor. Si la linea se guarda en modo empaque y su vinculo
--      se creo en esta compra, se inserta su supplier_product_pack_units (label y
--      units_per_pack de la linea); el primero del vinculo queda predeterminado.
--      No se repite si dos lineas traen el mismo empaque. No aplica a la linea
--      sobre un producto EMPAQUE de una receta (se guarda en modo unidad) ni a
--      vinculos que ya existian o que se reactivan: conservan sus empaques.
--   3. Proveedor habitual (20261009e). No se escribe is_preferred: lo decide el
--      trigger trg_supplier_products_preferred_guard. El vinculo nuevo o
--      reactivado queda habitual solo si el producto no tenia ninguno; si ya
--      tenia, se respeta.
--   4. Proveedor inactivo, que no es proveedor / ambos, inexistente o de otra
--      tienda: PT400 en espanol ANTES de crear nada (ni compra, ni lineas, ni
--      movimientos, ni vinculo). El inactivo y el que no es proveedor ya se
--      rechazaban, pero por assert_contact_type, sin errcode (P0001). El contacto
--      se lee con FOR SHARE: desactivarlo espera a que la compra termine.
--
-- NO cambia la semantica monetaria ni de stock: para el mismo payload, mismas
-- lineas, quantity_delta, costo del producto y totales que con 20261009d. No
-- escribe el stock de products: lo mueve el trigger del libro.
--
-- OJO: si se reaplica 20261006c, 20261006f, 20261006h, 20261007a o 20261009d
-- (todos redefinen create_purchase) HAY QUE REAPLICAR 20261010a y correr
-- verify-patches.sql. Reaplicar 20261009e no lo exige (no toca create_purchase).
-- receive_purchase no se redefine: sigue en la version de 20261006c.
-- OJO: la version VIGENTE de create_purchase es la de 20261010b (COM-15: rechaza
-- el producto inactivo), que parte de esta. Tras reaplicar 20261010a HAY QUE
-- REAPLICAR 20261010b.
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

-- ===== 20261010b-purchase-inactive-product.sql =====
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
-- OJO: 20261010d-receive-disassemble.sql (COM-14) redefine create_purchase a
-- partir de este cuerpo: tras reaplicar 20261010b HAY QUE REAPLICAR 20261010d.
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

-- ===== 20261010d-receive-disassemble.sql =====
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

-- ===== 20261010e-pack-recipe-always-disassemble.sql =====
-- =============================================================================
-- 20261010e — preferencia "Desarmar siempre al recibir compras" en la receta de
--             apertura de un empaque (COM-14; plan ux-mejoras, Ola 1)
-- Proyecto: BodegaHub
-- Requiere: 20261009d (public.product_pack_conversions como CABECERA de la
--           receta, con su RLS por tienda y rol).
--
-- ANADE una sola columna a la cabecera de la receta:
--
--   public.product_pack_conversions.always_disassemble_on_receive
--     boolean not null default false
--
-- Es una PREFERENCIA de pantalla: con ella en true, la linea de ese empaque
-- nace con el chip "Desarmar al recibir" marcado en /purchases/create (el
-- usuario lo puede desmarcar). La marca que decide el desarme sigue viajando
-- por linea (purchase_items.disassemble_on_receive, parche 20261010d).
--
--   1. No toca funciones, triggers, indices ni politicas. create_purchase,
--      receive_purchase, receive_purchase_and_disassemble y
--      convert_pack_to_units NO leen esta columna: no cambia stock, costo,
--      dinero ni ninguna huella de idempotencia.
--   2. Se LEE por tabla directa (PostgREST) con la RLS de la cabecera: la lee
--      toda la tienda; otra tienda y anon no ven filas. Se ESCRIBE solo por la
--      RPC save_pack_recipe (argumento p_always_disassemble_on_receive, parche
--      20261012a): 20261011d revoca insert / update / delete de authenticated
--      sobre la cabecera, tambien para admin y almacen. Cuando se escribio este
--      parche (rama de Compras) el BFF la escribia por tabla directa; esa via
--      ya no existe.
--   3. Un update que solo nombra esta columna no dispara la reescritura de
--      componentes del trigger de compatibilidad de 20261009d (ese solo
--      reacciona a unit_product_id / units_per_pack).
--   4. No migra datos: toda receta existente queda en false (como hasta hoy).
--   5. La preferencia es de la cabecera: cuando una receta reemplaza a otra
--      (cabecera nueva, la anterior inactiva) save_pack_recipe hace que la
--      nueva herede el valor de la anterior (20261012a).
--
-- ORDEN DE DESPLIEGUE: este parche -> 20261011c -> 20261012a -> verify -> BFF.
-- Orden completo del plan: docs/despliegue-ux-mejoras.md.
-- Idempotente, una transaccion. NO se aplica a produccion desde este plan.
-- Reaplicar 20261009d no elimina la columna (solo anade las suyas): no hace
-- falta reaplicar este parche despues.
-- =============================================================================

begin;

alter table public.product_pack_conversions
  add column if not exists always_disassemble_on_receive boolean not null default false;

comment on column public.product_pack_conversions.always_disassemble_on_receive is
  'Preferencia de pantalla (COM-14): la linea de compra de este empaque nace marcada "Desarmar al recibir". Ninguna RPC la lee.';

notify pgrst, 'reload schema';

commit;

-- ===== 20261010f-receive-disassemble-invariant.sql =====
-- =============================================================================
-- 20261010f — guarda en base del invariante de "Desarmar al recibir": una
--             compra no queda recibida con una linea marcada sin desarmar
--             (COM-F7 M1, sobre COM-14; plan ux-mejoras, Ola 1; regla 9)
-- Proyecto: BodegaHub
-- Requiere: 20261010d (purchase_items.disassemble_on_receive y
--           disassembled_conversion_id, receive_purchase_and_disassemble).
--
-- Problema. 20261010d declara: "una linea marcada de una compra recibida
-- SIEMPRE tiene su disassembled_conversion_id". receive_purchase_and_disassemble
-- y create_purchase lo cumplen, pero la RPC anterior receive_purchase (20261006c,
-- con execute para authenticated) no sabe nada de la marca: llamada
-- directamente sobre un pedido con una linea marcada dejaba la compra recibida,
-- la marca en true y disassembled_conversion_id en NULL. No existe pantalla ni
-- RPC para completar despues ese desarme.
--
-- Arreglo. Un constraint trigger DIFERIDO sobre public.purchases:
--
--   purchases_received_disassemble_guard
--     after insert or update of status, when (new.status = 'recibido'),
--     deferrable initially deferred, for each row
--
-- Al FINAL de la transaccion que deja una compra en recibido comprueba el
-- invariante: si la compra sigue recibida y le queda alguna linea con
-- disassemble_on_receive = true y disassembled_conversion_id NULL, responde
-- PT409 y la transaccion entera se revierte (ni compra recibida, ni stock, ni
-- costo, ni vinculo).
--
--   1. NO redefine receive_purchase, receive_purchase_and_disassemble,
--      create_purchase ni convert_pack_to_units. No toca tablas, columnas,
--      indices ni politicas. No migra datos.
--   2. Por que diferido: receive_purchase_and_disassemble y create_purchase
--      pasan la compra a recibido y abren los empaques DESPUES, en la misma
--      transaccion. Al final de esa transaccion cada linea marcada ya tiene su
--      conversion: pasan sin cambios. Solo falla el camino que recibe sin
--      desarmar: receive_purchase llamada directamente sobre un pedido marcado.
--   3. receive_purchase sobre un pedido SIN lineas marcadas: igual que hoy.
--   4. receive_purchase_and_disassemble con lista (p_disassemble): la lista
--      sustituye las marcas ANTES de recibir (las lineas que no van quedan en
--      false; [] = ninguna), asi que recibir sin desarmar por la RPC nueva
--      sigue permitido y deja la linea desmarcada.
--   5. Semantica de stock, costo y dinero SIN cambios (regla 9): el trigger
--      solo lee purchases y purchase_items; no escribe nada.
--   6. cancel_purchase / return_purchase no pasan la compra a recibido: el
--      trigger no se dispara.
--   7. El rechazo llega al confirmar la transaccion. Por PostgREST es un 409
--      con el mensaje del PT409; dentro de una transaccion abierta a mano se
--      puede adelantar con
--        set constraints public.purchases_received_disassemble_guard immediate;
--   8. Filas existentes: un constraint trigger no valida lo ya guardado. Una
--      compra que ya hubiera quedado recibida con una linea marcada sin
--      desarmar (solo posible por RPC directa entre 20261010d y este parche)
--      se localiza con:
--        select p.id, p.purchase_number
--        from public.purchases p
--        join public.purchase_items i on i.purchase_id = p.id
--        where p.status = 'recibido'
--          and i.disassemble_on_receive
--          and i.disassembled_conversion_id is null;
--
-- Idempotente, una sola transaccion. NO se aplica a produccion desde este plan.
-- Reaplicar 20261010d no elimina el trigger ni su funcion: no hace falta
-- reaplicar este parche despues.
-- =============================================================================

begin;

create or replace function public.purchases_received_disassemble_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Estado al final de la transaccion, no el de la fila que disparo el trigger.
  if exists (
    select 1
    from public.purchases p
    join public.purchase_items i on i.purchase_id = p.id
    where p.id = new.id
      and p.status = 'recibido'
      and i.disassemble_on_receive
      and i.disassembled_conversion_id is null
  ) then
    raise exception using
      errcode = 'PT409',
      message = 'Esta compra tiene líneas marcadas para desarmar: recíbela desde la pantalla de la compra para abrir sus empaques o desmarcarlas. No se recibió nada.';
  end if;

  return null;
end;
$$;

comment on function public.purchases_received_disassemble_guard() is
  'Invariante de COM-14: una compra recibida no conserva lineas marcadas "Desarmar al recibir" sin disassembled_conversion_id. Solo lee.';

revoke all on function public.purchases_received_disassemble_guard() from public, anon, authenticated;

drop trigger if exists purchases_received_disassemble_guard on public.purchases;

create constraint trigger purchases_received_disassemble_guard
  after insert or update of status on public.purchases
  deferrable initially deferred
  for each row
  when (new.status = 'recibido')
  execute function public.purchases_received_disassemble_guard();

commit;

notify pgrst, 'reload schema';

-- ===== 20261011a-inventory-overview.sql =====
-- =============================================================================
-- 20261011a — vista unica de stock (INV-01a; plan ux-mejoras §4.6)
-- Proyecto: BodegaHub
-- Requiere: 20260716 (store_id en products y stock_movements), 20261006a
--           (stock_movements.seq) y 20261006h (RLS por tienda).
--
-- public.inventory_overview: una fila por producto de public.products (activos
-- e inactivos; el BFF filtra is_active) con lo que lee GET /api/inventory:
--
--   * las columnas del listado: id, store_id, category_id, sku, barcode, name,
--     sale_price_ref, current_cost_ref, current_stock, min_stock, image_url,
--     is_active;
--   * entries_30d        suma de los quantity_delta positivos del producto con
--                        created_at >= now() - 30 dias (ventana movil de 30 x
--                        24 h, no dias de calendario); 0 sin movimientos;
--   * exits_30d          suma de |quantity_delta| de los negativos en la misma
--                        ventana; 0 sin movimientos;
--   * last_movement_at / last_movement_type
--                        created_at y type del movimiento de mayor seq del
--                        producto (el orden real del libro, 20261006a); null si
--                        el producto no tiene movimientos;
--   * stock_status       'out' si current_stock = 0; 'low' si current_stock <=
--                        min_stock; 'ok' en otro caso. Es la regla de
--                        getInventoryStockStatus (inventoryStockStatus.ts), en
--                        ese orden, para filtrar y paginar en el servidor.
--
-- Las cifras del libro son subconsultas escalares y no joins: el conteo y los
-- filtros (todos sobre columnas de products) no tocan stock_movements, y con
-- order by + limit solo se calculan para las filas de la pagina.
--
-- security_invoker: aplican las RLS de products y stock_movements del que
-- consulta (otra tienda no ve filas). Select solo para authenticated y
-- service_role, como las vistas de integridad (20261006d).
--
-- Indice idx_stock_movements_product_seq (product_id, seq desc): "ultimo
-- movimiento del producto" en una lectura de indice. La ventana de 30 dias usa
-- idx_stock_movements_product_created_at (product_id, created_at desc), que ya
-- existe (schema base).
--
-- Solo lectura: no toca stock, dinero, politicas ni RPC. Idempotente, una
-- transaccion.
-- =============================================================================

begin;

create index if not exists idx_stock_movements_product_seq
  on public.stock_movements (product_id, seq desc);

create or replace view public.inventory_overview
with (security_invoker = true) as
select
  p.id,
  p.store_id,
  p.category_id,
  p.sku,
  p.barcode,
  p.name,
  p.sale_price_ref,
  p.current_cost_ref,
  p.current_stock,
  p.min_stock,
  p.image_url,
  p.is_active,
  coalesce((
    select sum(m.quantity_delta)
    from public.stock_movements m
    where m.product_id = p.id
      and m.quantity_delta > 0
      and m.created_at >= now() - interval '30 days'
  ), 0)::integer as entries_30d,
  coalesce((
    select sum(-m.quantity_delta)
    from public.stock_movements m
    where m.product_id = p.id
      and m.quantity_delta < 0
      and m.created_at >= now() - interval '30 days'
  ), 0)::integer as exits_30d,
  (
    select m.created_at
    from public.stock_movements m
    where m.product_id = p.id
    order by m.seq desc
    limit 1
  ) as last_movement_at,
  (
    select m.type
    from public.stock_movements m
    where m.product_id = p.id
    order by m.seq desc
    limit 1
  ) as last_movement_type,
  case
    when p.current_stock = 0 then 'out'
    when p.current_stock <= p.min_stock then 'low'
    else 'ok'
  end as stock_status
from public.products p
;

comment on view public.inventory_overview is
  'Vista unica de stock (INV-01): producto + entradas / salidas de 30 dias, ultimo movimiento (mayor seq) y stock_status.';

revoke all on public.inventory_overview from public, anon, authenticated, service_role;
grant select on public.inventory_overview to authenticated, service_role;

commit;

notify pgrst, 'reload schema';

-- ===== 20261011b-adjust-stock-inactive.sql =====
-- =============================================================================
-- 20261011b — adjust_stock no acepta entradas libres a un producto inactivo
--             (COM-15a; plan ux-mejoras §0b: "producto inactivo acepta compras y
--             ajustes", parte de AJUSTES)
-- Proyecto: BodegaHub
-- Requiere: 20261006a, b, c, e, f y g (adjust_stock vigente: 20261006g).
--
-- Redefine completa adjust_stock, copia literal de 20261006g con UN cambio. La
-- firma de 7 argumentos no cambia y sigue habiendo una sola.
--
-- Regla nueva (decision del supervisor de Inventario, 2026-10-08). Sobre un
-- producto INACTIVO (products.is_active = false):
--
--   * delta > 0 sin venta ligada (ajuste_entrada, inventario_inicial y el tipo
--     por defecto de un delta positivo)  ->  PT409 "El producto esta inactivo:
--     reactivalo antes de registrar una entrada de stock". Sin efectos: ni
--     movimiento, ni stock, ni clave de idempotencia consumida (la excepcion
--     deshace la transaccion; reintentar con la misma clave tras reactivar el
--     producto registra el ajuste).
--   * delta < 0 (ajuste_salida: merma, salida, correccion a la baja)  ->  SE
--     PERMITE. Es lo conservador: un producto dado de baja que aun tiene stock
--     debe poder dejarse en cero.
--   * Devoluciones LIGADAS a su documento  ->  NO cambian. devolucion_cliente
--     con p_sale_id es una entrada (delta > 0) y sigue entrando aunque el
--     producto ya este inactivo: la mercancia vuelve por la venta, con su tope
--     "vendido - ya devuelto". devolucion_proveedor con p_purchase_id es una
--     salida. Por eso la guarda lleva "p_sale_id is null" (a esa altura
--     p_sale_id solo puede acompanar a devolucion_cliente, y devolucion_cliente
--     no existe sin p_sale_id: R4).
--
-- Donde va la guarda: justo despues de bloquear el producto y comprobar que
-- existe en la tienda (hace falta la fila bloqueada para leer is_active). Todo
-- lo anterior conserva su precedencia: PT403 de rol, reintento con clave (un
-- ajuste registrado cuando el producto estaba activo se sigue devolviendo tal
-- cual aunque despues se desactive), PT400 de forma, PT404 / PT409 del
-- documento y PT404 del producto.
--
-- Todo lo demas queda IDENTICO (regla 9 del plan: no cambia la semantica de
-- stock): orden de bloqueo documento -> producto, movimiento con stock_after
-- NULL (lo fija stock_movements_apply), idempotencia y huella del contenido,
-- permisos y mensajes. Sobre un producto activo la funcion se comporta igual
-- que la de 20261006g (test diferencial en
-- scripts/stock-lab/regression/adjust-inactive.test.ts).
--
-- NO toca create_purchase ni receive_purchase: que un producto inactivo acepte
-- compras sigue abierto y es del modulo Compras.
--
-- Idempotente, una sola transaccion. Ejecutar en SQL Editor o via db-up.
-- Reaplicar 20261006c o 20261006g reinstala la version anterior de
-- adjust_stock (sin esta guarda): volver a aplicar este parche despues.
-- NO aplicado a produccion.
-- =============================================================================

begin;

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

  -- R4 — y la devolucion no existe sin su documento: sin el no hay tope (vendido /
  -- recibido menos ya devuelto) y return_sale / return_purchase no la descuentan,
  -- asi que las unidades se duplicaban con la reconciliacion en 0. La devolucion
  -- suelta deja de existir como ajuste libre.
  if v_type = 'devolucion_cliente' and p_sale_id is null then
    raise exception using
      errcode = 'PT400',
      message = 'Una devolucion de cliente debe indicar la venta a la que corresponde';
  end if;

  if v_type = 'devolucion_proveedor' and p_purchase_id is null then
    raise exception using
      errcode = 'PT400',
      message = 'Una devolucion a proveedor debe indicar la compra a la que corresponde';
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

  -- COM-15a — un producto inactivo no recibe entradas libres: hay que reactivarlo
  -- antes. Las salidas (delta < 0) si pasan, para poder dejarlo en cero, y la
  -- devolucion de cliente ligada a su venta tambien (entra por el documento).
  if not v_product.is_active and p_quantity_delta > 0 and p_sale_id is null then
    raise exception using
      errcode = 'PT409',
      message = 'El producto esta inactivo: reactivalo antes de registrar una entrada de stock';
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

commit;

notify pgrst, 'reload schema';

-- ===== 20261011c-save-pack-recipe.sql =====
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

-- ===== 20261012a-save-pack-recipe-always-disassemble.sql =====
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

-- ===== 20261012b-price-review-disassemble.sql =====
-- =============================================================================
-- 20261012b — la cola "Por revisar" atribuye a la compra el costo de los
--             componentes de un empaque desarmado en su recepcion (INT-04;
--             plan ux-mejoras, integracion de la Ola 1: Productos x Compras)
-- Proyecto: BodegaHub
-- Requiere: 20261009c (vista products_price_review y price_review(products)) y
--           20261010d (purchase_items.disassembled_conversion_id).
--
-- Fallo: al recibir una compra con "Desarmar al recibir" (20261010d), el costo
-- de cada componente lo fija convert_pack_to_units y el movimiento que deja es
-- una `conversion_entrada` SIN purchase_id. La vista de 20261009c solo miraba
-- movimientos `compra`: los componentes que bajaban de banda entraban en la cola
-- con purchase_id / proveedor nulos y el aviso de reprecio del detalle de ESA
-- compra (que filtra la vista por purchase_id) no los listaba.
--
-- Arreglo (solo lectura): la "compra causante" de un producto pasa a ser la del
-- movimiento mas reciente posterior a su ultima instantanea de precio que sea
--   * una `compra` con purchase_id (como hasta ahora), o
--   * una `conversion_entrada` cuya apertura (stock_movements.conversion_id) es
--     la que una linea de compra guardo al desarmarse en la recepcion
--     (purchase_items.disassembled_conversion_id): la compra de esa linea.
-- Una apertura hecha a mano (sin linea de compra que la apunte) sigue sin
-- atribuirse a ninguna compra. Si despues del desarme llega una compra directa
-- del componente, manda esa (la mas reciente), igual que entre dos compras.
--
-- Mismas columnas, mismos tipos y mismo orden que 20261009c: price_review(products)
-- y el BFF no cambian. security_invoker: la linea de compra y la compra se leen
-- con el RLS de quien consulta, como ya pasaba con purchases.
--
-- Indice parcial en purchase_items(disassembled_conversion_id) para el enlace.
-- El `create index` no es `concurrently`: bloquea las escrituras de
-- purchase_items mientras se construye (tabla pequena; aplicar fuera de hora pico).
--
-- No toca stock, costos, precios, dinero, filas, politicas, grants ni ninguna
-- RPC: no cambia QUE productos estan en la cola, solo a que compra se atribuyen.
-- Idempotente, una sola transaccion. No depende del BFF (el desplegado lee las
-- mismas columnas): puede ir antes o despues.
-- OJO: reaplicar 20261009c reinstala la vista sin este enlace: volver a aplicar
-- este parche despues y correr verify-patches.sql.
-- =============================================================================

begin;

create index if not exists idx_purchase_items_disassembled_conversion
  on public.purchase_items (disassembled_conversion_id)
  where disassembled_conversion_id is not null;

create or replace view public.products_price_review
with (security_invoker = true) as
select
  p.id as product_id,
  p.store_id,
  p.name,
  p.sku,
  p.sale_price_ref,
  s.cost_ref_snapshot as previous_cost_ref,
  p.current_cost_ref,
  round((p.sale_price_ref - s.cost_ref_snapshot) / nullif(s.cost_ref_snapshot, 0) * 100, 6) as previous_margin_pct,
  p.margin_pct as current_margin_pct,
  s.margin_band_snapshot as previous_band,
  b.current_band,
  public.margin_band_rank(b.current_band) as current_band_rank,
  round((p.sale_price_ref - s.cost_ref_snapshot) / nullif(s.cost_ref_snapshot, 0) * 100, 6) - p.margin_pct as margin_drop_pct,
  s.created_at as snapshot_at,
  pu.id as purchase_id,
  pu.purchase_number,
  m.created_at as purchase_received_at,
  pu.supplier_id,
  c.name as supplier_name
from public.products p
join lateral (
  select h.cost_ref_snapshot, h.margin_band_snapshot, h.snapshot_seq, h.created_at
  from public.product_price_history h
  where h.product_id = p.id
    and h.snapshot_seq is not null
  order by h.snapshot_seq desc
  limit 1
) s on true
left join public.app_settings a on a.store_id = p.store_id
cross join lateral (
  select public.margin_band_from_thresholds(
    p.margin_pct,
    coalesce(a.margin_yellow_from_pct, 15),
    coalesce(a.margin_green_from_pct, 25)
  ) as current_band
) b
left join lateral (
  -- INT-04: la compra del movimiento, o la de la linea que se desarmo al recibir
  -- y cuya apertura dejo esta `conversion_entrada` en el componente.
  select coalesce(sm.purchase_id, d.purchase_id) as purchase_id, sm.created_at
  from public.stock_movements sm
  left join lateral (
    select pi.purchase_id
    from public.purchase_items pi
    where sm.type = 'conversion_entrada'
      and sm.conversion_id is not null
      and pi.disassembled_conversion_id = sm.conversion_id
    limit 1
  ) d on true
  where sm.product_id = p.id
    and sm.seq > s.snapshot_seq
    and (
      (sm.type = 'compra' and sm.purchase_id is not null)
      or (sm.type = 'conversion_entrada' and d.purchase_id is not null)
    )
  order by sm.seq desc
  limit 1
) m on true
left join public.purchases pu on pu.id = m.purchase_id
left join public.contacts c on c.id = pu.supplier_id
where p.is_active
  and s.cost_ref_snapshot > 0
  and p.current_cost_ref > s.cost_ref_snapshot
  and public.margin_band_rank(b.current_band) < public.margin_band_rank(s.margin_band_snapshot);

comment on view public.products_price_review is
  'Cola "Por revisar": productos activos cuyo costo subio y cuya banda de ganancia es peor que la de su ultima instantanea de precio. La compra es la del movimiento mas reciente que fijo el costo: una compra recibida o el desarme de un empaque en su recepcion.';

-- `create or replace view` conserva los privilegios; se repiten para que el parche
-- sea autosuficiente (Supabase concede ALL por defecto a los roles de PostgREST).
revoke all on public.products_price_review from public, anon, authenticated;
grant select on public.products_price_review to authenticated, service_role;

commit;

notify pgrst, 'reload schema';

-- ===== 20261013a-report-money-views.sql =====
-- =============================================================================
-- 20261013a — vistas de los reportes de dinero (REP-06a; plan ux-mejoras §4.9)
-- Proyecto: BodegaHub
-- Requiere: 20260716b (vistas con store_id), 20260811b / 20260819 (cash_sessions
--           con teorico, contado y closed_reason), 20261006a (security_invoker
--           en las vistas de reportes) y 20261006h (RLS por tienda).
--
-- SOLO LECTURA: crea / redefine vistas. No toca tablas, filas, RPC, politicas,
-- stock ni dinero. No escribe en cash_* ni en el baul.
--
-- 0. daily_sales_summary y gross_profit_summary agrupaban por dia UTC
--    (date_trunc('day', created_at)::date): una venta de 20:00-23:59 Caracas
--    caia en el dia siguiente. Pasan a dia operativo de Caracas
--    ((created_at at time zone 'America/Caracas')::date). Mismas columnas, tipos
--    y filtro de estado: los totales de un rango amplio no cambian, solo el dia
--    al que se asigna cada venta.
--
--    CAMBIO DE COMPORTAMIENTO (leer antes de comparar cifras por dia):
--    a) Desde este parche sale_date es el dia operativo America/Caracas. Antes
--       era el dia UTC: una fila diaria de antes y otra de despues NO son
--       comparables entre si (cambia el reparto por dia, no el total del rango).
--    b) ORDEN DE PARCHES: 20260716b-multi-store-views.sql hace drop + create de
--       estas dos vistas con date_trunc('day', created_at)::date. REAPLICAR
--       20260716b las DEVUELVE a dia UTC: despues hay que volver a aplicar este
--       parche (20261013a). verify-patches.sql lo detecta (fila "agrupan por dia
--       operativo de Caracas").
--    c) "Cierre del dia" (dailyCloseSummary.server.ts) y "Depreciacion FX"
--       (fxDepreciationReport.server.ts) NO leen estas vistas: leen sales,
--       sale_items, payments y exchange_rates con el rango ya convertido a dia
--       Caracas. Sus cifras son identicas antes y despues del parche (medido en
--       la base lab: .notes/ux-mejoras/reportes/lab/no-rompe/, diff vacio).
--
--    CRITERIO UNICO DE ESTADOS de los reportes de ventas (vistas existentes y
--    las de este parche). VIGENTE DESDE 20261018a (DEC-01, decision de
--    negocio): cuentan SOLO 'pendiente_pago' y 'pagada'; NO cuentan
--    'borrador', 'cancelada' ni 'devuelta'. Las definiciones de este archivo
--    conservan el filtro con el que nacieron (se excluian solo 'cancelada' y
--    'devuelta', asi que un 'borrador' contaba): 20261018a las redefine con el
--    criterio vigente y hay que aplicarlo SIEMPRE despues de este parche (y
--    volver a aplicarlo si este se reaplica). En el BFF el criterio vive en
--    src/shared/sales/countedSaleStatuses.ts. Los reportes de
--    inventario (20261013b) no filtran por estado de venta: leen el libro
--    stock_movements, y una venta cancelada o devuelta aparece alli con su
--    salida y su reversion; para "que es una venta que cuenta" remiten a esta
--    definicion. Compras ("Compras por periodo", tabla purchases, sin vista):
--    por defecto se excluyen 'cancelado' y 'devuelto' en la tabla Y en la serie
--    (parametro status=all o un estado concreto para verlas).
--
-- 1. report_sales_by_hour: ventas no canceladas ni devueltas (criterio de
--    daily_sales_summary) por tienda, dia Caracas, dia de la semana ISO
--    (1 = lunes ... 7 = domingo) y hora Caracas (0-23).
--
-- 2. report_sales_by_category: lineas de venta por tienda, dia Caracas y
--    categoria ACTUAL del producto ("Sin categoría" si no tiene). Ingreso, costo
--    y ganancia salen de las mismas columnas que gross_profit_summary
--    (subtotal_ref, unit_cost_ref_snapshot * quantity, gross_profit_ref): no se
--    recalcula ningun costo. products y categories entran con left join para que
--    la suma de todas las categorias sea exactamente la de gross_profit_summary.
--
-- 3. report_open_documents_aging: documentos abiertos con su antiguedad. Es el
--    criterio de GET /api/payments/open-documents (openDocuments.server.ts):
--      * venta abierta  = status 'pendiente_pago' y round(total_ves - paid_ves, 2) > 0;
--        pendiente REF  = round(pendiente Bs / ref_rate_ves, 2) (tasa del documento);
--      * compra abierta = status 'pedido' o 'recibido' y round(total_ves - paid_ves, 2) > 0;
--        pendiente REF  = greatest(round(total_ref - paid_ref, 2), 0).
--    Las ventas no guardan lo cobrado en REF: paid_ref = total_ref - pendiente
--    REF. days = dias de calendario Caracas entre el documento y hoy (no existe
--    fecha de vencimiento en sales / purchases). bucket: '0-7', '8-30', '30+'.
--    report_open_documents_aging_summary: numero de documentos y pendiente por
--    tramo. contact_id null = todo el conjunto de la tienda; con valor = solo
--    ese contacto (customer_id / supplier_id son not null, no hay ambiguedad).
--
-- 4. report_cash_close_differences: una fila por sesion de caja cerrada y
--    moneda de efectivo ('ves' / 'ref') con lo esperado (theoretical_closing_*,
--    el teorico que guardo close_cash_session / el autocierre), lo contado
--    (closing_*) y la diferencia contado - esperado. No recalcula el teorico.
--    running_* es el acumulado de la tienda y moneda en orden de cierre
--    (closed_at, id), para paginar y totalizar un rango sin leerlo entero.
--    Las sesiones sin teorico o sin contado guardado no aparecen.
--
-- Todas: security_invoker (RLS de las tablas base del que consulta), sin acceso
-- para public / anon y select para authenticated y service_role. Nada por
-- vendedor / usuario. Idempotente, una transaccion.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 0. Resumenes diarios en dia operativo de Caracas
-- -----------------------------------------------------------------------------

create or replace view public.daily_sales_summary
with (security_invoker = true) as
select
  store_id,
  (created_at at time zone 'America/Caracas')::date as sale_date,
  count(*) as sales_count,
  sum(total_ref) as total_ref,
  sum(total_ves) as total_ves,
  sum(paid_ves) as paid_ves
from public.sales
where status not in ('cancelada', 'devuelta')
group by store_id, (created_at at time zone 'America/Caracas')::date;

create or replace view public.gross_profit_summary
with (security_invoker = true) as
select
  s.store_id,
  (s.created_at at time zone 'America/Caracas')::date as sale_date,
  sum(si.subtotal_ref) as revenue_ref,
  sum(si.unit_cost_ref_snapshot * si.quantity) as cost_ref,
  sum(si.gross_profit_ref) as gross_profit_ref
from public.sales s
join public.sale_items si on si.sale_id = s.id
where s.status not in ('cancelada', 'devuelta')
group by s.store_id, (s.created_at at time zone 'America/Caracas')::date;

-- -----------------------------------------------------------------------------
-- 1. Ventas por hora y dia de la semana
-- -----------------------------------------------------------------------------

create or replace view public.report_sales_by_hour
with (security_invoker = true) as
select
  s.store_id,
  (s.created_at at time zone 'America/Caracas')::date as sale_date,
  extract(isodow from (s.created_at at time zone 'America/Caracas'))::integer as dow,
  extract(hour from (s.created_at at time zone 'America/Caracas'))::integer as hour,
  count(*) as sales_count,
  sum(s.total_ref) as total_ref,
  sum(s.total_ves) as total_ves
from public.sales s
where s.status not in ('cancelada', 'devuelta')
group by
  s.store_id,
  (s.created_at at time zone 'America/Caracas')::date,
  extract(isodow from (s.created_at at time zone 'America/Caracas'))::integer,
  extract(hour from (s.created_at at time zone 'America/Caracas'))::integer;

comment on view public.report_sales_by_hour is
  'Ventas no canceladas ni devueltas por tienda, dia Caracas, dia de la semana ISO (1 = lunes) y hora Caracas (REP-06).';

-- -----------------------------------------------------------------------------
-- 2. Ventas y margen por categoria
-- -----------------------------------------------------------------------------

create or replace view public.report_sales_by_category
with (security_invoker = true) as
select
  s.store_id,
  (s.created_at at time zone 'America/Caracas')::date as sale_date,
  p.category_id,
  coalesce(c.name, 'Sin categoría') as category_name,
  sum(si.quantity) as units,
  sum(si.subtotal_ref) as revenue_ref,
  sum(si.unit_cost_ref_snapshot * si.quantity) as cost_ref,
  sum(si.gross_profit_ref) as gross_profit_ref
from public.sales s
join public.sale_items si on si.sale_id = s.id
left join public.products p on p.id = si.product_id
left join public.categories c on c.id = p.category_id
where s.status not in ('cancelada', 'devuelta')
group by
  s.store_id,
  (s.created_at at time zone 'America/Caracas')::date,
  p.category_id,
  coalesce(c.name, 'Sin categoría');

comment on view public.report_sales_by_category is
  'Unidades, ingreso, costo (snapshot de la linea) y ganancia por tienda, dia Caracas y categoria actual del producto; su suma es la de gross_profit_summary (REP-06).';

-- -----------------------------------------------------------------------------
-- 3. Cuentas por cobrar / por pagar con antiguedad
-- -----------------------------------------------------------------------------

create or replace view public.report_open_documents_aging
with (security_invoker = true) as
select
  d.store_id,
  d.doc_type,
  d.document_id,
  d.document_number,
  d.contact_id,
  c.name as contact_name,
  d.created_at,
  (d.created_at at time zone 'America/Caracas')::date as document_date,
  a.days,
  case when a.days <= 7 then '0-7' when a.days <= 30 then '8-30' else '30+' end as bucket,
  d.ref_rate_ves,
  d.total_ref,
  d.total_ves,
  d.paid_ref,
  d.paid_ves,
  d.pending_ref,
  d.pending_ves
from (
  select
    s.store_id,
    'sale'::text as doc_type,
    s.id as document_id,
    s.invoice_number as document_number,
    s.customer_id as contact_id,
    s.created_at,
    s.ref_rate_ves,
    s.total_ref,
    s.total_ves,
    greatest(round(s.total_ref - round(round(s.total_ves - s.paid_ves, 2) / s.ref_rate_ves, 2), 2), 0) as paid_ref,
    s.paid_ves,
    round(round(s.total_ves - s.paid_ves, 2) / s.ref_rate_ves, 2) as pending_ref,
    round(s.total_ves - s.paid_ves, 2) as pending_ves
  from public.sales s
  where s.status = 'pendiente_pago'
    and round(s.total_ves - s.paid_ves, 2) > 0
  union all
  select
    p.store_id,
    'purchase'::text as doc_type,
    p.id as document_id,
    p.purchase_number as document_number,
    p.supplier_id as contact_id,
    p.created_at,
    p.ref_rate_ves,
    p.total_ref,
    p.total_ves,
    p.paid_ref,
    p.paid_ves,
    greatest(round(p.total_ref - p.paid_ref, 2), 0) as pending_ref,
    round(p.total_ves - p.paid_ves, 2) as pending_ves
  from public.purchases p
  where p.status in ('pedido', 'recibido')
    and round(p.total_ves - p.paid_ves, 2) > 0
) d
left join public.contacts c on c.id = d.contact_id
cross join lateral (
  select greatest(
    (now() at time zone 'America/Caracas')::date - (d.created_at at time zone 'America/Caracas')::date,
    0
  ) as days
) a;

comment on view public.report_open_documents_aging is
  'Ventas por cobrar y compras por pagar (criterio de /api/payments/open-documents) con dias Caracas desde el documento y tramo 0-7 / 8-30 / 30+ (REP-06).';

create or replace view public.report_open_documents_aging_summary
with (security_invoker = true) as
select
  d.store_id,
  d.doc_type,
  d.contact_id,
  d.bucket,
  count(*) as documents_count,
  sum(d.pending_ref) as pending_ref,
  sum(d.pending_ves) as pending_ves
from public.report_open_documents_aging d
group by grouping sets (
  (d.store_id, d.doc_type, d.bucket),
  (d.store_id, d.doc_type, d.bucket, d.contact_id)
);

comment on view public.report_open_documents_aging_summary is
  'Documentos abiertos y pendiente por tramo: contact_id null = toda la tienda; con valor = ese contacto (REP-06).';

-- -----------------------------------------------------------------------------
-- 4. Diferencias de cierre de caja (contado - teorico guardado al cerrar)
-- -----------------------------------------------------------------------------

create or replace view public.report_cash_close_differences
with (security_invoker = true) as
select
  cs.store_id,
  cs.id as cash_session_id,
  cs.register_id,
  cr.name as register_name,
  cs.closed_at,
  (cs.closed_at at time zone 'America/Caracas')::date as close_date,
  cs.closed_reason,
  v.currency,
  v.expected,
  v.counted,
  v.counted - v.expected as difference,
  sum(v.expected) over w as running_expected,
  sum(v.counted) over w as running_counted,
  sum(v.counted - v.expected) over w as running_difference
from public.cash_sessions cs
left join public.cash_registers cr on cr.id = cs.register_id
cross join lateral (
  values
    ('ves'::text, cs.theoretical_closing_ves, cs.closing_ves),
    ('ref'::text, cs.theoretical_closing_ref, cs.closing_ref)
) as v(currency, expected, counted)
where cs.status = 'closed'
  and v.expected is not null
  and v.counted is not null
window w as (
  partition by cs.store_id, v.currency
  order by cs.closed_at, cs.id
  rows between unbounded preceding and current row
);

comment on view public.report_cash_close_differences is
  'Sesion de caja cerrada x moneda de efectivo: teorico guardado, contado, diferencia y acumulado por tienda y moneda en orden de cierre (REP-06). Solo lectura.';

-- -----------------------------------------------------------------------------
-- 5. Permisos: sin public / anon; lectura para authenticated y service_role
-- -----------------------------------------------------------------------------

do $$
declare
  v_view text;
begin
  foreach v_view in array array[
    'daily_sales_summary',
    'gross_profit_summary',
    'report_sales_by_hour',
    'report_sales_by_category',
    'report_open_documents_aging',
    'report_open_documents_aging_summary',
    'report_cash_close_differences'
  ]
  loop
    execute format('alter view public.%I set (security_invoker = true)', v_view);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', v_view);
    execute format('grant select on public.%I to authenticated, service_role', v_view);
  end loop;
end;
$$;

commit;

notify pgrst, 'reload schema';

-- ===== 20261013b-report-inventory-views.sql =====
-- =============================================================================
-- 20261013b — vistas de los reportes de inventario (REP-07a; plan ux-mejoras §4.9)
-- Proyecto: BodegaHub
-- Requiere: 20260716 (store_id en products y stock_movements), 20261006a
--           (stock_movements.seq), 20261006h (RLS por tienda) y 20261011a
--           (indice idx_stock_movements_product_seq).
--
-- SOLO LECTURA: crea vistas. No toca tablas, filas, RPC, politicas, stock ni
-- dinero. Nada escribe products.current_stock ni stock_movements.
--
-- Fuente: el LIBRO public.stock_movements en su orden real (seq). Ninguna vista
-- lee stock_movements.stock_after: los saldos historicos se reconstruyen
-- sumando quantity_delta.
--
-- Clasificacion de movimientos (la de Inventario y las vistas de integridad
-- 20261006d, no se inventa otra):
--   * salida por venta ............ type = 'venta'
--   * reversion de una venta ...... type = 'devolucion_cliente', o
--                                   type = 'ajuste_entrada' con sale_id (lo que
--                                   insertan cancel_sale / return_sale)
--   * ajuste manual ............... type in ('ajuste_entrada', 'ajuste_salida')
--                                   sin sale_id ni purchase_id. La merma no es
--                                   un tipo: es un ajuste_salida con su motivo.
--   * NO son ajustes: 'ajuste_salida' con purchase_id (cancel_purchase),
--     'ajuste_entrada' con sale_id (reversion de venta), 'inventario_inicial',
--     'compra', 'devolucion_proveedor' y 'conversion_salida' /
--     'conversion_entrada' (apertura de empaque: tipo propio de Inventario).
--
-- 1. report_product_last_movement: una fila por producto (activos e inactivos;
--    el BFF filtra) con su saldo vigente (products.current_stock, el mismo que
--    da inventory_overview y que stock_reconciliation compara con el libro), el
--    costo unitario current_cost_ref (ya incluye IVA: no se reaplica), el valor
--    a costo y las fechas del libro:
--      last_sale_at       created_at del movimiento 'venta' de mayor seq;
--      last_movement_at   created_at del movimiento de mayor seq (cualquier tipo);
--      first_movement_at  created_at del movimiento de menor seq;
--      idle_since         dia Caracas desde el que el producto esta sin vender:
--                         el de su ultima venta; si nunca se vendio, el de su
--                         primer movimiento; sin movimientos, el de su alta.
--    El "hoy" y el filtro de N dias los pone el BFF (idle_since <= hoy - N):
--    la vista no fija la fecha.
--
-- 2. report_stock_daily_flow: tienda x dia Caracas x producto con
--      net_delta    suma de quantity_delta de TODOS los movimientos del dia
--                   (para reconstruir el saldo a una fecha desde el vigente);
--      sold_units   unidades vendidas netas: -suma de quantity_delta de las
--                   salidas por venta y sus reversiones;
--      cogs_ref     costo de lo vendido neto: unidades x costo de la linea de
--                   venta (sale_items.unit_cost_ref_snapshot, promedio ponderado
--                   de las lineas de ese producto en esa venta); si el movimiento
--                   no tiene linea de venta, current_cost_ref actual.
--
-- 3. report_stock_adjustments: una fila por ajuste manual con su motivo
--    normalizado (espacios colapsados; 'Sin motivo' si viene vacio) y su valor a
--    costo. El libro no guarda el costo del movimiento: value_ref usa
--    current_cost_ref ACTUAL y cost_basis lo dice ('current_cost').
--
-- Estado de la venta: el criterio de los reportes es el de daily_sales_summary
-- (definicion vigente en 20261018a-reports-exclude-draft-sales.sql, DEC-01:
-- cuentan 'pendiente_pago' y 'pagada'; no cuentan 'borrador', 'cancelada' ni
-- 'devuelta'). Estas vistas NO filtran por sales.status: leen el libro, donde una
-- venta anulada o devuelta queda en neto 0 porque su reversion compensa la
-- salida (mismo resultado que excluirla, con cada movimiento en su dia), una
-- devolucion parcial resta solo lo devuelto y un borrador no tiene movimientos.
-- Si algun dia una vista de este parche necesita el estado, usa ese criterio.
--
-- Ninguna vista expone created_by: nada por usuario / vendedor.
--
-- Quien ve filas: security_invoker, asi que mandan las RLS de las tablas base
-- (products, stock_movements, categories, sale_items: store_id =
-- current_user_store_id()). Las vistas no amplian quien lee el libro: ven filas
-- los mismos roles de la tienda que ya leen stock_movements, y nadie de otra
-- tienda. Sin acceso para public / anon; select para authenticated y
-- service_role. Idempotente, una transaccion.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Saldo, valor a costo y ultimas fechas del libro por producto
-- -----------------------------------------------------------------------------

create or replace view public.report_product_last_movement
with (security_invoker = true) as
select
  p.store_id,
  p.id as product_id,
  p.sku,
  p.name,
  p.is_active,
  p.category_id,
  coalesce(c.name, 'Sin categoría') as category_name,
  p.current_stock as stock,
  p.current_cost_ref as cost_ref,
  round(p.current_stock * p.current_cost_ref, 2) as stock_value_ref,
  ls.created_at as last_sale_at,
  lm.created_at as last_movement_at,
  fm.created_at as first_movement_at,
  (coalesce(ls.created_at, fm.created_at, p.created_at) at time zone 'America/Caracas')::date as idle_since
from public.products p
left join public.categories c on c.id = p.category_id
left join lateral (
  select m.created_at
  from public.stock_movements m
  where m.product_id = p.id
    and m.type = 'venta'
  order by m.seq desc
  limit 1
) ls on true
left join lateral (
  select m.created_at
  from public.stock_movements m
  where m.product_id = p.id
  order by m.seq desc
  limit 1
) lm on true
left join lateral (
  select m.created_at
  from public.stock_movements m
  where m.product_id = p.id
  order by m.seq asc
  limit 1
) fm on true;

comment on view public.report_product_last_movement is
  'Producto con saldo vigente, valor a costo, ultima venta / ultimo / primer movimiento del libro (por seq) e idle_since (dia Caracas desde el que no se vende) (REP-07). Solo lectura.';

-- -----------------------------------------------------------------------------
-- 2. Flujo diario del libro por producto: neto, vendido neto y costo de lo vendido
-- -----------------------------------------------------------------------------

create or replace view public.report_stock_daily_flow
with (security_invoker = true) as
select
  m.store_id,
  (m.created_at at time zone 'America/Caracas')::date as movement_date,
  m.product_id,
  sum(m.quantity_delta)::integer as net_delta,
  coalesce(sum(-m.quantity_delta) filter (where k.is_sale), 0)::integer as sold_units,
  coalesce(
    sum(round(-m.quantity_delta * coalesce(sc.unit_cost_ref, p.current_cost_ref), 2)) filter (where k.is_sale),
    0
  ) as cogs_ref
from public.stock_movements m
join public.products p on p.id = m.product_id
cross join lateral (
  select (
    m.type in ('venta', 'devolucion_cliente')
    or (m.type = 'ajuste_entrada' and m.sale_id is not null)
  ) as is_sale
) k
left join lateral (
  select sum(si.unit_cost_ref_snapshot * si.quantity) / nullif(sum(si.quantity), 0) as unit_cost_ref
  from public.sale_items si
  where si.sale_id = m.sale_id
    and si.product_id = m.product_id
) sc on k.is_sale and m.sale_id is not null
group by
  m.store_id,
  (m.created_at at time zone 'America/Caracas')::date,
  m.product_id;

comment on view public.report_stock_daily_flow is
  'Libro de stock por tienda, dia Caracas y producto: neto de todos los movimientos, unidades vendidas netas de reversiones y su costo (snapshot de la linea de venta) (REP-07). Solo lectura.';

-- -----------------------------------------------------------------------------
-- 3. Ajustes manuales (incluye mermas) con motivo y valor a costo
-- -----------------------------------------------------------------------------

create or replace view public.report_stock_adjustments
with (security_invoker = true) as
select
  m.store_id,
  m.id as movement_id,
  m.seq,
  m.created_at,
  (m.created_at at time zone 'America/Caracas')::date as movement_date,
  m.product_id,
  p.sku,
  p.name as product_name,
  m.type::text as movement_type,
  m.quantity_delta,
  coalesce(nullif(btrim(regexp_replace(m.reason, '\s+', ' ', 'g')), ''), 'Sin motivo') as reason,
  p.current_cost_ref as unit_cost_ref,
  round(m.quantity_delta * p.current_cost_ref, 2) as value_ref,
  'current_cost'::text as cost_basis
from public.stock_movements m
join public.products p on p.id = m.product_id
where m.type in ('ajuste_entrada', 'ajuste_salida')
  and m.sale_id is null
  and m.purchase_id is null;

comment on view public.report_stock_adjustments is
  'Ajustes manuales del libro (ajuste_entrada / ajuste_salida sin documento) con motivo normalizado y valor al costo ACTUAL del producto (cost_basis = current_cost) (REP-07). Solo lectura.';

-- -----------------------------------------------------------------------------
-- 4. Permisos: sin public / anon; lectura para authenticated y service_role
-- -----------------------------------------------------------------------------

do $$
declare
  v_view text;
begin
  foreach v_view in array array[
    'report_product_last_movement',
    'report_stock_daily_flow',
    'report_stock_adjustments'
  ]
  loop
    execute format('alter view public.%I set (security_invoker = true)', v_view);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', v_view);
    execute format('grant select on public.%I to authenticated, service_role', v_view);
  end loop;
end;
$$;

commit;

notify pgrst, 'reload schema';

-- ===== 20261015a-cash-close-diff-alert.sql =====
-- =============================================================================
-- 20261015a — umbral de aviso de faltante al cerrar caja, por tienda (CNF-10)
-- Proyecto: BodegaHub (plan ux-mejoras, Ola 2; §4.8 Confirmaciones)
-- Requiere: 20260716-multi-store.sql (app_settings es una fila por tienda) y
--           20261006i (funcion public.reject_non_finite_numeric).
--
--   1. app_settings (una fila por tienda, columnas; NO clave-valor):
--        * cash_close_diff_alert_ves numeric(14,2) not null default 0
--            Faltante en Bs (contado - teorico < 0) a partir del cual el modal
--            de cierre de caja pide una confirmacion explicita. Se confirma
--            cuando |faltante| SUPERA el umbral: con 0 (el default) confirma
--            cualquier faltante. Las tiendas que ya existen reciben 0 por el
--            default de la columna: no se migra nada.
--      Check app_settings_cash_close_diff_alert_check:
--            0 <= umbral <= 999999999999.99
--   2. NaN / Infinity: Infinity no cabe en numeric(14,2) (22003) y el check ya
--      rechaza NaN (compara mayor que todo: no pasa el tope). Ademas se
--      regeneran los dos triggers trg_zz_reject_non_finite_numeric_* de
--      app_settings (20261006i los crea desde el catalogo: una columna numeric
--      nueva no entra sola), para que responda PT400 "Valor numerico invalido
--      en <columna>" tambien aqui. Mismo generador que 20261006i y 20261009b,
--      acotado a esta tabla.
--
--   Seguridad: no cambia politicas ni grants. La columna queda bajo las
--   politicas de fila que ya existen (lectura de la propia tienda, escritura
--   solo admin de la tienda) y bajo los grants de tabla vigentes.
--
-- Es SOLO un aviso de la interfaz: no toca caja, baul, pagos, cierres ni
-- ninguna RPC. close_cash_session y record_cash_close_difference no leen esta
-- columna y siguen asentando la diferencia igual (docs/cuadre-baul.md).
-- Idempotente, una sola transaccion.
-- OJO: tras reaplicar 20261006i o 20261009b no hace falta reaplicar este (sus
-- barridos ya incluyen la columna nueva).
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. app_settings: umbral de aviso de faltante al cerrar caja.
-- -----------------------------------------------------------------------------

alter table public.app_settings
  add column if not exists cash_close_diff_alert_ves numeric(14,2) not null default 0;

comment on column public.app_settings.cash_close_diff_alert_ves is
  'Cierre de caja: faltante en Bs a partir del cual se pide confirmacion explicita (se confirma si |faltante| supera este valor; 0 = cualquier faltante). Solo aviso de interfaz.';

alter table public.app_settings drop constraint if exists app_settings_cash_close_diff_alert_check;
alter table public.app_settings
  add constraint app_settings_cash_close_diff_alert_check
  check (
    cash_close_diff_alert_ves >= 0
    and cash_close_diff_alert_ves <= 999999999999.99
  );

-- -----------------------------------------------------------------------------
-- 2. Triggers de 20261006i (NaN / Infinity -> PT400) regenerados para
--    app_settings con la columna numeric nueva. Mismo generador, acotado a ella.
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
    where c.oid = 'public.app_settings'::regclass
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

commit;

notify pgrst, 'reload schema';

-- ===== 20261017a-reprice-idempotency.sql =====
-- =============================================================================
-- 20261017a — clave de idempotencia del reprecio masivo y reprecio sin cambio
--             que no escribe historial (FIN-03; hallazgo B2 del caos global)
-- Proyecto: BodegaHub
-- Requiere: 20261009c (update_product_price con instantanea, product_margin_band)
--           y 20261009f (reprice_product_to_markup, price_from_markup,
--           assert_expected_cost_ref).
--
-- POST /api/products/price-review/reprice llama a reprice_product_to_markup una
-- vez por producto. La RPC delegaba SIEMPRE en update_product_price, que inserta
-- una fila de historial aunque el precio no cambie: 8 llamadas iguales dejaban 8
-- filas por producto. Y sin clave, un reintento tardio (respuesta perdida) volvia
-- a calcular el precio y pisaba un cambio hecho entre medias.
--
--   1. product_price_history.client_request_id / client_request_hash + indice
--      unico parcial (product_id, client_request_id). Opcionales: solo las
--      escribe reprice_product_to_markup cuando recibe clave.
--   2. reprice_product_to_markup gana p_client_request_id (al final, default
--      null). Se elimina la firma de cuatro argumentos para no dejar dos
--      sobrecargas vivas (PGRST203); las llamadas con cuatro siguen resolviendo.
--      Con el producto ya bloqueado:
--        a. Reintento: si el producto ya tiene una fila con esa clave, devuelve
--           el producto tal como esta, sin calcular ni escribir nada. La misma
--           clave con otro % -> PT409.
--        b. Sin nada que registrar: si el precio calculado es el vigente y la
--           ultima instantanea del producto ya guarda ese precio, el costo
--           vigente y la banda vigente, devuelve el producto sin insertar. La
--           fila que se omite seria identica a la ultima; un producto en la cola
--           "Por revisar" (costo o banda distintos de su instantanea) SI recibe
--           su fila, que es la que lo saca de la cola.
--        c. En otro caso delega en update_product_price como antes y marca la
--           fila recien insertada con la clave y la huella (el % a dos decimales).
--
-- El precio se calcula igual (price_from_markup, mismo redondeo). No cambian
-- update_product_price, update_product_price_checked ni keep_product_price; no
-- toca stock, dinero ni politicas. Las columnas nuevas no son numeric (los
-- triggers de 20261006i no se regeneran). Idempotente, una sola transaccion.
-- Ejecutar en SQL Editor o via db-up ANTES de desplegar el BFF que envia la clave.
-- OJO: reaplicar 20261009f reinstala la firma de cuatro argumentos y deja dos
-- sobrecargas: volver a aplicar este parche despues.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Clave de idempotencia en la fila de historial que deja el reprecio.
-- -----------------------------------------------------------------------------

alter table public.product_price_history
  add column if not exists client_request_id uuid,
  add column if not exists client_request_hash text;

comment on column public.product_price_history.client_request_id is
  'Clave de idempotencia del reprecio masivo que inserto la fila (unica por producto). NULL en el resto de filas.';
comment on column public.product_price_history.client_request_hash is
  'Huella del contenido enviado con client_request_id (el % de ganancia a dos decimales). La misma clave con otra huella se rechaza.';

create unique index if not exists product_price_history_product_client_request_unique
  on public.product_price_history (product_id, client_request_id)
  where client_request_id is not null;

-- -----------------------------------------------------------------------------
-- 2. reprice_product_to_markup — copia de 20261009f + reintento por clave y
--    reprecio sin cambio. Firma nueva (5 argumentos): se elimina la de 4.
-- -----------------------------------------------------------------------------

drop function if exists public.reprice_product_to_markup(uuid, numeric, text, numeric);

create or replace function public.reprice_product_to_markup(
  p_product_id uuid,
  p_markup_pct numeric,
  p_reason text default null,
  p_expected_cost_ref numeric default null,
  p_client_request_id uuid default null
)
returns public.products
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_product public.products;
  v_new_price numeric;
  v_request_hash text;
  v_prior_hash text;
  v_last public.product_price_history;
begin
  v_store_id := public.assert_store_context();
  perform public.assert_finite_numeric(p_markup_pct, 'el % de ganancia');

  if coalesce(public.current_user_role()::text, '') not in ('admin', 'almacen') then
    raise exception using errcode = 'PT403', message = 'No autorizado para cambiar precios';
  end if;

  if p_markup_pct is null or p_markup_pct <= 0 or p_markup_pct > 1000 then
    raise exception using
      errcode = 'PT400',
      message = 'El % de ganancia debe ser mayor que 0 y como máximo 1000';
  end if;

  -- El bloqueo dura hasta el final de la transaccion: update_product_price, mas
  -- abajo, ve el mismo costo que se uso para calcular, y dos llamadas con la
  -- misma clave pasan una detras de otra.
  select * into v_product
  from public.products
  where id = p_product_id
    and store_id = v_store_id
  for update;

  if not found then
    raise exception using errcode = 'PT404', message = 'Producto no encontrado';
  end if;

  -- a. Reintento de una llamada que ya cambio este producto: no se repite.
  if p_client_request_id is not null then
    v_request_hash := round(p_markup_pct, 2)::text;

    select h.client_request_hash into v_prior_hash
    from public.product_price_history h
    where h.product_id = p_product_id
      and h.client_request_id = p_client_request_id;

    if found then
      if v_prior_hash is distinct from v_request_hash then
        raise exception using
          errcode = 'PT409',
          message = 'Esta solicitud de reprecio ya se usó con otro % de ganancia',
          hint = 'REQUEST_REUSED';
      end if;

      return v_product;
    end if;
  end if;

  if coalesce(v_product.current_cost_ref, 0) <= 0 then
    raise exception using
      errcode = 'PT400',
      message = 'Sin costo no se puede calcular el precio',
      hint = 'NO_COST';
  end if;

  perform public.assert_expected_cost_ref(v_product.current_cost_ref, p_expected_cost_ref);

  v_new_price := public.price_from_markup(v_product.current_cost_ref, p_markup_pct);

  -- b. Mismo precio y la ultima instantanea ya lo guarda con el costo y la banda
  --    vigentes: la fila nueva seria identica, no se escribe.
  if v_new_price = v_product.sale_price_ref then
    select * into v_last
    from public.product_price_history h
    where h.product_id = p_product_id
      and h.snapshot_seq is not null
    order by h.snapshot_seq desc
    limit 1;

    if found
       and v_last.new_sale_price_ref = v_new_price
       and v_last.cost_ref_snapshot = v_product.current_cost_ref
       and v_last.margin_band_snapshot = public.product_margin_band(v_store_id, v_product.margin_pct) then
      return v_product;
    end if;
  end if;

  -- c. Cambio real: mismo camino que antes (historial e instantanea).
  v_product := public.update_product_price(p_product_id, v_new_price, p_reason);

  if p_client_request_id is not null then
    -- La fila mas reciente del producto es la que acaba de insertar
    -- update_product_price: el producto sigue bloqueado por esta transaccion.
    update public.product_price_history h
    set client_request_id = p_client_request_id,
        client_request_hash = v_request_hash
    where h.id = (
      select l.id
      from public.product_price_history l
      where l.product_id = p_product_id
        and l.snapshot_seq is not null
      order by l.snapshot_seq desc
      limit 1
    );
  end if;

  return v_product;
end;
$$;

comment on function public.reprice_product_to_markup(uuid, numeric, text, numeric, uuid) is
  'Reprecio a un % de ganancia: lee el costo con el producto bloqueado, calcula el precio y delega en update_product_price. Costo esperado distinto -> PT409 sin cambiar nada. Con clave, repetir la llamada no repite el cambio (misma clave con otro % -> PT409). Si el precio no cambia y la ultima instantanea ya guarda el costo y la banda vigentes, no inserta historial.';

revoke all on function public.reprice_product_to_markup(uuid, numeric, text, numeric, uuid) from public, anon;
grant execute on function public.reprice_product_to_markup(uuid, numeric, text, numeric, uuid) to authenticated, service_role;

commit;

notify pgrst, 'reload schema';

-- ===== 20261018a-reports-exclude-draft-sales.sql =====
-- =============================================================================
-- 20261018a — los reportes no cuentan las ventas en borrador (DEC-01)
-- Proyecto: BodegaHub
-- Requiere: 20260716b (product_profitability y customer_purchase_summary con
--           store_id), 20261006a (security_invoker en las vistas de reportes),
--           20261006h (RLS por tienda) y 20261013a (daily_sales_summary y
--           gross_profit_summary en dia operativo de Caracas, y las vistas
--           report_sales_by_hour y report_sales_by_category).
--
-- SOLO LECTURA: redefine vistas. No toca tablas, filas, RPC, politicas, stock
-- ni dinero.
--
-- DECISION DE NEGOCIO (DEC-01): una venta en 'borrador' NO es una venta. Hasta este parche
-- el criterio unico de los reportes (cabecera de 20261013a) solo dejaba fuera
-- 'cancelada' y 'devuelta', asi que un borrador sumaba en ventas diarias,
-- ganancia bruta, rentabilidad por producto, compras por cliente, ventas por
-- hora y ventas por categoria.
--
-- CRITERIO UNICO DE ESTADOS de los reportes de ventas desde este parche
-- (enum public.sale_status: 'borrador', 'pendiente_pago', 'pagada',
-- 'cancelada', 'devuelta'):
--
--     cuenta    : status in ('pendiente_pago', 'pagada')   (mueven stock)
--     no cuenta : 'borrador', 'cancelada', 'devuelta'
--
-- Se escribe como lista POSITIVA: un estado nuevo del enum no cuenta hasta que
-- alguien lo decida. En el BFF la misma lista vive en un solo sitio:
-- src/shared/sales/countedSaleStatuses.ts (COUNTED_SALE_STATUSES), que usan
-- los servicios de reportes y del dashboard y sus mocks.
--
-- Vistas que se redefinen (las 6 que filtran ventas por estado), cada una
-- copiada de su version VIGENTE con el filtro como unico cambio:
--
--   daily_sales_summary        20261013a (dia operativo America/Caracas)
--   gross_profit_summary       20261013a (dia operativo America/Caracas)
--   report_sales_by_hour       20261013a
--   report_sales_by_category   20261013a
--   product_profitability      20260716b (+ security_invoker de 20261006a)
--   customer_purchase_summary  20260716b (+ security_invoker de 20261006a)
--
-- Mismas columnas, tipos y orden (create or replace view), security_invoker y
-- los mismos permisos: sin acceso para public / anon, select para authenticated
-- y service_role.
--
-- Vistas que NO cambian, y por que:
--   * report_open_documents_aging (20261013a): venta abierta = 'pendiente_pago'
--     con saldo; un borrador nunca entro.
--   * store_capital_summary (20260906 / 20260906c): cuentas por cobrar =
--     'pendiente_pago'.
--   * report_product_last_movement, report_stock_daily_flow y
--     report_stock_adjustments (20261013b): leen el libro stock_movements, no
--     sales.status. Ninguna RPC mueve stock de una venta en borrador
--     (cancel_sale y return_sale la rechazan; register_payment tambien), y una
--     venta en borrador con movimientos es una fila de
--     movements_without_document con issue = 'document_status_mismatch'
--     (20261006d), no una venta.
--   * supplier_purchase_summary: es de compras.
--
-- CAMBIO DE COMPORTAMIENTO: solo para bases que tengan ventas en 'borrador'.
-- Ninguna RPC ni pantalla las crea hoy (create_sale y
-- create_sale_with_payments nacen 'pendiente_pago' o 'pagada'); con 0
-- borradores todas las cifras son identicas a las de antes. Para contarlos
-- antes de aplicar:
--
--     select store_id, count(*), sum(total_ref)
--     from public.sales where status = 'borrador' group by store_id;
--
-- ORDEN DE PARCHES. No depende del BFF: va en la tanda previa, despues de
-- 20261017a. Cualquier parche que recree una de las 6 vistas le devuelve el
-- criterio anterior y obliga a REAPLICAR este al final:
--   * 20260716b-multi-store-views.sql (drop + create de daily_sales_summary,
--     gross_profit_summary, product_profitability y customer_purchase_summary;
--     ademas las devuelve a dia UTC y les quita security_invoker): despues,
--     20261006a -> 20261013a -> 20261018a.
--   * 20261013a-report-money-views.sql (create or replace de
--     daily_sales_summary, gross_profit_summary, report_sales_by_hour y
--     report_sales_by_category): despues, 20261018a.
-- 20261006a solo hace alter view (security_invoker y permisos): no cambia el
-- filtro. verify-patches.sql detecta las dos regresiones (filas "(20261018a)").
--
-- Idempotente, una transaccion.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Resumenes diarios (dia operativo de Caracas, como en 20261013a)
-- -----------------------------------------------------------------------------

create or replace view public.daily_sales_summary
with (security_invoker = true) as
select
  store_id,
  (created_at at time zone 'America/Caracas')::date as sale_date,
  count(*) as sales_count,
  sum(total_ref) as total_ref,
  sum(total_ves) as total_ves,
  sum(paid_ves) as paid_ves
from public.sales
where status in ('pendiente_pago', 'pagada')
group by store_id, (created_at at time zone 'America/Caracas')::date;

create or replace view public.gross_profit_summary
with (security_invoker = true) as
select
  s.store_id,
  (s.created_at at time zone 'America/Caracas')::date as sale_date,
  sum(si.subtotal_ref) as revenue_ref,
  sum(si.unit_cost_ref_snapshot * si.quantity) as cost_ref,
  sum(si.gross_profit_ref) as gross_profit_ref
from public.sales s
join public.sale_items si on si.sale_id = s.id
where s.status in ('pendiente_pago', 'pagada')
group by s.store_id, (s.created_at at time zone 'America/Caracas')::date;

-- -----------------------------------------------------------------------------
-- 2. Ventas por hora y por categoria (20261013a)
-- -----------------------------------------------------------------------------

create or replace view public.report_sales_by_hour
with (security_invoker = true) as
select
  s.store_id,
  (s.created_at at time zone 'America/Caracas')::date as sale_date,
  extract(isodow from (s.created_at at time zone 'America/Caracas'))::integer as dow,
  extract(hour from (s.created_at at time zone 'America/Caracas'))::integer as hour,
  count(*) as sales_count,
  sum(s.total_ref) as total_ref,
  sum(s.total_ves) as total_ves
from public.sales s
where s.status in ('pendiente_pago', 'pagada')
group by
  s.store_id,
  (s.created_at at time zone 'America/Caracas')::date,
  extract(isodow from (s.created_at at time zone 'America/Caracas'))::integer,
  extract(hour from (s.created_at at time zone 'America/Caracas'))::integer;

comment on view public.report_sales_by_hour is
  'Ventas que cuentan (pendiente_pago y pagada; no borrador, cancelada ni devuelta) por tienda, dia Caracas, dia de la semana ISO (1 = lunes) y hora Caracas (REP-06, DEC-01).';

create or replace view public.report_sales_by_category
with (security_invoker = true) as
select
  s.store_id,
  (s.created_at at time zone 'America/Caracas')::date as sale_date,
  p.category_id,
  coalesce(c.name, 'Sin categoría') as category_name,
  sum(si.quantity) as units,
  sum(si.subtotal_ref) as revenue_ref,
  sum(si.unit_cost_ref_snapshot * si.quantity) as cost_ref,
  sum(si.gross_profit_ref) as gross_profit_ref
from public.sales s
join public.sale_items si on si.sale_id = s.id
left join public.products p on p.id = si.product_id
left join public.categories c on c.id = p.category_id
where s.status in ('pendiente_pago', 'pagada')
group by
  s.store_id,
  (s.created_at at time zone 'America/Caracas')::date,
  p.category_id,
  coalesce(c.name, 'Sin categoría');

-- -----------------------------------------------------------------------------
-- 3. Rentabilidad por producto y compras por cliente (20260716b)
-- -----------------------------------------------------------------------------

create or replace view public.product_profitability
with (security_invoker = true) as
select
  p.store_id,
  p.id as product_id,
  p.sku,
  p.name,
  sum(si.quantity) as units_sold,
  sum(si.subtotal_ref) as revenue_ref,
  sum(si.unit_cost_ref_snapshot * si.quantity) as cost_ref,
  sum(si.gross_profit_ref) as gross_profit_ref
from public.products p
join public.sale_items si on si.product_id = p.id
join public.sales s on s.id = si.sale_id
where s.status in ('pendiente_pago', 'pagada')
group by p.store_id, p.id, p.sku, p.name;

create or replace view public.customer_purchase_summary
with (security_invoker = true) as
select
  c.store_id,
  c.id as customer_id,
  c.name,
  count(s.id) as sales_count,
  coalesce(sum(s.total_ref), 0) as total_ref,
  coalesce(sum(s.total_ves), 0) as total_ves,
  coalesce(sum(s.total_ves - s.paid_ves), 0) as pending_ves,
  max(s.created_at) as last_purchase_at
from public.contacts c
left join public.sales s
  on s.customer_id = c.id
 and s.status in ('pendiente_pago', 'pagada')
where c.type in ('cliente', 'ambos')
group by c.store_id, c.id, c.name;

-- -----------------------------------------------------------------------------
-- 4. Permisos: sin public / anon; lectura para authenticated y service_role
-- -----------------------------------------------------------------------------

do $$
declare
  v_view text;
begin
  foreach v_view in array array[
    'daily_sales_summary',
    'gross_profit_summary',
    'report_sales_by_hour',
    'report_sales_by_category',
    'product_profitability',
    'customer_purchase_summary'
  ]
  loop
    execute format('alter view public.%I set (security_invoker = true)', v_view);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', v_view);
    execute format('grant select on public.%I to authenticated, service_role', v_view);
  end loop;
end;
$$;

commit;

notify pgrst, 'reload schema';
