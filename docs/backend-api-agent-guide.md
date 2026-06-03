# Backend API Agent Guide

Esta guia es la referencia operativa para cualquier agente o desarrollador que trabaje endpoints backend en `src/app/api`. Swagger/OpenAPI muestra el contrato, pero este documento explica como esta organizada la capa backend, como cambiarla y que documentos mantener sincronizados.

## Fuentes De Verdad

- Contrato visual: `/api-docs`.
- Contrato YAML publico: `/openapi.yml`.
- Contrato servido por API: `GET /api/openapi`.
- Documentacion humana de endpoints: `docs/mock-api-endpoints.md`.
- Checklist funcional: `docs/api-endpoints-checklist.md`.
- Estrategia de integracion Supabase: `docs/server-side-api-strategy.md`.
- Permisos y roles: `docs/auth-permissions.md` y `src/shared/auth/permissions.ts`.
- Datos mock: `src/shared/mocks/erp-data.ts`.
- Catálogo módulos (pantallas, hooks, tablas): `docs/modules-catalog.md`.
- Schema SQL: `supabase/supabase-schema.sql`; auditoria: `docs/supabase-schema-audit.md`.

## Arquitectura Actual

La app usa Route Handlers de Next.js como backend-for-frontend (BFF). Cada endpoint enruta entre servicios mock (tests/dev) y Supabase server-side segun `API_DATA_SOURCE` (`mock` en tests, `supabase` en runtime por defecto).

```text
Cliente UI/Hooks
  -> fetch /api/...
  -> src/app/api/**/route.ts
  -> requirePermission + Zod
  -> resolveDataSource()  |  get*Service() factory
        | mock                          | supabase
        v                               v
  *.mock-server.ts                 *.server.ts
  erp-data.ts                      createRouteSupabaseClient
                                   -> tablas / vistas / RPC
```

Reglas actuales:

- Los handlers deben ser delgados: permisos, validacion, llamada a servicio y respuesta.
- La logica mock vive en `*.mock-server.ts`; la logica real en `*.server.ts`.
- Contactos y supplier-products usan factory en `src/modules/contacts/services/index.ts`.
- Las respuestas exitosas usan `{ data: ... }`.
- Los listados usan paginacion `skip`/`limit` via `paginateList` o `getPaginationRange` + `toPaginatedList`.
- Los errores usan `{ error: { code, message, issues? } }`.
- Las escrituras validan payload con Zod.
- Los permisos se validan con `requirePermission` (sesion Supabase o headers demo en dev).

## Auth Y Permisos

Modos soportados:

- **Produccion / Supabase:** sesion via cookies en Route Handlers (`POST /api/auth/login`, `GET /api/auth/me`). `requirePermission` carga `profiles.role`, `is_active` y overrides desde DB.
- **Dev/test:** headers `x-demo-role` y `x-demo-user-id` cuando `ALLOW_DEMO_AUTH=true`.

Headers demo:

- `x-demo-role`: `admin`, `vendedor`, `almacen`, `contador`.
- `x-demo-user-id`: usa un perfil mock de `mockUserProfiles` y permite probar permisos concedidos/bloqueados por usuario.

Modelo de permisos:

```text
permisos efectivos = permisos del rol + grantedPermissions - deniedPermissions
```

`admin` conserva el catalogo completo de permisos.

## Como Agregar O Cambiar Un Endpoint

1. Crear o modificar el Route Handler en `src/app/api/**/route.ts`.
2. Mantener el handler delgado.
3. Agregar/actualizar el servicio mock en `src/modules/<modulo>/services/*.mock-server.ts`.
4. Si hace falta nueva data, actualizar `src/shared/mocks/erp-data.ts`.
5. Validar permisos con un permiso existente o agregar uno nuevo en `src/shared/auth/permissions.ts`.
6. Validar payload con Zod para `POST`, `PATCH`, `PUT` o `DELETE` con body.
7. Agregar tests del handler con `@jest-environment node`; `src/app/api/api-contract.test.ts` falla si falta el `route.test.ts`.
8. Actualizar la documentacion:
   - `docs/mock-api-endpoints.md`
   - `docs/api-endpoints-checklist.md`
   - `public/openapi.yml`
   - `docs/auth-permissions.md` si cambia permisos/roles
   - `docs/server-side-api-strategy.md` si cambia arquitectura o flujo
9. Ejecutar:

```bash
npm test
npm run typecheck
npm run lint
```

## Convenciones Por Tipo De Endpoint

- `GET`: puede leer query params con `new URL(request.url).searchParams`; los listados deben paginar con `skip` y `limit`.
- `POST`: crear una entidad o ejecutar una accion de dominio.
- `PATCH`: actualizar parcialmente una entidad o cancelar estados.
- `DELETE`: solo para borrado mock o borrado logico documentado.
- Acciones transaccionales futuras deben mapear a RPC real: ventas, compras, pagos, ajustes de stock y cambios de precio.

## Guards De Testing

- `src/app/api/api-contract.test.ts` valida que cada `src/app/api/**/route.ts` tenga `route.test.ts` y que su path este documentado en `public/openapi.yml`.
- `src/shared/api/client-hooks-contract.test.ts` valida que cualquier hook cliente `use*` que haga `fetch` a `/api` tenga test adyacente.
- Si agregas un handler nuevo, primero agrega su test funcional y luego actualiza OpenAPI para que el guard de contrato pase.

## Modulos Cubiertos

Endpoints operativos con switch mock/Supabase: dashboard, productos, categorias, inventario, contactos, ventas, compras, pagos, reportes, tasas, proveedor-producto, settings, users, auth y documentacion.

Servicios `.server.ts` por modulo:

| Modulo | Archivo(s) |
| --- | --- |
| Productos | `products.server.ts`, `categories.server.ts` |
| Contactos | `contacts.server.ts`, `supplierProducts.server.ts` |
| Inventario | `inventory.server.ts` |
| Ventas | `sales.server.ts` |
| Compras | `purchases.server.ts` |
| Pagos | `payments.server.ts` |
| Dashboard | `dashboard.server.ts` |
| Reportes | `reports.server.ts` |
| Settings | `settings.server.ts`, `exchangeRates.server.ts` |

RPC conectados en Supabase: `create_sale`, `create_purchase`, `register_payment`, `adjust_stock`, `update_product_price`, `receive_purchase`, etc.

## Smoke Test Manual

Con el dev server corriendo y `API_DATA_SOURCE=supabase`:

```bash
# Opcional: credenciales de un usuario con perfil activo
export SMOKE_API_EMAIL=admin@example.com
export SMOKE_API_PASSWORD=secret

npx tsx scripts/smoke-api.ts
```

Sin credenciales el script imprime instrucciones (dry-run, exit 0).

## E2E Bodegón (poblado + todos los modulos)

Suite secuencial contra Supabase: catalogo bodegón, compras, ventas, cinco metodos de pago, reportes y permisos por rol.

```bash
npm run dev
npm run e2e:bodegon
```

Ver [`docs/backend-e2e-bodegon.md`](backend-e2e-bodegon.md). Salida: `scripts/e2e-bodegon/manifest.json` y `last-run.json`.

## Frontend (consumir /api)

Guia para pantallas y hooks: [`docs/frontend-api-guide.md`](frontend-api-guide.md).

Importacion masiva de productos (Excel): [`docs/frontend-product-bulk-import.md`](frontend-product-bulk-import.md) — incluye `GET /api/products/import/template`.

## Criterio De Listo

Un cambio backend esta completo solo si:

- el endpoint funciona con mock y con Supabase (o documenta limitacion);
- tiene test;
- esta en OpenAPI;
- esta en `docs/mock-api-endpoints.md`;
- actualiza el checklist;
- mantiene permisos coherentes;
- no importa `browser-client` en `src/app/api/**` ni `*.server.ts`;
- pasa `npm test`, `npm run typecheck` y `npm run lint`.
