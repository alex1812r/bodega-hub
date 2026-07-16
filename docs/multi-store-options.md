# Multitienda (modelo vigente)

Documento de producto e implementación (julio 2026). Reemplaza el enfoque exploratorio anterior (owner + selector de negocio sin membresías).

## Modelo acordado

| Actor | Comportamiento |
|-------|----------------|
| **Superadmin** | Solo backoffice plataforma: dashboard multi-tienda, crear/pausar/activar tiendas, ver todos los usuarios (tienda, rol, detalle), crear **solo** admins de tienda y generar **reportes** por una/varias/todas las tiendas. **No** opera el ERP ni crea vendedor/almacen/contador (v1). |
| **Admin de tienda** | Gestiona usuarios (roles operativos), ventas, stock, etc. de **su** tienda. |
| **Login** | Email/password → entrada directa a la tienda del `profiles.store_id`. Sin selector. Superadmin → `/platform/dashboard`. |

Reglas:

- Toda tienda debe tener **≥ 1** admin al crearse.
- Un usuario de tienda pertenece a **exactamente una** tienda (`profiles.store_id`).
- Superadmin tiene `profiles.store_id = null` y rol `superadmin`.

## Datos

- Tabla `stores` (`name`, `slug` único interno, `status` active|paused, `notes`).
- `store_id` en: categories, products, contacts, sales, purchases, payments, stock_movements, supplier_products, exchange_rates, app_settings.
- Uniques compuestos por tienda (SKU, factura, etc.).
- Migración: tienda default `00000000-0000-4000-8000-000000000001` (`slug = default`) + backfill.

Patch: [`supabase/patches/20260716-multi-store.sql`](../supabase/patches/20260716-multi-store.sql).

## Seguridad API

1. `requirePermission` — permisos de módulo; superadmin **solo** `platform.dashboard.view`, `platform.stores.*`, `platform.users.*` y `platform.reports.view`.
2. `requireStorePermission` — exige `storeId` y **bloquea** superadmin en endpoints ERP.
3. Servicios filtran por `store_id`; get/update con recurso de otra tienda → **403**.
4. RLS: `store_id = current_user_store_id()`; tabla `stores` solo superadmin.
5. RPCs security definer: `assert_store_context()` (mínimo en `adjust_stock`; ampliar en siguientes patches).

## UI plataforma (Stitch)

| Pantalla | Ruta |
|----------|------|
| Inicio (dashboard multi-tienda) | `/platform/dashboard` |
| Gestión de Tiendas | `/platform/stores` |
| Crear Nueva Tienda (página completa) | `/platform/stores/new` |
| Detalle de Tienda | `/platform/stores/[id]` |
| Usuarios (todas las tiendas) | `/platform/users` |
| Detalle de usuario | `/platform/users/[id]` |
| Nuevo admin de tienda | `/platform/users/new-admin` |
| Reportes multi-tienda | `/platform/reports` |

Módulo: `src/modules/platform/`. APIs: `/api/platform/home/*`, `/api/platform/stores`, `/api/platform/users`, `/api/platform/reports/[report]`.

`POST /api/platform/users` crea **solo** rol `admin` para una tienda existente. No acepta otros roles.

Dashboard y reportes plataforma: query `storeScope=all|one|selected` y `storeIds` (CSV). Usa service role en Supabase.

## Fuera de v1

- Impersonación / operar ERP como superadmin
- Selector de tienda post-login
- URLs públicas por slug
- Asignar admin existente / multi-membresía
- Config global de plataforma
- Comparativa side-by-side tienda vs tienda en dashboard

## Smoke aislamiento (mock)

```bash
# Terminal con API_DATA_SOURCE=mock ALLOW_DEMO_AUTH=true
npx jest src/lib/api/storeAccess.test.ts src/app/api/platform/stores src/app/api/platform/users src/app/api/platform/reports src/app/api/platform/home --no-coverage
```

Manual:

1. Demo role `superadmin` → `/platform/dashboard` (home) → filtro todas/una/seleccionadas.
2. Superadmin → `/platform/stores` → crear tienda B con admin.
3. Superadmin → `/platform/users` → ver usuarios cross-tienda y crear otro admin.
4. Superadmin → `/platform/reports` → todas / una / seleccionadas.
5. Demo role `admin` + store default → listar productos (solo tienda default).
6. Superadmin no debe poder `GET /api/products` (403).
