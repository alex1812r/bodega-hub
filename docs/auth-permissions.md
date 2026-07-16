# Roles y Permisos

Este proyecto usa una capa de permisos por rol (y overrides por usuario) para controlar qué módulos puede ver o usar cada perfil. La **validación definitiva** ocurre en el backend (`requirePermission`, RLS). La UI replica permisos para ocultar menú y acciones.

Estado de autenticación (julio 2026):

- **Backend auth:** `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me` operativos (Supabase + cookies).
- **Entrada app:** `/` redirige en [`src/app/page.tsx`](../src/app/page.tsx) (server): con sesión → home por rol, sin sesión → `/login`.
- **Proxy (Next 16):** [`src/proxy.ts`](../src/proxy.ts) redirige a `/login?next=...` si no hay sesión Supabase en rutas privadas. Se omite cuando `ALLOW_DEMO_AUTH=true` (dev con `x-demo-role`). `/api/*` no se bloquea (auth en handlers).
- **UI auth:** `useLogin` (BFF), `useLogout`, `useCurrentUser`; `AuthenticatedAppShell` carga perfil real y filtra menú por permisos.
- **401 global:** [`src/lib/query/query-client.ts`](../src/lib/query/query-client.ts) redirige a `/login`.
- **Demo dev:** `ALLOW_DEMO_AUTH=true` + `x-demo-role` desde `localStorage` (no usar en producción).

Ver [`frontend-api-guide.md`](frontend-api-guide.md#autenticación-y-permisos) y [`modules-catalog.md`](modules-catalog.md#auth).

## Roles Iniciales

- `superadmin`: solo backoffice plataforma (`platform.dashboard.view`, `platform.stores.*`, `platform.users.*`, `platform.reports.view`). Home en `/platform/dashboard`. Puede ver usuarios de todas las tiendas, crear **solo** admins y generar reportes/KPIs multi-tienda. No opera el ERP ni crea otros roles.
- `admin`: acceso total al ERP de **su** tienda (sin permisos `platform.*`).
- `vendedor`: acceso a ventas y datos necesarios para vender.
- `almacen`: acceso a compras, productos e inventario.
- `contador`: acceso a pagos, reportes y lectura contable.

Cada usuario de tienda tiene `profiles.store_id`. Superadmin tiene `store_id = null`.

La fuente de verdad de **definición** de permisos en frontend está en `src/shared/auth/permissions.ts`. La fuente de verdad de **perfil activo** es `GET /api/auth/me` (incluye `storeId`) consumido por `useCurrentUser` en el shell.

Ver también [`multi-store-options.md`](multi-store-options.md).

## Modo demo (solo desarrollo)

Con sesión real, el shell usa el perfil de `/api/auth/me`. Para probar otro rol **sin** login (solo `ALLOW_DEMO_AUTH=true`):

```js
localStorage.setItem("bodega-hub:user-role", "vendedor");
location.reload();
```

Valores válidos:

- `superadmin`
- `admin`
- `vendedor`
- `almacen`
- `contador`

Opcional: `localStorage.setItem("bodega-hub:demo-store-id", "<uuid>")` → header `x-demo-store-id`.

`apiFetch` envía `x-demo-role` y `x-demo-user-id` si existen en `localStorage`. **No usar esto en producción.**

Para volver al acceso completo en demo:

```js
localStorage.setItem("bodega-hub:user-role", "admin");
location.reload();
```

## Flujo de sesión (implementado)

```text
Login (POST /api/auth/login)
  → cookies de sesión Supabase
  → useCurrentUser (GET /api/auth/me)
  → AuthenticatedAppShell (menú + requiredPermission por página)
  → cada page.tsx envuelve con permiso mínimo del módulo
  → API valida requirePermission en cada request (401/403)
  → query-client redirige a /login ante 401
```

| Pieza | Archivo |
|-------|---------|
| Hook login BFF | `src/modules/auth/login/hooks/useLogin.ts` |
| Hook logout | `src/modules/auth/hooks/useLogout.ts` |
| Hook perfil | `src/modules/auth/hooks/useCurrentUser.ts` |
| Shell autenticado | `src/shared/components/AppShell/AuthenticatedAppShell.tsx` |
| Redirect entrada | `src/app/page.tsx` |
| Proxy sesión | `src/proxy.ts` |
| Handler 401 global | `src/lib/query/query-client.ts` |

La tabla de perfiles en Supabase es `profiles` (ver SQL más abajo).

## Matriz de Permisos

| Permiso | Admin | Vendedor | Almacen | Contador |
| --- | --- | --- | --- | --- |
| `dashboard.view` | Si | Si | Si | Si |
| `sales.view` | Si | Si | No | Si |
| `sales.create` | Si | Si | No | No |
| `purchases.view` | Si | No | Si | Si |
| `purchases.create` | Si | No | Si | No |
| `inventory.view` | Si | No | Si | No |
| `inventory.manage` | Si | No | Si | No |
| `products.view` | Si | Si | Si | No |
| `products.manage` | Si | No | Si | No |
| `contacts.view` | Si | Si | No | Si |
| `contacts.manage` | Si | No | No | No |
| `payments.view` | Si | Si | No | Si |
| `payments.manage` | Si | No | No | Si |
| `reports.view` | Si | No | No | Si |
| `settings.view` | Si | No | No | No |
| `users.manage` | Si | No | No | No |

Permisos de plataforma (`platform.dashboard.view`, `platform.stores.*`, `platform.users.*`, `platform.reports.view`): solo `superadmin`. Los roles de tienda no los tienen.

## Permisos Efectivos Por Usuario

El modelo actual es hibrido:

```text
permisos efectivos = permisos del rol + permisos concedidos - permisos bloqueados
```

El rol sigue siendo la plantilla base del usuario, pero un administrador puede registrar excepciones por usuario con:

- `grantedPermissions`: permisos adicionales al rol.
- `deniedPermissions`: permisos bloqueados aunque el rol los tenga.

En modo mock (sin sesión), los endpoints aceptan `x-demo-user-id` para probar excepciones. Ejemplo: `55555555-5555-4555-8555-555555555555` (`vendedor.contactos@example.com`) es rol `vendedor` con `contacts.manage` concedido.

Con sesión iniciada, **siempre** prima el perfil de Supabase; los headers demo en `localStorage` no deben pisar al usuario logueado (p. ej. `vendedor@example.com` aunque antes se eligiera rol demo `admin` en Settings).

## Tabla de Perfiles

Ejecutar en Supabase SQL editor:

```sql
create type public.user_role as enum ('admin', 'vendedor', 'almacen', 'contador');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role public.user_role not null default 'vendedor',
  is_active boolean not null default true,
  granted_permissions jsonb not null default '[]'::jsonb,
  denied_permissions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
```

Para crear el primer administrador, reemplaza los valores por el usuario real:

```sql
insert into public.profiles (id, full_name, role)
values ('USER_UUID', 'Administrador', 'admin');
```

## Funcion SQL Para Reusar Roles En RLS

Para las tablas de negocio y las politicas de administrador conviene centralizar el chequeo:

```sql
create or replace function public.current_user_role()
returns public.user_role
language sql
security definer
set search_path = public
stable
as $$
  select role
  from public.profiles
  where id = auth.uid()
    and is_active = true
$$;
```

## Politicas RLS Base

Estas politicas permiten que cada usuario lea su propio perfil. La gestion de perfiles queda reservada para admins.

```sql
create policy "profiles_select_own"
on public.profiles
for select
to authenticated
using (id = auth.uid());

create policy "profiles_admin_select_all"
on public.profiles
for select
to authenticated
using (public.current_user_role() = 'admin');

create policy "profiles_admin_update"
on public.profiles
for update
to authenticated
using (public.current_user_role() = 'admin')
with check (public.current_user_role() = 'admin');
```

Ejemplo para una tabla `sales`:

```sql
alter table public.sales enable row level security;

create policy "sales_read_by_role"
on public.sales
for select
to authenticated
using (public.current_user_role() in ('admin', 'vendedor', 'contador'));

create policy "sales_insert_by_role"
on public.sales
for insert
to authenticated
with check (public.current_user_role() in ('admin', 'vendedor'));
```

## Flujo en la aplicación

1. Usuario entra en `/` → redirect server a `/login` o `/dashboard` según sesión.
2. Login (`POST /api/auth/login`) → cookies → `useCurrentUser` invalida y carga perfil.
3. `AuthenticatedAppShell` filtra menú con `permissions` efectivos de `/api/auth/me`.
4. Cada `page.tsx` declara `requiredPermission`; componentes usan `Can` / `usePermission` donde aplica.
5. La API valida `requirePermission` + RLS; 401 dispara redirect global en TanStack Query.
6. Logout (`POST /api/auth/logout`) limpia sesión, cache y redirige a `/login`.

En dev con `ALLOW_DEMO_AUTH=true`, sin cookies se puede usar `x-demo-role` (ver sección demo).

El control en UI no reemplaza RLS ni `requirePermission` en el backend.
