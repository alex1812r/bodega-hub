-- Seed data for Control Ventas ERP (dev/staging).
-- Run after supabase-schema.sql on a fresh Supabase project.
-- Password for all seeded users: Admin123!

begin;

-- Fixed UUIDs for reproducible references across modules and tests.
-- Admin
--   user: 11111111-1111-4111-8111-111111111111
-- Vendedor
--   user: 22222222-2222-4222-8222-222222222222
-- Almacen
--   user: 33333333-3333-4333-8333-333333333333
-- Contador
--   user: 44444444-4444-4444-8444-444444444444
-- Vendedor + contacts.manage (permisos hibridos de prueba)
--   user: 55555555-5555-4555-8555-555555555555
-- Category general
--   cat:  aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa
-- Exchange rate
--   rate: bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '11111111-1111-4111-8111-111111111111',
    'authenticated',
    'authenticated',
    'admin@example.com',
    crypt('Admin123!', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Admin Demo"}',
    now(),
    now(),
    '',
    '',
    '',
    ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '22222222-2222-4222-8222-222222222222',
    'authenticated',
    'authenticated',
    'vendedor@example.com',
    crypt('Admin123!', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Vendedor Demo"}',
    now(),
    now(),
    '',
    '',
    '',
    ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '33333333-3333-4333-8333-333333333333',
    'authenticated',
    'authenticated',
    'almacen@example.com',
    crypt('Admin123!', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Almacen Demo"}',
    now(),
    now(),
    '',
    '',
    '',
    ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '44444444-4444-4444-8444-444444444444',
    'authenticated',
    'authenticated',
    'contador@example.com',
    crypt('Admin123!', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Contador Demo"}',
    now(),
    now(),
    '',
    '',
    '',
    ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '55555555-5555-4555-8555-555555555555',
    'authenticated',
    'authenticated',
    'vendedor.contactos@example.com',
    crypt('Admin123!', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Vendedor Contactos Demo"}',
    now(),
    now(),
    '',
    '',
    '',
    ''
  )
on conflict (id) do nothing;

insert into auth.identities (
  id,
  user_id,
  identity_data,
  provider,
  provider_id,
  last_sign_in_at,
  created_at,
  updated_at
)
select
  id,
  id,
  jsonb_build_object('sub', id::text, 'email', email),
  'email',
  id::text,
  now(),
  now(),
  now()
from auth.users
where id in (
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444',
  '55555555-5555-4555-8555-555555555555'
)
on conflict do nothing;

insert into public.profiles (id, full_name, role, is_active, granted_permissions, denied_permissions)
values
  ('11111111-1111-4111-8111-111111111111', 'Admin Demo', 'admin', true, '[]'::jsonb, '[]'::jsonb),
  (
    '22222222-2222-4222-8222-222222222222',
    'Vendedor Demo',
    'vendedor',
    true,
    '[]'::jsonb,
    '[]'::jsonb
  ),
  (
    '55555555-5555-4555-8555-555555555555',
    'Vendedor Contactos Demo',
    'vendedor',
    true,
    '["contacts.manage"]'::jsonb,
    '[]'::jsonb
  ),
  ('33333333-3333-4333-8333-333333333333', 'Almacen Demo', 'almacen', true, '[]'::jsonb, '[]'::jsonb),
  ('44444444-4444-4444-8444-444444444444', 'Contador Demo', 'contador', true, '[]'::jsonb, '[]'::jsonb)
on conflict (id) do update set
  full_name = excluded.full_name,
  role = excluded.role,
  is_active = excluded.is_active,
  granted_permissions = excluded.granted_permissions,
  denied_permissions = excluded.denied_permissions;

insert into public.app_settings (id, business_name, default_tax_rate, invoice_prefix, low_stock_threshold)
values (1, 'Control Ventas ERP', 16, 'FAC', 5)
on conflict (id) do update set
  business_name = excluded.business_name,
  default_tax_rate = excluded.default_tax_rate,
  invoice_prefix = excluded.invoice_prefix,
  low_stock_threshold = excluded.low_stock_threshold;

insert into public.categories (id, name, description, is_active)
values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'General',
  'Categoria inicial de desarrollo',
  true
)
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  is_active = excluded.is_active;

insert into public.exchange_rates (id, rate_ves, source, notes, created_by)
values (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  45.5000,
  'BCV',
  'Tasa inicial de desarrollo',
  '11111111-1111-4111-8111-111111111111'
)
on conflict (id) do update set
  rate_ves = excluded.rate_ves,
  source = excluded.source,
  notes = excluded.notes;

commit;
