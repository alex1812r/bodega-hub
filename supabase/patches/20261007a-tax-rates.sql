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
