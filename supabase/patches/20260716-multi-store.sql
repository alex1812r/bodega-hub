-- Patch: multitienda (stores + store_id + superadmin)
-- Ejecutar en Supabase SQL Editor. Idempotente.
--
-- PREREQUISITO (obligatorio, en una corrida SEPARADA):
--   1) Ejecutar primero: 20260716a-user-role-superadmin.sql
--   2) Confirmar OK
--   3) Luego este archivo
--
-- Ver docs/multi-store-options.md y docs/supabase-setup.md

-- =============================================================================
-- Precheck: enum superadmin debe existir (commit previo)
-- =============================================================================

do $$ begin
  if not exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'user_role'
      and e.enumlabel = 'superadmin'
  ) then
    raise exception
      'Falta el enum user_role.superadmin. Ejecuta primero 20260716a-user-role-superadmin.sql y vuelve a correr este patch.';
  end if;
end $$;

-- =============================================================================
-- Enums
-- =============================================================================

do $$ begin
  create type public.store_status as enum ('active', 'paused');
exception when duplicate_object then null;
end $$;

-- =============================================================================
-- Tabla stores + tienda default
-- =============================================================================

create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  status public.store_status not null default 'active',
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stores_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

create unique index if not exists stores_slug_unique on public.stores (slug);

drop trigger if exists trg_stores_updated_at on public.stores;
create trigger trg_stores_updated_at
before update on public.stores
for each row execute function public.set_updated_at();

insert into public.stores (id, name, slug, status, notes)
select
  '00000000-0000-4000-8000-000000000001'::uuid,
  coalesce(
    (select business_name from public.app_settings where id = 1 limit 1),
    'Tienda principal'
  ),
  'default',
  'active',
  'Tienda creada por migracion single-tenant → multitienda'
where not exists (
  select 1 from public.stores where id = '00000000-0000-4000-8000-000000000001'::uuid
);

-- =============================================================================
-- profiles.store_id + constraint rol↔ tienda
-- =============================================================================

alter table public.profiles
  add column if not exists store_id uuid references public.stores(id) on delete restrict;

update public.profiles
set store_id = '00000000-0000-4000-8000-000000000001'::uuid
where store_id is null
  and role::text <> 'superadmin';

alter table public.profiles drop constraint if exists profiles_store_role_check;
alter table public.profiles
  add constraint profiles_store_role_check check (
    (role::text = 'superadmin' and store_id is null)
    or (role::text <> 'superadmin' and store_id is not null)
  );

create index if not exists idx_profiles_store_id on public.profiles(store_id);

-- =============================================================================
-- Helper: store del usuario actual
-- =============================================================================

create or replace function public.current_user_store_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select store_id
  from public.profiles
  where id = auth.uid();
$$;

create or replace function public.current_user_is_superadmin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role::text = 'superadmin'
      and is_active = true
  );
$$;

create or replace function public.assert_store_context()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
begin
  v_store_id := public.current_user_store_id();
  if v_store_id is null then
    raise exception 'No tienes permisos para realizar esta operacion en este recurso'
      using errcode = '42501';
  end if;
  return v_store_id;
end;
$$;

-- =============================================================================
-- store_id en tablas raiz + backfill
-- =============================================================================

alter table public.categories add column if not exists store_id uuid references public.stores(id) on delete restrict;
alter table public.products add column if not exists store_id uuid references public.stores(id) on delete restrict;
alter table public.contacts add column if not exists store_id uuid references public.stores(id) on delete restrict;
alter table public.sales add column if not exists store_id uuid references public.stores(id) on delete restrict;
alter table public.purchases add column if not exists store_id uuid references public.stores(id) on delete restrict;
alter table public.payments add column if not exists store_id uuid references public.stores(id) on delete restrict;
alter table public.stock_movements add column if not exists store_id uuid references public.stores(id) on delete restrict;
alter table public.supplier_products add column if not exists store_id uuid references public.stores(id) on delete restrict;
alter table public.exchange_rates add column if not exists store_id uuid references public.stores(id) on delete restrict;

update public.categories set store_id = '00000000-0000-4000-8000-000000000001'::uuid where store_id is null;
update public.products set store_id = '00000000-0000-4000-8000-000000000001'::uuid where store_id is null;
update public.contacts set store_id = '00000000-0000-4000-8000-000000000001'::uuid where store_id is null;
update public.sales set store_id = '00000000-0000-4000-8000-000000000001'::uuid where store_id is null;
update public.purchases set store_id = '00000000-0000-4000-8000-000000000001'::uuid where store_id is null;
update public.payments set store_id = '00000000-0000-4000-8000-000000000001'::uuid where store_id is null;
update public.stock_movements set store_id = '00000000-0000-4000-8000-000000000001'::uuid where store_id is null;
update public.supplier_products set store_id = '00000000-0000-4000-8000-000000000001'::uuid where store_id is null;
update public.exchange_rates set store_id = '00000000-0000-4000-8000-000000000001'::uuid where store_id is null;

alter table public.categories alter column store_id set not null;
alter table public.products alter column store_id set not null;
alter table public.contacts alter column store_id set not null;
alter table public.sales alter column store_id set not null;
alter table public.purchases alter column store_id set not null;
alter table public.payments alter column store_id set not null;
alter table public.stock_movements alter column store_id set not null;
alter table public.supplier_products alter column store_id set not null;
alter table public.exchange_rates alter column store_id set not null;

create index if not exists idx_categories_store_id on public.categories(store_id);
create index if not exists idx_products_store_id on public.products(store_id);
create index if not exists idx_contacts_store_id on public.contacts(store_id);
create index if not exists idx_sales_store_id on public.sales(store_id);
create index if not exists idx_purchases_store_id on public.purchases(store_id);
create index if not exists idx_payments_store_id on public.payments(store_id);
create index if not exists idx_stock_movements_store_id on public.stock_movements(store_id);
create index if not exists idx_supplier_products_store_id on public.supplier_products(store_id);
create index if not exists idx_exchange_rates_store_id on public.exchange_rates(store_id);

-- =============================================================================
-- Uniques compuestos por tienda
-- =============================================================================

alter table public.products drop constraint if exists products_sku_key;
drop index if exists products_sku_key;
create unique index if not exists products_store_sku_unique on public.products (store_id, sku);

drop index if exists products_barcode_unique;
create unique index if not exists products_store_barcode_unique
  on public.products (store_id, barcode)
  where barcode is not null and trim(barcode) <> '';

alter table public.contacts drop constraint if exists contacts_tax_id_key;
drop index if exists contacts_tax_id_key;
create unique index if not exists contacts_store_tax_id_unique
  on public.contacts (store_id, tax_id)
  where tax_id is not null and trim(tax_id) <> '';

alter table public.sales drop constraint if exists sales_invoice_number_key;
drop index if exists sales_invoice_number_key;
create unique index if not exists sales_store_invoice_unique on public.sales (store_id, invoice_number);

alter table public.purchases drop constraint if exists purchases_purchase_number_key;
drop index if exists purchases_purchase_number_key;
create unique index if not exists purchases_store_number_unique on public.purchases (store_id, purchase_number);

drop index if exists uq_categories_name_active;
create unique index if not exists uq_categories_store_name_active
  on public.categories (store_id, name)
  where is_active = true;

-- =============================================================================
-- app_settings por tienda
-- =============================================================================

alter table public.app_settings drop constraint if exists app_settings_pkey;
alter table public.app_settings drop constraint if exists app_settings_id_check;

alter table public.app_settings
  add column if not exists store_id uuid references public.stores(id) on delete cascade;

update public.app_settings
set store_id = '00000000-0000-4000-8000-000000000001'::uuid
where store_id is null;

alter table public.app_settings alter column store_id set not null;

-- Reemplazar PK singleton: usar store_id como clave
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'app_settings_store_id_key'
  ) then
    alter table public.app_settings add constraint app_settings_store_id_key unique (store_id);
  end if;
exception when others then null;
end $$;

create unique index if not exists app_settings_store_id_unique on public.app_settings (store_id);

-- id deja de ser singleton; mantener columna por compatibilidad
alter table public.app_settings alter column id drop default;
-- Permitir multiples filas: quitar check id=1 si queda
alter table public.app_settings drop constraint if exists app_settings_id_check;

-- Si no hay PK, recrear con store_id
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.app_settings'::regclass and contype = 'p'
  ) then
    alter table public.app_settings add primary key (store_id);
  end if;
exception when others then
  -- si id sigue siendo PK, dejar unique store_id
  null;
end $$;

insert into public.app_settings (id, store_id, business_name, default_tax_rate, invoice_prefix, low_stock_threshold)
select
  1,
  '00000000-0000-4000-8000-000000000001'::uuid,
  'BodegaHub',
  16,
  'FAC',
  5
where not exists (
  select 1 from public.app_settings
  where store_id = '00000000-0000-4000-8000-000000000001'::uuid
);

-- =============================================================================
-- RLS: stores (solo superadmin)
-- =============================================================================

alter table public.stores enable row level security;

drop policy if exists "Superadmin read stores" on public.stores;
create policy "Superadmin read stores"
on public.stores for select
to authenticated
using (public.current_user_is_superadmin());

drop policy if exists "Superadmin manage stores" on public.stores;
create policy "Superadmin manage stores"
on public.stores for all
to authenticated
using (public.current_user_is_superadmin())
with check (public.current_user_is_superadmin());

-- =============================================================================
-- RLS: tablas de negocio por store_id
-- =============================================================================

drop policy if exists "Authenticated users read categories" on public.categories;
create policy "Authenticated users read categories"
on public.categories for select
to authenticated
using (store_id = public.current_user_store_id());

drop policy if exists "Admins and warehouse manage categories" on public.categories;
create policy "Admins and warehouse manage categories"
on public.categories for all
to authenticated
using (
  store_id = public.current_user_store_id()
  and public.current_user_role() in ('admin', 'almacen')
)
with check (
  store_id = public.current_user_store_id()
  and public.current_user_role() in ('admin', 'almacen')
);

drop policy if exists "Authenticated users read products" on public.products;
create policy "Authenticated users read products"
on public.products for select
to authenticated
using (store_id = public.current_user_store_id());

drop policy if exists "Admins and warehouse manage products" on public.products;
create policy "Admins and warehouse manage products"
on public.products for all
to authenticated
using (
  store_id = public.current_user_store_id()
  and public.current_user_role() in ('admin', 'almacen')
)
with check (
  store_id = public.current_user_store_id()
  and public.current_user_role() in ('admin', 'almacen')
);

drop policy if exists "Authenticated users read contacts" on public.contacts;
create policy "Authenticated users read contacts"
on public.contacts for select
to authenticated
using (store_id = public.current_user_store_id());

drop policy if exists "Authenticated users create contacts" on public.contacts;
create policy "Authenticated users create contacts"
on public.contacts for insert
to authenticated
with check (
  store_id = public.current_user_store_id()
  and public.current_user_role() in ('admin', 'vendedor', 'almacen', 'contador')
);

drop policy if exists "Admins update contacts" on public.contacts;
create policy "Admins update contacts"
on public.contacts for update
to authenticated
using (
  store_id = public.current_user_store_id()
  and public.current_user_role() in ('admin', 'contador')
)
with check (
  store_id = public.current_user_store_id()
  and public.current_user_role() in ('admin', 'contador')
);

drop policy if exists "Authenticated users read sales" on public.sales;
create policy "Authenticated users read sales"
on public.sales for select
to authenticated
using (store_id = public.current_user_store_id());

drop policy if exists "Authenticated users read purchases" on public.purchases;
create policy "Authenticated users read purchases"
on public.purchases for select
to authenticated
using (store_id = public.current_user_store_id());

drop policy if exists "Authenticated users read payments" on public.payments;
create policy "Authenticated users read payments"
on public.payments for select
to authenticated
using (store_id = public.current_user_store_id());

drop policy if exists "Authenticated users read stock movements" on public.stock_movements;
create policy "Authenticated users read stock movements"
on public.stock_movements for select
to authenticated
using (store_id = public.current_user_store_id());

drop policy if exists "Authenticated users read supplier products" on public.supplier_products;
create policy "Authenticated users read supplier products"
on public.supplier_products for select
to authenticated
using (store_id = public.current_user_store_id());

drop policy if exists "Admins and warehouse manage supplier products" on public.supplier_products;
create policy "Admins and warehouse manage supplier products"
on public.supplier_products for all
to authenticated
using (
  store_id = public.current_user_store_id()
  and public.current_user_role() in ('admin', 'almacen')
)
with check (
  store_id = public.current_user_store_id()
  and public.current_user_role() in ('admin', 'almacen')
);

drop policy if exists "Authenticated users read exchange rates" on public.exchange_rates;
create policy "Authenticated users read exchange rates"
on public.exchange_rates for select
to authenticated
using (store_id = public.current_user_store_id());

drop policy if exists "Admins and accountants create exchange rates" on public.exchange_rates;
create policy "Admins and accountants create exchange rates"
on public.exchange_rates for insert
to authenticated
with check (
  store_id = public.current_user_store_id()
  and public.current_user_role() in ('admin', 'contador')
);

drop policy if exists "Authenticated users read app settings" on public.app_settings;
create policy "Authenticated users read app settings"
on public.app_settings for select
to authenticated
using (store_id = public.current_user_store_id());

drop policy if exists "Admins manage app settings" on public.app_settings;
create policy "Admins manage app settings"
on public.app_settings for all
to authenticated
using (
  store_id = public.current_user_store_id()
  and public.current_user_role() = 'admin'
)
with check (
  store_id = public.current_user_store_id()
  and public.current_user_role() = 'admin'
);

-- Profiles: admin de tienda ve/gestiona perfiles de su tienda; superadmin ve todos
drop policy if exists "Profiles are readable by owner or admin" on public.profiles;
create policy "Profiles are readable by owner or admin"
on public.profiles for select
to authenticated
using (
  id = auth.uid()
  or public.current_user_is_superadmin()
  or (
    public.current_user_role() = 'admin'
    and store_id = public.current_user_store_id()
  )
);

drop policy if exists "Admins manage profiles" on public.profiles;
create policy "Admins manage profiles"
on public.profiles for all
to authenticated
using (
  public.current_user_is_superadmin()
  or (
    public.current_user_role() = 'admin'
    and store_id = public.current_user_store_id()
    and role::text <> 'superadmin'
  )
)
with check (
  public.current_user_is_superadmin()
  or (
    public.current_user_role() = 'admin'
    and store_id = public.current_user_store_id()
    and role::text <> 'superadmin'
  )
);

-- =============================================================================
-- RPCs: exigir contexto de tienda al inicio (funciones criticas)
-- Se reaplican cuerpos con assert_store_context + filtros store_id
-- =============================================================================

-- Nota: las RPCs security definer bypass RLS; deben filtrar store_id explicitamente.
-- Parche minimo: adjust_stock valida producto de la tienda del caller.

create or replace function public.adjust_stock(
  p_product_id uuid,
  p_quantity_delta integer,
  p_movement_type public.stock_movement_type,
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
  v_new_stock integer;
begin
  v_store_id := public.assert_store_context();

  if public.current_user_role() not in ('admin', 'almacen') then
    raise exception 'No autorizado para ajustar stock';
  end if;

  if p_quantity_delta = 0 then
    raise exception 'La cantidad no puede ser cero';
  end if;

  if p_movement_type not in ('ajuste_entrada', 'ajuste_salida', 'inventario_inicial') then
    raise exception 'Tipo de movimiento invalido para ajuste manual';
  end if;

  select * into v_product
  from public.products
  where id = p_product_id
    and store_id = v_store_id
  for update;

  if not found then
    raise exception 'No tienes permisos para realizar esta operacion en este recurso';
  end if;

  v_new_stock := v_product.current_stock + p_quantity_delta;
  if v_new_stock < 0 then
    raise exception 'Stock insuficiente';
  end if;

  update public.products
  set current_stock = v_new_stock,
      updated_at = now()
  where id = p_product_id
  returning * into v_product;

  insert into public.stock_movements (
    product_id, type, quantity_delta, stock_after, reason, store_id
  ) values (
    p_product_id, p_movement_type, p_quantity_delta, v_new_stock, p_reason, v_store_id
  );

  return v_product;
end;
$$;

notify pgrst, 'reload schema';
