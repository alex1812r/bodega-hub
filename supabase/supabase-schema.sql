-- ERP schema for Supabase/PostgreSQL
-- Execute this file in the Supabase SQL Editor for a fresh project.
--
-- Convenciones:
-- - Escrituras transaccionales solo via RPC (security definer).
-- - RLS habilitado: sin politica INSERT en tablas criticas = bloqueado para cliente directo.
-- - Roles alineados con la app: admin, vendedor, almacen, contador.
-- - Permisos finos (granted/denied) viven en profiles; la app calcula permisos efectivos.

begin;

create extension if not exists pgcrypto;

-- =========================
-- Enums
-- =========================

do $$ begin
  create type public.user_role as enum ('admin', 'vendedor', 'almacen', 'contador');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.contact_type as enum ('cliente', 'proveedor', 'ambos');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.sale_status as enum ('borrador', 'pendiente_pago', 'pagada', 'cancelada', 'devuelta');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.purchase_status as enum ('pedido', 'recibido', 'cancelado', 'devuelto');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.payment_direction as enum ('entrada', 'salida');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.payment_method as enum (
    'efectivo_ves',
    'efectivo_usd',
    'pago_movil',
    'punto_venta',
    'transferencia'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.payment_currency as enum ('VES', 'USD');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.stock_movement_type as enum (
    'venta',
    'compra',
    'ajuste_entrada',
    'ajuste_salida',
    'devolucion_cliente',
    'devolucion_proveedor',
    'inventario_inicial'
  );
exception when duplicate_object then null;
end $$;

-- =========================
-- Tables
-- =========================

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role public.user_role not null default 'vendedor',
  is_active boolean not null default true,
  granted_permissions jsonb not null default '[]'::jsonb,
  denied_permissions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(granted_permissions) = 'array'),
  check (jsonb_typeof(denied_permissions) = 'array')
);

create table if not exists public.app_settings (
  id smallint primary key default 1 check (id = 1),
  business_name text not null default 'Control Ventas ERP',
  default_tax_rate numeric(5,2) not null default 16 check (default_tax_rate >= 0),
  invoice_prefix text not null default 'FAC',
  low_stock_threshold integer not null default 5 check (low_stock_threshold >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.categories(id) on delete set null,
  sku text not null unique,
  name text not null,
  description text,
  sale_price_ref numeric(12,2) not null default 0 check (sale_price_ref >= 0),
  current_cost_ref numeric(12,2) not null default 0 check (current_cost_ref >= 0),
  current_stock integer not null default 0 check (current_stock >= 0),
  min_stock integer not null default 5 check (min_stock >= 0),
  image_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.exchange_rates (
  id uuid primary key default gen_random_uuid(),
  rate_ves numeric(14,4) not null check (rate_ves > 0),
  source text,
  notes text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.product_price_history (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  old_sale_price_ref numeric(12,2),
  new_sale_price_ref numeric(12,2) not null check (new_sale_price_ref >= 0),
  reason text,
  changed_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  type public.contact_type not null,
  name text not null,
  tax_id text unique,
  email text,
  phone text,
  address text,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.supplier_products (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.contacts(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  supplier_sku text,
  last_cost_ref numeric(12,2) check (last_cost_ref is null or last_cost_ref >= 0),
  last_cost_ves numeric(14,2) check (last_cost_ves is null or last_cost_ves >= 0),
  last_purchased_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (supplier_id, product_id)
);

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null unique,
  customer_id uuid not null references public.contacts(id),
  user_id uuid references public.profiles(id) on delete set null default auth.uid(),
  exchange_rate_id uuid references public.exchange_rates(id),
  ref_rate_ves numeric(14,4) not null check (ref_rate_ves > 0),
  subtotal_ref numeric(14,2) not null default 0 check (subtotal_ref >= 0),
  discount_ref numeric(14,2) not null default 0 check (discount_ref >= 0),
  tax_ref numeric(14,2) not null default 0 check (tax_ref >= 0),
  total_ref numeric(14,2) not null default 0 check (total_ref >= 0),
  total_ves numeric(14,2) not null default 0 check (total_ves >= 0),
  paid_ves numeric(14,2) not null default 0 check (paid_ves >= 0),
  status public.sale_status not null default 'pendiente_pago',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  product_id uuid not null references public.products(id),
  quantity integer not null check (quantity > 0),
  unit_price_ref numeric(12,2) not null check (unit_price_ref >= 0),
  unit_cost_ref_snapshot numeric(12,2) not null default 0 check (unit_cost_ref_snapshot >= 0),
  subtotal_ref numeric(14,2) generated always as (round((quantity::numeric * unit_price_ref), 2)) stored,
  subtotal_ves numeric(14,2) not null default 0 check (subtotal_ves >= 0),
  gross_profit_ref numeric(14,2) generated always as (round((quantity::numeric * (unit_price_ref - unit_cost_ref_snapshot)), 2)) stored
);

create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  purchase_number text not null unique,
  supplier_id uuid not null references public.contacts(id),
  user_id uuid references public.profiles(id) on delete set null default auth.uid(),
  exchange_rate_id uuid references public.exchange_rates(id),
  ref_rate_ves numeric(14,4) not null check (ref_rate_ves > 0),
  subtotal_ref numeric(14,2) not null default 0 check (subtotal_ref >= 0),
  discount_ref numeric(14,2) not null default 0 check (discount_ref >= 0),
  tax_ref numeric(14,2) not null default 0 check (tax_ref >= 0),
  total_ref numeric(14,2) not null default 0 check (total_ref >= 0),
  total_ves numeric(14,2) not null default 0 check (total_ves >= 0),
  paid_ves numeric(14,2) not null default 0 check (paid_ves >= 0),
  status public.purchase_status not null default 'recibido',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.purchase_items (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.purchases(id) on delete cascade,
  product_id uuid not null references public.products(id),
  quantity integer not null check (quantity > 0),
  unit_cost_ref numeric(12,2) not null check (unit_cost_ref >= 0),
  unit_cost_ves numeric(14,2) not null default 0 check (unit_cost_ves >= 0),
  subtotal_ref numeric(14,2) generated always as (round((quantity::numeric * unit_cost_ref), 2)) stored,
  subtotal_ves numeric(14,2) not null default 0 check (subtotal_ves >= 0)
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  direction public.payment_direction not null,
  sale_id uuid references public.sales(id) on delete cascade,
  purchase_id uuid references public.purchases(id) on delete cascade,
  contact_id uuid not null references public.contacts(id),
  method public.payment_method not null,
  currency public.payment_currency not null,
  amount numeric(14,2) not null check (amount > 0),
  amount_ves numeric(14,2) not null check (amount_ves > 0),
  amount_ref numeric(14,2) not null check (amount_ref >= 0),
  ref_rate_ves numeric(14,4) not null check (ref_rate_ves > 0),
  bank_name text,
  phone text,
  reference_code text,
  notes text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  check (
    (sale_id is not null and purchase_id is null and direction = 'entrada')
    or
    (sale_id is null and purchase_id is not null and direction = 'salida')
  ),
  check (
    (method = 'efectivo_usd' and currency = 'USD')
    or
    (method <> 'efectivo_usd' and currency = 'VES')
  ),
  check (
    method <> 'pago_movil'
    or (
      bank_name is not null
      and length(trim(bank_name)) > 0
      and phone is not null
      and length(trim(phone)) > 0
      and reference_code is not null
      and reference_code ~ '^[0-9]{4}$'
    )
  ),
  check (
    method <> 'transferencia'
    or (
      bank_name is not null
      and length(trim(bank_name)) > 0
      and reference_code is not null
      and length(trim(reference_code)) > 0
    )
  )
);

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id),
  type public.stock_movement_type not null,
  quantity_delta integer not null check (quantity_delta <> 0),
  stock_after integer not null,
  sale_id uuid references public.sales(id) on delete set null,
  purchase_id uuid references public.purchases(id) on delete set null,
  reason text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

-- =========================
-- Indexes
-- =========================

create unique index if not exists uq_categories_name_active
  on public.categories(name)
  where is_active = true;

create index if not exists idx_categories_is_active on public.categories(is_active);

create index if not exists idx_products_category_id on public.products(category_id);
create index if not exists idx_products_is_active on public.products(is_active);
create index if not exists idx_contacts_type on public.contacts(type);
create index if not exists idx_contacts_tax_id on public.contacts(tax_id);
create index if not exists idx_exchange_rates_created_at on public.exchange_rates(created_at desc);
create index if not exists idx_product_price_history_product_id on public.product_price_history(product_id);
create index if not exists idx_sales_created_at on public.sales(created_at desc);
create index if not exists idx_sales_customer_id on public.sales(customer_id);
create index if not exists idx_sales_status on public.sales(status);
create index if not exists idx_sale_items_sale_id on public.sale_items(sale_id);
create index if not exists idx_sale_items_product_id on public.sale_items(product_id);
create index if not exists idx_purchases_created_at on public.purchases(created_at desc);
create index if not exists idx_purchases_supplier_id on public.purchases(supplier_id);
create index if not exists idx_purchase_items_purchase_id on public.purchase_items(purchase_id);
create index if not exists idx_purchase_items_product_id on public.purchase_items(product_id);
create index if not exists idx_payments_sale_id on public.payments(sale_id);
create index if not exists idx_payments_purchase_id on public.payments(purchase_id);
create index if not exists idx_payments_contact_created_at on public.payments(contact_id, created_at desc);
create index if not exists idx_stock_movements_product_created_at on public.stock_movements(product_id, created_at desc);

-- =========================
-- Helpers and triggers
-- =========================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists trg_app_settings_updated_at on public.app_settings;
create trigger trg_app_settings_updated_at
before update on public.app_settings
for each row execute function public.set_updated_at();

drop trigger if exists trg_categories_updated_at on public.categories;
create trigger trg_categories_updated_at
before update on public.categories
for each row execute function public.set_updated_at();

drop trigger if exists trg_products_updated_at on public.products;
create trigger trg_products_updated_at
before update on public.products
for each row execute function public.set_updated_at();

drop trigger if exists trg_contacts_updated_at on public.contacts;
create trigger trg_contacts_updated_at
before update on public.contacts
for each row execute function public.set_updated_at();

drop trigger if exists trg_supplier_products_updated_at on public.supplier_products;
create trigger trg_supplier_products_updated_at
before update on public.supplier_products
for each row execute function public.set_updated_at();

drop trigger if exists trg_sales_updated_at on public.sales;
create trigger trg_sales_updated_at
before update on public.sales
for each row execute function public.set_updated_at();

drop trigger if exists trg_purchases_updated_at on public.purchases;
create trigger trg_purchases_updated_at
before update on public.purchases
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
    'vendedor'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.profiles
  where id = auth.uid()
    and is_active = true
  limit 1;
$$;

create or replace function public.assert_contact_type(
  p_contact_id uuid,
  p_expected_types public.contact_type[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type public.contact_type;
begin
  select type into v_type
  from public.contacts
  where id = p_contact_id
    and is_active = true;

  if not found then
    raise exception 'Contacto no encontrado o inactivo';
  end if;

  if not (v_type = any (p_expected_types)) then
    raise exception 'Tipo de contacto invalido para esta operacion';
  end if;
end;
$$;

-- =========================
-- Business RPC functions
-- =========================

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
  v_product public.products;
  v_old_price numeric(12,2);
begin
  if public.current_user_role() not in ('admin', 'almacen') then
    raise exception 'No autorizado para cambiar precios';
  end if;

  if p_new_sale_price_ref < 0 then
    raise exception 'El precio no puede ser negativo';
  end if;

  select * into v_product
  from public.products
  where id = p_product_id
  for update;

  if not found then
    raise exception 'Producto no encontrado';
  end if;

  v_old_price := v_product.sale_price_ref;

  update public.products
  set sale_price_ref = p_new_sale_price_ref
  where id = p_product_id
  returning * into v_product;

  insert into public.product_price_history (
    product_id,
    old_sale_price_ref,
    new_sale_price_ref,
    reason,
    changed_by
  )
  values (
    p_product_id,
    v_old_price,
    p_new_sale_price_ref,
    p_reason,
    auth.uid()
  );

  return v_product;
end;
$$;

create or replace function public.adjust_stock(
  p_product_id uuid,
  p_quantity_delta integer,
  p_reason text default null,
  p_type public.stock_movement_type default null
)
returns public.stock_movements
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product public.products;
  v_new_stock integer;
  v_type public.stock_movement_type;
  v_movement public.stock_movements;
begin
  if public.current_user_role() not in ('admin', 'almacen') then
    raise exception 'No autorizado para ajustar stock';
  end if;

  if p_quantity_delta = 0 then
    raise exception 'El ajuste de stock no puede ser cero';
  end if;

  select * into v_product
  from public.products
  where id = p_product_id
  for update;

  if not found then
    raise exception 'Producto no encontrado';
  end if;

  v_new_stock := v_product.current_stock + p_quantity_delta;

  if v_new_stock < 0 then
    raise exception 'Stock insuficiente';
  end if;

  v_type := coalesce(
    p_type,
    case
      when p_quantity_delta > 0 then 'ajuste_entrada'::public.stock_movement_type
      else 'ajuste_salida'::public.stock_movement_type
    end
  );

  if v_type in ('venta', 'compra') then
    raise exception 'Use create_sale o create_purchase para movimientos de venta o compra';
  end if;

  update public.products
  set current_stock = v_new_stock
  where id = p_product_id;

  insert into public.stock_movements (
    product_id,
    type,
    quantity_delta,
    stock_after,
    reason,
    created_by
  )
  values (
    p_product_id,
    v_type,
    p_quantity_delta,
    v_new_stock,
    p_reason,
    auth.uid()
  )
  returning * into v_movement;

  return v_movement;
end;
$$;

create or replace function public.create_sale(
  p_customer_id uuid,
  p_items jsonb,
  p_exchange_rate_id uuid default null,
  p_ref_rate_ves numeric default null,
  p_discount_ref numeric default 0,
  p_tax_ref numeric default 0,
  p_notes text default null,
  p_invoice_number text default null
)
returns public.sales
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rate numeric(14,4);
  v_sale public.sales;
  v_item jsonb;
  v_product public.products;
  v_product_id uuid;
  v_quantity integer;
  v_unit_price_ref numeric(12,2);
  v_unit_cost_ref numeric(12,2);
  v_line_subtotal_ref numeric(14,2);
  v_line_subtotal_ves numeric(14,2);
  v_subtotal_ref numeric(14,2) := 0;
  v_total_ref numeric(14,2);
  v_total_ves numeric(14,2);
  v_stock_after integer;
begin
  if public.current_user_role() not in ('admin', 'vendedor') then
    raise exception 'No autorizado para crear ventas';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La venta debe tener al menos un item';
  end if;

  if p_exchange_rate_id is not null then
    select rate_ves into v_rate
    from public.exchange_rates
    where id = p_exchange_rate_id;
  else
    v_rate := p_ref_rate_ves;
  end if;

  if v_rate is null or v_rate <= 0 then
    raise exception 'Debe indicar una tasa ref/VES valida';
  end if;

  perform public.assert_contact_type(p_customer_id, array['cliente', 'ambos']::public.contact_type[]);

  insert into public.sales (
    invoice_number,
    customer_id,
    user_id,
    exchange_rate_id,
    ref_rate_ves,
    discount_ref,
    tax_ref,
    status,
    notes
  )
  values (
    coalesce(p_invoice_number, 'V-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS')),
    p_customer_id,
    auth.uid(),
    p_exchange_rate_id,
    v_rate,
    coalesce(p_discount_ref, 0),
    coalesce(p_tax_ref, 0),
    'pendiente_pago',
    p_notes
  )
  returning * into v_sale;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_product_id := (v_item ->> 'product_id')::uuid;
    v_quantity := (v_item ->> 'quantity')::integer;

    if v_quantity is null or v_quantity <= 0 then
      raise exception 'Cantidad invalida en item de venta';
    end if;

    select * into v_product
    from public.products
    where id = v_product_id
      and is_active = true
    for update;

    if not found then
      raise exception 'Producto no encontrado o inactivo: %', v_product_id;
    end if;

    if v_product.current_stock < v_quantity then
      raise exception 'Stock insuficiente para producto %', v_product.sku;
    end if;

    v_unit_price_ref := coalesce((v_item ->> 'unit_price_ref')::numeric, v_product.sale_price_ref);
    v_unit_cost_ref := coalesce(v_product.current_cost_ref, 0);
    v_line_subtotal_ref := round(v_quantity::numeric * v_unit_price_ref, 2);
    v_line_subtotal_ves := round(v_line_subtotal_ref * v_rate, 2);
    v_subtotal_ref := v_subtotal_ref + v_line_subtotal_ref;
    v_stock_after := v_product.current_stock - v_quantity;

    insert into public.sale_items (
      sale_id,
      product_id,
      quantity,
      unit_price_ref,
      unit_cost_ref_snapshot,
      subtotal_ves
    )
    values (
      v_sale.id,
      v_product_id,
      v_quantity,
      v_unit_price_ref,
      v_unit_cost_ref,
      v_line_subtotal_ves
    );

    update public.products
    set current_stock = v_stock_after
    where id = v_product_id;

    insert into public.stock_movements (
      product_id,
      type,
      quantity_delta,
      stock_after,
      sale_id,
      reason,
      created_by
    )
    values (
      v_product_id,
      'venta',
      -v_quantity,
      v_stock_after,
      v_sale.id,
      'Venta ' || v_sale.invoice_number,
      auth.uid()
    );
  end loop;

  v_total_ref := greatest(round(v_subtotal_ref - coalesce(p_discount_ref, 0) + coalesce(p_tax_ref, 0), 2), 0);
  v_total_ves := round(v_total_ref * v_rate, 2);

  update public.sales
  set subtotal_ref = v_subtotal_ref,
      total_ref = v_total_ref,
      total_ves = v_total_ves
  where id = v_sale.id
  returning * into v_sale;

  return v_sale;
end;
$$;

create or replace function public.create_purchase(
  p_supplier_id uuid,
  p_items jsonb,
  p_exchange_rate_id uuid default null,
  p_ref_rate_ves numeric default null,
  p_discount_ref numeric default 0,
  p_tax_ref numeric default 0,
  p_notes text default null,
  p_purchase_number text default null,
  p_status public.purchase_status default 'recibido'
)
returns public.purchases
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rate numeric(14,4);
  v_purchase public.purchases;
  v_item jsonb;
  v_product public.products;
  v_product_id uuid;
  v_quantity integer;
  v_unit_cost_ref numeric(12,2);
  v_unit_cost_ves numeric(14,2);
  v_line_subtotal_ref numeric(14,2);
  v_line_subtotal_ves numeric(14,2);
  v_subtotal_ref numeric(14,2) := 0;
  v_total_ref numeric(14,2);
  v_total_ves numeric(14,2);
  v_stock_after integer;
  v_supplier_sku text;
begin
  if public.current_user_role() not in ('admin', 'almacen') then
    raise exception 'No autorizado para crear compras';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La compra debe tener al menos un item';
  end if;

  if p_exchange_rate_id is not null then
    select rate_ves into v_rate
    from public.exchange_rates
    where id = p_exchange_rate_id;
  else
    v_rate := p_ref_rate_ves;
  end if;

  if v_rate is null or v_rate <= 0 then
    raise exception 'Debe indicar una tasa ref/VES valida';
  end if;

  if p_status not in ('pedido', 'recibido') then
    raise exception 'Solo se puede crear una compra en estado pedido o recibido';
  end if;

  perform public.assert_contact_type(p_supplier_id, array['proveedor', 'ambos']::public.contact_type[]);

  insert into public.purchases (
    purchase_number,
    supplier_id,
    user_id,
    exchange_rate_id,
    ref_rate_ves,
    discount_ref,
    tax_ref,
    status,
    notes
  )
  values (
    coalesce(p_purchase_number, 'C-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS')),
    p_supplier_id,
    auth.uid(),
    p_exchange_rate_id,
    v_rate,
    coalesce(p_discount_ref, 0),
    coalesce(p_tax_ref, 0),
    p_status,
    p_notes
  )
  returning * into v_purchase;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_product_id := (v_item ->> 'product_id')::uuid;
    v_quantity := (v_item ->> 'quantity')::integer;
    v_unit_cost_ref := (v_item ->> 'unit_cost_ref')::numeric;
    v_supplier_sku := v_item ->> 'supplier_sku';

    if v_quantity is null or v_quantity <= 0 then
      raise exception 'Cantidad invalida en item de compra';
    end if;

    if v_unit_cost_ref is null or v_unit_cost_ref < 0 then
      raise exception 'Costo invalido en item de compra';
    end if;

    select * into v_product
    from public.products
    where id = v_product_id
    for update;

    if not found then
      raise exception 'Producto no encontrado: %', v_product_id;
    end if;

    v_unit_cost_ves := round(v_unit_cost_ref * v_rate, 2);
    v_line_subtotal_ref := round(v_quantity::numeric * v_unit_cost_ref, 2);
    v_line_subtotal_ves := round(v_line_subtotal_ref * v_rate, 2);
    v_subtotal_ref := v_subtotal_ref + v_line_subtotal_ref;

    insert into public.purchase_items (
      purchase_id,
      product_id,
      quantity,
      unit_cost_ref,
      unit_cost_ves,
      subtotal_ves
    )
    values (
      v_purchase.id,
      v_product_id,
      v_quantity,
      v_unit_cost_ref,
      v_unit_cost_ves,
      v_line_subtotal_ves
    );

    if p_status = 'recibido' then
      v_stock_after := v_product.current_stock + v_quantity;

      update public.products
      set current_stock = v_stock_after,
          current_cost_ref = v_unit_cost_ref
      where id = v_product_id;

      insert into public.supplier_products (
        supplier_id,
        product_id,
        supplier_sku,
        last_cost_ref,
        last_cost_ves,
        last_purchased_at
      )
      values (
        p_supplier_id,
        v_product_id,
        v_supplier_sku,
        v_unit_cost_ref,
        v_unit_cost_ves,
        now()
      )
      on conflict (supplier_id, product_id)
      do update set
        supplier_sku = coalesce(excluded.supplier_sku, public.supplier_products.supplier_sku),
        last_cost_ref = excluded.last_cost_ref,
        last_cost_ves = excluded.last_cost_ves,
        last_purchased_at = excluded.last_purchased_at,
        updated_at = now();

      insert into public.stock_movements (
        product_id,
        type,
        quantity_delta,
        stock_after,
        purchase_id,
        reason,
        created_by
      )
      values (
        v_product_id,
        'compra',
        v_quantity,
        v_stock_after,
        v_purchase.id,
        'Compra ' || v_purchase.purchase_number,
        auth.uid()
      );
    end if;
  end loop;

  v_total_ref := greatest(round(v_subtotal_ref - coalesce(p_discount_ref, 0) + coalesce(p_tax_ref, 0), 2), 0);
  v_total_ves := round(v_total_ref * v_rate, 2);

  update public.purchases
  set subtotal_ref = v_subtotal_ref,
      total_ref = v_total_ref,
      total_ves = v_total_ves
  where id = v_purchase.id
  returning * into v_purchase;

  return v_purchase;
end;
$$;

create or replace function public.register_payment(
  p_sale_id uuid default null,
  p_purchase_id uuid default null,
  p_method public.payment_method default 'efectivo_ves',
  p_amount numeric default 0,
  p_bank_name text default null,
  p_phone text default null,
  p_reference_code text default null,
  p_notes text default null
)
returns public.payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale public.sales;
  v_purchase public.purchases;
  v_payment public.payments;
  v_direction public.payment_direction;
  v_contact_id uuid;
  v_rate numeric(14,4);
  v_currency public.payment_currency;
  v_amount_ves numeric(14,2);
  v_amount_ref numeric(14,2);
  v_paid_ves numeric(14,2);
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'El monto del pago debe ser mayor a cero';
  end if;

  if (p_sale_id is null and p_purchase_id is null) or (p_sale_id is not null and p_purchase_id is not null) then
    raise exception 'Debe asociar el pago a una venta o a una compra';
  end if;

  if p_method = 'pago_movil' then
    if p_bank_name is null or length(trim(p_bank_name)) = 0 then
      raise exception 'Pago Movil requiere banco';
    end if;

    if p_phone is null or length(trim(p_phone)) = 0 then
      raise exception 'Pago Movil requiere telefono';
    end if;

    if p_reference_code is null or p_reference_code !~ '^[0-9]{4}$' then
      raise exception 'Pago Movil requiere referencia de 4 digitos';
    end if;
  end if;

  if p_method = 'transferencia' then
    if p_bank_name is null or length(trim(p_bank_name)) = 0 then
      raise exception 'Transferencia requiere banco';
    end if;

    if p_reference_code is null or length(trim(p_reference_code)) = 0 then
      raise exception 'Transferencia requiere numero de transferencia';
    end if;
  end if;

  if p_sale_id is not null then
    if public.current_user_role() not in ('admin', 'contador', 'vendedor') then
      raise exception 'No autorizado para registrar pagos de ventas';
    end if;

    select * into v_sale
    from public.sales
    where id = p_sale_id
    for update;

    if not found then
      raise exception 'Venta no encontrada';
    end if;

    v_direction := 'entrada';
    v_contact_id := v_sale.customer_id;
    v_rate := v_sale.ref_rate_ves;

    if p_method = 'efectivo_usd' then
      v_currency := 'USD';
      v_amount_ref := round(p_amount, 2);
      v_amount_ves := round(p_amount * v_rate, 2);
    else
      v_currency := 'VES';
      v_amount_ves := round(p_amount, 2);
      v_amount_ref := round(p_amount / v_rate, 2);
    end if;

    update public.sales
    set paid_ves = paid_ves + v_amount_ves,
        status = case
          when paid_ves + v_amount_ves >= total_ves then 'pagada'::public.sale_status
          else 'pendiente_pago'::public.sale_status
        end
    where id = p_sale_id
    returning paid_ves into v_paid_ves;
  else
    if public.current_user_role() not in ('admin', 'contador') then
      raise exception 'No autorizado para registrar pagos a proveedores';
    end if;

    select * into v_purchase
    from public.purchases
    where id = p_purchase_id
    for update;

    if not found then
      raise exception 'Compra no encontrada';
    end if;

    v_direction := 'salida';
    v_contact_id := v_purchase.supplier_id;
    v_rate := v_purchase.ref_rate_ves;

    if p_method = 'efectivo_usd' then
      v_currency := 'USD';
      v_amount_ref := round(p_amount, 2);
      v_amount_ves := round(p_amount * v_rate, 2);
    else
      v_currency := 'VES';
      v_amount_ves := round(p_amount, 2);
      v_amount_ref := round(p_amount / v_rate, 2);
    end if;

    update public.purchases
    set paid_ves = paid_ves + v_amount_ves
    where id = p_purchase_id
    returning paid_ves into v_paid_ves;
  end if;

  insert into public.payments (
    direction,
    sale_id,
    purchase_id,
    contact_id,
    method,
    currency,
    amount,
    amount_ves,
    amount_ref,
    ref_rate_ves,
    bank_name,
    phone,
    reference_code,
    notes,
    created_by
  )
  values (
    v_direction,
    p_sale_id,
    p_purchase_id,
    v_contact_id,
    p_method,
    v_currency,
    p_amount,
    v_amount_ves,
    v_amount_ref,
    v_rate,
    nullif(trim(p_bank_name), ''),
    nullif(trim(p_phone), ''),
    p_reference_code,
    p_notes,
    auth.uid()
  )
  returning * into v_payment;

  return v_payment;
end;
$$;

create or replace function public.receive_purchase(p_purchase_id uuid)
returns public.purchases
language plpgsql
security definer
set search_path = public
as $$
declare
  v_purchase public.purchases;
  v_item public.purchase_items;
  v_product public.products;
  v_stock_after integer;
begin
  if public.current_user_role() not in ('admin', 'almacen') then
    raise exception 'No autorizado para recibir compras';
  end if;

  select * into v_purchase
  from public.purchases
  where id = p_purchase_id
  for update;

  if not found then
    raise exception 'Compra no encontrada';
  end if;

  if v_purchase.status <> 'pedido' then
    raise exception 'Solo se pueden recibir compras en estado pedido';
  end if;

  for v_item in
    select *
    from public.purchase_items
    where purchase_id = p_purchase_id
  loop
    select * into v_product
    from public.products
    where id = v_item.product_id
    for update;

    v_stock_after := v_product.current_stock + v_item.quantity;

    update public.products
    set current_stock = v_stock_after,
        current_cost_ref = v_item.unit_cost_ref
    where id = v_item.product_id;

    insert into public.supplier_products (
      supplier_id,
      product_id,
      last_cost_ref,
      last_cost_ves,
      last_purchased_at
    )
    values (
      v_purchase.supplier_id,
      v_item.product_id,
      v_item.unit_cost_ref,
      v_item.unit_cost_ves,
      now()
    )
    on conflict (supplier_id, product_id)
    do update set
      last_cost_ref = excluded.last_cost_ref,
      last_cost_ves = excluded.last_cost_ves,
      last_purchased_at = excluded.last_purchased_at,
      updated_at = now();

    insert into public.stock_movements (
      product_id,
      type,
      quantity_delta,
      stock_after,
      purchase_id,
      reason,
      created_by
    )
    values (
      v_item.product_id,
      'compra',
      v_item.quantity,
      v_stock_after,
      v_purchase.id,
      'Recepcion ' || v_purchase.purchase_number,
      auth.uid()
    );
  end loop;

  update public.purchases
  set status = 'recibido'
  where id = p_purchase_id
  returning * into v_purchase;

  return v_purchase;
end;
$$;

create or replace function public.cancel_sale(p_sale_id uuid)
returns public.sales
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale public.sales;
  v_item public.sale_items;
  v_product public.products;
  v_stock_after integer;
begin
  if public.current_user_role() not in ('admin', 'vendedor') then
    raise exception 'No autorizado para cancelar ventas';
  end if;

  select * into v_sale
  from public.sales
  where id = p_sale_id
  for update;

  if not found then
    raise exception 'Venta no encontrada';
  end if;

  if v_sale.status in ('cancelada', 'devuelta') then
    raise exception 'La venta ya fue cancelada o devuelta';
  end if;

  for v_item in
    select *
    from public.sale_items
    where sale_id = p_sale_id
  loop
    select * into v_product
    from public.products
    where id = v_item.product_id
    for update;

    v_stock_after := v_product.current_stock + v_item.quantity;

    update public.products
    set current_stock = v_stock_after
    where id = v_item.product_id;

    insert into public.stock_movements (
      product_id,
      type,
      quantity_delta,
      stock_after,
      sale_id,
      reason,
      created_by
    )
    values (
      v_item.product_id,
      'ajuste_entrada',
      v_item.quantity,
      v_stock_after,
      p_sale_id,
      'Cancelacion ' || v_sale.invoice_number,
      auth.uid()
    );
  end loop;

  update public.sales
  set status = 'cancelada'
  where id = p_sale_id
  returning * into v_sale;

  return v_sale;
end;
$$;

create or replace function public.return_sale(p_sale_id uuid)
returns public.sales
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale public.sales;
  v_item public.sale_items;
  v_product public.products;
  v_stock_after integer;
begin
  if public.current_user_role() not in ('admin', 'vendedor') then
    raise exception 'No autorizado para devolver ventas';
  end if;

  select * into v_sale
  from public.sales
  where id = p_sale_id
  for update;

  if not found then
    raise exception 'Venta no encontrada';
  end if;

  if v_sale.status in ('cancelada', 'devuelta') then
    raise exception 'La venta ya fue cancelada o devuelta';
  end if;

  for v_item in
    select *
    from public.sale_items
    where sale_id = p_sale_id
  loop
    select * into v_product
    from public.products
    where id = v_item.product_id
    for update;

    v_stock_after := v_product.current_stock + v_item.quantity;

    update public.products
    set current_stock = v_stock_after
    where id = v_item.product_id;

    insert into public.stock_movements (
      product_id,
      type,
      quantity_delta,
      stock_after,
      sale_id,
      reason,
      created_by
    )
    values (
      v_item.product_id,
      'devolucion_cliente',
      v_item.quantity,
      v_stock_after,
      p_sale_id,
      'Devolucion ' || v_sale.invoice_number,
      auth.uid()
    );
  end loop;

  update public.sales
  set status = 'devuelta'
  where id = p_sale_id
  returning * into v_sale;

  return v_sale;
end;
$$;

create or replace function public.cancel_purchase(p_purchase_id uuid)
returns public.purchases
language plpgsql
security definer
set search_path = public
as $$
declare
  v_purchase public.purchases;
  v_item public.purchase_items;
  v_product public.products;
  v_stock_after integer;
begin
  if public.current_user_role() not in ('admin', 'almacen') then
    raise exception 'No autorizado para cancelar compras';
  end if;

  select * into v_purchase
  from public.purchases
  where id = p_purchase_id
  for update;

  if not found then
    raise exception 'Compra no encontrada';
  end if;

  if v_purchase.status in ('cancelado', 'devuelto') then
    raise exception 'La compra ya fue cancelada o devuelta';
  end if;

  if v_purchase.status = 'recibido' then
    for v_item in
      select *
      from public.purchase_items
      where purchase_id = p_purchase_id
    loop
      select * into v_product
      from public.products
      where id = v_item.product_id
      for update;

      v_stock_after := v_product.current_stock - v_item.quantity;

      if v_stock_after < 0 then
        raise exception 'No hay stock suficiente para revertir la compra';
      end if;

      update public.products
      set current_stock = v_stock_after
      where id = v_item.product_id;

      insert into public.stock_movements (
        product_id,
        type,
        quantity_delta,
        stock_after,
        purchase_id,
        reason,
        created_by
      )
      values (
        v_item.product_id,
        'ajuste_salida',
        -v_item.quantity,
        v_stock_after,
        p_purchase_id,
        'Cancelacion ' || v_purchase.purchase_number,
        auth.uid()
      );
    end loop;
  end if;

  update public.purchases
  set status = 'cancelado'
  where id = p_purchase_id
  returning * into v_purchase;

  return v_purchase;
end;
$$;

create or replace function public.return_purchase(p_purchase_id uuid)
returns public.purchases
language plpgsql
security definer
set search_path = public
as $$
declare
  v_purchase public.purchases;
  v_item public.purchase_items;
  v_product public.products;
  v_stock_after integer;
begin
  if public.current_user_role() not in ('admin', 'almacen') then
    raise exception 'No autorizado para devolver compras';
  end if;

  select * into v_purchase
  from public.purchases
  where id = p_purchase_id
  for update;

  if not found then
    raise exception 'Compra no encontrada';
  end if;

  if v_purchase.status in ('cancelado', 'devuelto') then
    raise exception 'La compra ya fue cancelada o devuelta';
  end if;

  if v_purchase.status = 'recibido' then
    for v_item in
      select *
      from public.purchase_items
      where purchase_id = p_purchase_id
    loop
      select * into v_product
      from public.products
      where id = v_item.product_id
      for update;

      v_stock_after := v_product.current_stock - v_item.quantity;

      if v_stock_after < 0 then
        raise exception 'No hay stock suficiente para revertir la compra';
      end if;

      update public.products
      set current_stock = v_stock_after
      where id = v_item.product_id;

      insert into public.stock_movements (
        product_id,
        type,
        quantity_delta,
        stock_after,
        purchase_id,
        reason,
        created_by
      )
      values (
        v_item.product_id,
        'devolucion_proveedor',
        -v_item.quantity,
        v_stock_after,
        p_purchase_id,
        'Devolucion ' || v_purchase.purchase_number,
        auth.uid()
      );
    end loop;
  end if;

  update public.purchases
  set status = 'devuelto'
  where id = p_purchase_id
  returning * into v_purchase;

  return v_purchase;
end;
$$;

-- =========================
-- Report views
-- =========================

create or replace view public.daily_sales_summary as
select
  date_trunc('day', created_at)::date as sale_date,
  count(*) as sales_count,
  sum(total_ref) as total_ref,
  sum(total_ves) as total_ves,
  sum(paid_ves) as paid_ves
from public.sales
where status not in ('cancelada', 'devuelta')
group by 1;

create or replace view public.gross_profit_summary as
select
  date_trunc('day', s.created_at)::date as sale_date,
  sum(si.subtotal_ref) as revenue_ref,
  sum(si.unit_cost_ref_snapshot * si.quantity) as cost_ref,
  sum(si.gross_profit_ref) as gross_profit_ref
from public.sales s
join public.sale_items si on si.sale_id = s.id
where s.status not in ('cancelada', 'devuelta')
group by 1;

create or replace view public.product_profitability as
select
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
where s.status not in ('cancelada', 'devuelta')
group by p.id, p.sku, p.name;

create or replace view public.customer_purchase_summary as
select
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
 and s.status not in ('cancelada', 'devuelta')
where c.type in ('cliente', 'ambos')
group by c.id, c.name;

create or replace view public.supplier_purchase_summary as
select
  c.id as supplier_id,
  c.name,
  count(p.id) as purchases_count,
  coalesce(sum(p.total_ref), 0) as total_ref,
  coalesce(sum(p.total_ves), 0) as total_ves,
  coalesce(sum(p.total_ves - p.paid_ves), 0) as pending_ves,
  max(p.created_at) as last_purchase_at
from public.contacts c
left join public.purchases p
  on p.supplier_id = c.id
 and p.status not in ('cancelado', 'devuelto')
where c.type in ('proveedor', 'ambos')
group by c.id, c.name;

create or replace view public.low_stock_products as
select *
from public.products
where is_active = true
  and current_stock <= min_stock;

create or replace view public.stock_card as
select
  sm.id,
  sm.product_id,
  p.sku,
  p.name as product_name,
  sm.type,
  sm.quantity_delta,
  sm.stock_after,
  sm.sale_id,
  sm.purchase_id,
  sm.reason,
  sm.created_by,
  sm.created_at
from public.stock_movements sm
join public.products p on p.id = sm.product_id;

-- =========================
-- Row Level Security
-- =========================

alter table public.profiles enable row level security;
alter table public.app_settings enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.exchange_rates enable row level security;
alter table public.product_price_history enable row level security;
alter table public.contacts enable row level security;
alter table public.supplier_products enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.purchases enable row level security;
alter table public.purchase_items enable row level security;
alter table public.payments enable row level security;
alter table public.stock_movements enable row level security;

drop policy if exists "Profiles are readable by owner or admin" on public.profiles;
create policy "Profiles are readable by owner or admin"
on public.profiles for select
to authenticated
using (id = auth.uid() or public.current_user_role() = 'admin');

drop policy if exists "Admins manage profiles" on public.profiles;
create policy "Admins manage profiles"
on public.profiles for all
to authenticated
using (public.current_user_role() = 'admin')
with check (public.current_user_role() = 'admin');

drop policy if exists "Authenticated users read app settings" on public.app_settings;
create policy "Authenticated users read app settings"
on public.app_settings for select
to authenticated
using (true);

drop policy if exists "Admins manage app settings" on public.app_settings;
create policy "Admins manage app settings"
on public.app_settings for all
to authenticated
using (public.current_user_role() = 'admin')
with check (public.current_user_role() = 'admin');

drop policy if exists "Authenticated users read categories" on public.categories;
create policy "Authenticated users read categories"
on public.categories for select
to authenticated
using (true);

drop policy if exists "Admins and warehouse manage categories" on public.categories;
create policy "Admins and warehouse manage categories"
on public.categories for all
to authenticated
using (public.current_user_role() in ('admin', 'almacen'))
with check (public.current_user_role() in ('admin', 'almacen'));

drop policy if exists "Authenticated users read products" on public.products;
create policy "Authenticated users read products"
on public.products for select
to authenticated
using (true);

drop policy if exists "Admins and warehouse manage products" on public.products;
create policy "Admins and warehouse manage products"
on public.products for all
to authenticated
using (public.current_user_role() in ('admin', 'almacen'))
with check (public.current_user_role() in ('admin', 'almacen'));

drop policy if exists "Authenticated users read exchange rates" on public.exchange_rates;
create policy "Authenticated users read exchange rates"
on public.exchange_rates for select
to authenticated
using (true);

drop policy if exists "Admins and accountants create exchange rates" on public.exchange_rates;
create policy "Admins and accountants create exchange rates"
on public.exchange_rates for insert
to authenticated
with check (public.current_user_role() in ('admin', 'contador'));

drop policy if exists "Authenticated users read price history" on public.product_price_history;
create policy "Authenticated users read price history"
on public.product_price_history for select
to authenticated
using (true);

drop policy if exists "Admins and warehouse insert price history" on public.product_price_history;
create policy "Admins and warehouse insert price history"
on public.product_price_history for insert
to authenticated
with check (public.current_user_role() in ('admin', 'almacen'));

drop policy if exists "Authenticated users read contacts" on public.contacts;
create policy "Authenticated users read contacts"
on public.contacts for select
to authenticated
using (true);

drop policy if exists "Authenticated users create contacts" on public.contacts;
create policy "Authenticated users create contacts"
on public.contacts for insert
to authenticated
with check (public.current_user_role() in ('admin', 'vendedor', 'almacen', 'contador'));

drop policy if exists "Admins update contacts" on public.contacts;
create policy "Admins update contacts"
on public.contacts for update
to authenticated
using (public.current_user_role() in ('admin', 'contador'))
with check (public.current_user_role() in ('admin', 'contador'));

drop policy if exists "Authenticated users read supplier products" on public.supplier_products;
create policy "Authenticated users read supplier products"
on public.supplier_products for select
to authenticated
using (true);

drop policy if exists "Admins and warehouse manage supplier products" on public.supplier_products;
create policy "Admins and warehouse manage supplier products"
on public.supplier_products for all
to authenticated
using (public.current_user_role() in ('admin', 'almacen'))
with check (public.current_user_role() in ('admin', 'almacen'));

drop policy if exists "Authenticated users read sales" on public.sales;
create policy "Authenticated users read sales"
on public.sales for select
to authenticated
using (true);

drop policy if exists "Admins and sellers create sales" on public.sales;
-- Sales must be created through public.create_sale() to keep totals and stock atomic.

drop policy if exists "Admins update sales" on public.sales;
create policy "Admins update sales"
on public.sales for update
to authenticated
using (public.current_user_role() = 'admin')
with check (public.current_user_role() = 'admin');

drop policy if exists "Authenticated users read sale items" on public.sale_items;
create policy "Authenticated users read sale items"
on public.sale_items for select
to authenticated
using (true);

drop policy if exists "Admins and sellers create sale items" on public.sale_items;
-- Sale items must be created through public.create_sale().

drop policy if exists "Authenticated users read purchases" on public.purchases;
create policy "Authenticated users read purchases"
on public.purchases for select
to authenticated
using (true);

drop policy if exists "Admins and warehouse create purchases" on public.purchases;
-- Purchases must be created through public.create_purchase() to keep costs and stock atomic.

drop policy if exists "Admins update purchases" on public.purchases;
create policy "Admins update purchases"
on public.purchases for update
to authenticated
using (public.current_user_role() = 'admin')
with check (public.current_user_role() = 'admin');

drop policy if exists "Authenticated users read purchase items" on public.purchase_items;
create policy "Authenticated users read purchase items"
on public.purchase_items for select
to authenticated
using (true);

drop policy if exists "Admins and warehouse create purchase items" on public.purchase_items;
-- Purchase items must be created through public.create_purchase().

drop policy if exists "Authenticated users read payments" on public.payments;
create policy "Authenticated users read payments"
on public.payments for select
to authenticated
using (true);

drop policy if exists "Authorized users create payments" on public.payments;
-- Payments must be created through public.register_payment().

drop policy if exists "Admins and accountants update payment metadata" on public.payments;
create policy "Admins and accountants update payment metadata"
on public.payments for update
to authenticated
using (public.current_user_role() in ('admin', 'contador'))
with check (public.current_user_role() in ('admin', 'contador'));

drop policy if exists "Authenticated users read stock movements" on public.stock_movements;
create policy "Authenticated users read stock movements"
on public.stock_movements for select
to authenticated
using (true);

drop policy if exists "Admins and warehouse create stock movements" on public.stock_movements;
-- Stock movements must be created through public.create_sale(), public.create_purchase()
-- or public.adjust_stock().

-- =========================
-- Grants
-- =========================

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant select on public.daily_sales_summary to authenticated;
grant select on public.gross_profit_summary to authenticated;
grant select on public.product_profitability to authenticated;
grant select on public.customer_purchase_summary to authenticated;
grant select on public.supplier_purchase_summary to authenticated;
grant select on public.low_stock_products to authenticated;
grant select on public.stock_card to authenticated;
grant execute on function public.assert_contact_type(uuid, public.contact_type[]) to authenticated;
grant execute on function public.update_product_price(uuid, numeric, text) to authenticated;
grant execute on function public.adjust_stock(uuid, integer, text, public.stock_movement_type) to authenticated;
grant execute on function public.create_sale(uuid, jsonb, uuid, numeric, numeric, numeric, text, text) to authenticated;
grant execute on function public.create_purchase(uuid, jsonb, uuid, numeric, numeric, numeric, text, text, public.purchase_status) to authenticated;
grant execute on function public.receive_purchase(uuid) to authenticated;
grant execute on function public.register_payment(uuid, uuid, public.payment_method, numeric, text, text, text, text) to authenticated;
grant execute on function public.cancel_sale(uuid) to authenticated;
grant execute on function public.return_sale(uuid) to authenticated;
grant execute on function public.cancel_purchase(uuid) to authenticated;
grant execute on function public.return_purchase(uuid) to authenticated;

insert into public.app_settings (id)
values (1)
on conflict (id) do nothing;

commit;
