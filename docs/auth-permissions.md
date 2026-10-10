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

- `superadmin`: solo backoffice plataforma (`platform.dashboard.view`, `platform.stores.*`, `platform.users.*`, `platform.reports.view`) mas `assistant.use`. Home en `/platform/dashboard`. Puede ver usuarios de todas las tiendas, crear **solo** admins y generar reportes/KPIs multi-tienda. No opera el ERP ni crea otros roles.
- `admin`: acceso total al ERP de **su** tienda (sin permisos `platform.*`), **excepto** venta POS (`sales.create`) y operar caja (`cash.operate`). Puede ver ventas, gestionar cajas/baúl y el resto de módulos. Esos dos permisos se le pueden conceder con el interruptor [«El administrador puede vender»](#el-administrador-puede-vender).
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
| `sales.create` | No (*) | Si | No | No |
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
| `cash.view` | Si | Si | No | Si |
| `cash.operate` | No (*) | Si | No | No |
| `cash.manage` | Si | No | No | No |
| `vault.view` | Si | No | No | Si |
| `vault.manage` | Si | No | No | No |
| `payroll.manage` | Si | No | No | No |
| `payroll.view_own` | No | Si | No | No |
| `reports.view` | Si | No | No | Si |
| `assistant.use` | Si | No | No | No |
| `settings.view` | Si | No | No | No |
| `users.manage` | Si | No | No | No |

(*) Sí cuando la tienda tiene encendido [«El administrador puede vender»](#el-administrador-puede-vender).

Notas de pagos:
- El **vendedor** no tiene `payments.manage`, pero puede **registrar cobros de venta** (POS / `POST /api/payments` con `saleId`) con `sales.create`. No puede pagar compras ni anular pagos.
- **Pagos de compras** (pagos a proveedores, `payments.purchase_id` no nulo): solo los ven **admin y contador**, que son los roles con `payments.view` y `purchases.view` a la vez (`canViewPurchasePayments` en `src/shared/auth/paymentAccess.ts`). Vale en las dos capas: la RLS de `payments` (parche `20261010c-payments-purchase-rls.sql`) devuelve 0 filas a vendedor y almacén aunque consulten PostgREST con su JWT, y el BFF no se los entrega. Los pagos de ventas se siguen leyendo por tienda.
- **Almacén** ve la compra (`purchases.view`) pero no sus pagos: `GET /api/purchases/[id]` le responde `payments: []` y `paidRef` / `paidVes` de la cabecera de la compra (`purchases.paid_ref` / `paid_ves`, que mantiene `register_payment`); el detalle le muestra Pagado / Pendiente y, en el historial, «No tienes permiso para ver los pagos de esta compra». `vault_movements` (asientos `purchase_out` del baúl) queda fuera de esta regla.

Notas de compras:
- **Proveedor de una compra** (COM-F9): `GET /api/purchases/suppliers` se autoriza con `purchases.create` (admin y almacén), no con `contacts.view`, para que almacén pueda elegir proveedor sin leer contactos. Solo entrega `id`, `name`, `taxId` e `isActive` de contactos `proveedor` / `ambos` de la tienda; `/api/contacts` sigue exigiendo `contacts.view`.
- Lee `contacts` con la sesión del usuario: la política «Authenticated users read contacts» (`20260716-multi-store.sql`) solo filtra por tienda, no por rol; quien acota los campos y el tipo es el BFF.

Notas de nomina:
- `payroll.manage` es del dueno: calcular, aprobar, pagar y anular quincenas.
- `payroll.view_own` es del cajero: solo `/payroll/mine`, sus propios recibos y las ventas que le comisionaron. No ve la ganancia bruta ni el semaforo del negocio.
- El **admin no tiene** `payroll.view_own` (esta en `adminBlockedPermissions`): es el dueno, no cobra nomina, y sus retiros ya salen del baul.

Permisos de plataforma (`platform.dashboard.view`, `platform.stores.*`, `platform.users.*`, `platform.reports.view`): solo `superadmin`. Los roles de tienda no los tienen.

`assistant.use` es el unico permiso **transversal**: no lleva prefijo `platform.` y aun asi el `superadmin` lo tiene (se agrega explicitamente en `rolePermissions.superadmin`). Da acceso a `/assistant`: el admin pregunta por su tienda y el superadmin por todas. Como `requirePermission` bloquea al superadmin en permisos sin prefijo `platform.`, la ruta `/api/chat` resuelve su contexto con `resolveAssistantContext` (ver [`modules-catalog.md`](modules-catalog.md#asistente-ia-de-consultas)).

## Permisos Efectivos Por Usuario

El modelo actual es hibrido:

```text
permisos efectivos = permisos del rol + permisos concedidos - permisos bloqueados
```

El rol sigue siendo la plantilla base del usuario, pero un administrador puede registrar excepciones por usuario con:

- `grantedPermissions`: permisos adicionales al rol.
- `deniedPermissions`: permisos bloqueados aunque el rol los tenga.

El rol `admin` **ignora** estas excepciones, con una sola salvedad: `sales.create` y `cash.operate` en `grantedPermissions` (`adminSellPermissions` en `packages/core/src/permissions.ts`). Ningún otro permiso concedido o bloqueado cambia lo que puede hacer un administrador.

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

## Caja y baúl

| Permiso | Vendedor | Contador | Administrador |
| --- | --- | --- | --- |
| `cash.view` | Sí | Sí | Sí |
| `cash.operate` | Sí | No | No (sí con «El administrador puede vender») |
| `cash.manage` | No | No | Sí |
| `vault.view` | No | Sí | Sí |
| `vault.manage` | No | No | Sí |

## El administrador puede vender

Para bodegas de un solo cajero, donde el dueño también atiende la caja (POS-02; cierra R21 / S3 de [`auditoria-producto-2026-10.md`](auditoria-producto-2026-10.md)). Es un interruptor en **Configuración → General / sistema → Ventas del administrador**. Apagado por defecto.

### Qué otorga

Encendido, los administradores de la tienda tienen además `sales.create` y `cash.operate`:

- Ven «Ventas → POS» y «Mi caja» en el menú (el menú filtra por los permisos efectivos de `GET /api/auth/me`).
- Pueden abrir caja, vender, cobrar y cerrar su caja. Para abrir caja hace falta una **caja asignada** (Cajas → asignar al administrador): sin ella el POS muestra el estado «sin caja» de siempre.

### Abrir y cerrar caja: las mismas reglas que el vendedor

`open_cash_session` y `close_cash_session` solo limitan al rol `vendedor` (caja asignada a él; cerrar lo que abrió) y al `admin` le aceptan cualquier caja y cualquier turno. Como las RPC no cambian, el BFF aplica al administrador que opera caja la regla del vendedor (POS-F3):

- **Abrir** (`POST /api/cash/session/open`): solo la caja **asignada a quien la abre** (`cash_registers.assigned_user_id`). La de otro usuario o una sin asignar → 403 «La caja no está asignada al usuario actual.». Cada usuario tiene una sola caja activa asignada (índice `cash_registers_one_active_assignment_per_store_idx`) y cada caja un solo turno abierto, así que hay **un turno abierto por usuario**: con uno propio abierto en otra caja → 409 `CONFLICT` «Ya tienes una caja abierta. Ciérrala antes de abrir otra.». Reabrir la misma caja sigue dando el 400 del RPC. Son dos lecturas en el camino de abrir caja; el cobro no cambia.
- **Cerrar** (`POST /api/cash/session/close`): cada quien cierra **solo el turno que abrió** (`cash_sessions.opened_by`), tenga `cash.operate` o solo `cash.manage`. Uno ajeno → 403; uno inexistente o de otra tienda → 404. Se decide por el `sessionId`, no por «el turno actual».
- **Turnos de otros:** un administrador ya no cierra por esta ruta la caja abierta de un vendedor. Le queda el cierre automático de fin de jornada; `/cash/registers` es de solo lectura.
- **Estado heredado:** si un administrador quedó con varios turnos abiertos antes de esta regla, `GET /api/cash/session` devuelve el más reciente (antes 404) y puede cerrarlos uno a uno, con el interruptor encendido o apagado.
- **Límite conocido:** las comprobaciones de apertura son lecturas previas al RPC, no un candado en la base: dos aperturas simultáneas del mismo administrador sobre dos cajas distintas (solo posible si le reasignan la caja en ese instante) no se excluyen entre sí.

No cambia nada más: nómina (`payroll.view_own` sigue bloqueado para el admin), ni los permisos de los demás roles, ni ninguna RPC. Las RPC de venta y de caja (`create_sale*`, `open_cash_session`, `close_cash_session`) ya aceptaban el rol `admin` en la base; lo que impedía vender al administrador era el permiso en el BFF y en la UI.

### Cómo se guarda

No hay un ajuste de tienda ni SQL nuevo: el estado **son** los `granted_permissions` de los perfiles `admin` de la tienda.

- **Encendido** = todos los administradores **activos** de la tienda tienen los dos permisos concedidos. Si solo los tienen algunos, el interruptor se muestra apagado con el aviso «Solo algunos administradores pueden vender» y se puede igualar en un sentido u otro.
- `PUT /api/settings/admin-can-sell` `{ "enabled": boolean }` concede o retira los dos permisos a **todos** los perfiles `admin` de la tienda (también los inactivos, para que al reactivarlos no desentonen), sin tocar el resto de sus excepciones. Es idempotente. Los administradores con las mismas excepciones se escriben en una sola sentencia (lo habitual); si tienen excepciones distintas hay una sentencia por grupo y, si una falla, basta repetir la operación.
- `GET /api/settings/admin-can-sell` devuelve `{ enabled, admins: [{ id, name, canSell }] }` (solo administradores activos).
- Ambos exigen `users.manage`: solo el admin de **esa** tienda (vendedor, almacén y contador → 403; el superadmin no opera tiendas → 403). La tienda sale de la sesión, nunca del cliente.
- La UI confirma con `ConfirmActionModal`: «Vender en el POS: No → Sí», «Operar caja: No → Sí» y la lista de administradores afectados.

### Administradores nuevos y cambios de rol

- Un administrador **creado** en Configuración (`POST /api/users`) nace con el estado de la tienda.
- Un usuario que **pasa a admin** (`PATCH /api/users/{id}` con `role`) queda como los demás administradores activos: recibe los dos permisos si el interruptor está encendido y los pierde si está apagado.
- Un administrador que **deja de serlo** pierde los dos permisos concedidos (no se quedan colgados en un contador o un almacén). Si pasa a vendedor los conserva por su rol.
- Si el `PATCH` trae `grantedPermissions` explícitos, mandan ellos.
- **No cubierto:** un administrador creado desde el panel de plataforma (superadmin) en una tienda que ya tiene el interruptor encendido nace sin los permisos; la tienda queda en estado parcial hasta que un administrador vuelva a confirmar el interruptor.
- **Migración:** un perfil `admin` que ya tuviera `sales.create` y/o `cash.operate` en `granted_permissions` (antes se ignoraban) pasa a tenerlos efectivos. Conviene revisarlo antes de desplegar:

```sql
select id, full_name, store_id, granted_permissions
from public.profiles
where role = 'admin'
  and (granted_permissions ? 'sales.create' or granted_permissions ? 'cash.operate');
```

### Apagarlo con una caja abierta

Al apagar, el administrador deja de poder vender (`POST /api/sales` → 403) y de abrir un turno nuevo (`POST /api/cash/session/open` → 403) de inmediato. Un turno que ya tuviera abierto **no queda atrapado**:

- `POST /api/cash/session/close` acepta `cash.operate` **o** `cash.manage`, y en ambos casos cierra únicamente un turno **abierto por quien llama** (ver arriba); el de otro usuario → 403. La RPC `close_cash_session` no cambia.
- La confirmación de apagar avisa de las cajas abiertas a nombre de un administrador.
- Como «Mi caja» deja de estar en el menú, la tarjeta del interruptor muestra al administrador «Tienes abierta la caja …» con el botón **Cerrar mi caja** (el mismo diálogo de cierre de siempre).
- Si no la cierra, el cierre automático de fin de jornada sigue aplicando.
