-- Patch: crear usuario superadmin de plataforma (sin tocar admin/vendedor de tienda)
-- Ejecutar en SQL Editor. Idempotente.
-- Password: Admin123!
--
-- Este script DESACTIVA el trigger on_auth_user_created durante el insert
-- para evitar el check profiles_store_role_check (el trigger viejo creaba
-- vendedor con store_id null).

-- =============================================================================
-- 1) Tienda default
-- =============================================================================

insert into public.stores (id, name, slug, status, notes)
values (
  '00000000-0000-4000-8000-000000000001'::uuid,
  coalesce(
    (select business_name from public.app_settings where store_id = '00000000-0000-4000-8000-000000000001'::uuid limit 1),
    (select business_name from public.app_settings limit 1),
    'Tienda principal'
  ),
  'default',
  'active',
  'Tienda principal (datos existentes)'
)
on conflict (id) do nothing;

-- =============================================================================
-- 2) Actualizar trigger handle_new_user (para futuros altas)
-- =============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_store_id uuid;
begin
  v_role := coalesce(nullif(trim(new.raw_user_meta_data ->> 'role'), ''), 'vendedor');

  if v_role = 'superadmin' then
    v_store_id := null;
  else
    v_store_id := coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'store_id'), '')::uuid,
      '00000000-0000-4000-8000-000000000001'::uuid
    );
  end if;

  insert into public.profiles (id, full_name, role, store_id, is_active)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
    v_role::public.user_role,
    v_store_id,
    true
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- =============================================================================
-- 3) Crear superadmin SIN disparar triggers de auth.users
-- =============================================================================

-- session_replication_role = replica evita triggers (mas fiable en Supabase que DISABLE TRIGGER)
set local session_replication_role = replica;

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
values (
  '00000000-0000-0000-0000-000000000000',
  '66666666-6666-4666-8666-666666666666',
  'authenticated',
  'authenticated',
  'superadmin@example.com',
  crypt('Admin123!', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"Superadmin Demo","role":"superadmin"}',
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
where id = '66666666-6666-4666-8666-666666666666'
on conflict do nothing;

-- Perfil plataforma (explicito; triggers desactivados en esta transaccion)
insert into public.profiles (id, full_name, role, is_active, granted_permissions, denied_permissions, store_id)
values (
  '66666666-6666-4666-8666-666666666666',
  'Superadmin Demo',
  'superadmin',
  true,
  '[]'::jsonb,
  '[]'::jsonb,
  null
)
on conflict (id) do update set
  full_name = excluded.full_name,
  role = 'superadmin',
  is_active = true,
  store_id = null;

set local session_replication_role = origin;

-- =============================================================================
-- 4) Reafirmar usuarios de tienda
-- =============================================================================

update public.profiles
set store_id = '00000000-0000-4000-8000-000000000001'::uuid
where role::text <> 'superadmin'
  and store_id is null;

update public.profiles
set role = 'admin',
    store_id = '00000000-0000-4000-8000-000000000001'::uuid
where id = '11111111-1111-4111-8111-111111111111';

update public.profiles
set role = 'vendedor',
    store_id = '00000000-0000-4000-8000-000000000001'::uuid
where id = '22222222-2222-4222-8222-222222222222';
