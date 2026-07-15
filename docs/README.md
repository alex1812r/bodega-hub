# Documentación — Control Ventas ERP

Índice de documentación alineada con el código (julio 2026).

## Empezar aquí

| Documento | Para qué sirve |
|-----------|----------------|
| [**modules-catalog.md**](modules-catalog.md) | **Referencia maestra:** todos los módulos, rutas, hooks, endpoints, tablas y pendientes |
| [frontend-api-guide.md](frontend-api-guide.md) | Conectar UI: `apiFetch`, auth, paginación, convenciones TanStack Query |
| [mock-api-endpoints.md](mock-api-endpoints.md) | Contrato humano de cada endpoint, query params y payloads |
| [api-endpoints-checklist.md](api-endpoints-checklist.md) | Checklist de cobertura API vs plan funcional |

## Backend y datos

| Documento | Para qué sirve |
|-----------|----------------|
| [backend-api-agent-guide.md](backend-api-agent-guide.md) | Guía para agentes/dev que extienden `src/app/api` |
| [server-side-api-strategy.md](server-side-api-strategy.md) | Arquitectura BFF, mock/Supabase, RPC |
| [database-design.md](database-design.md) | Modelo relacional, enums, RPC y vistas |
| [supabase-setup.md](supabase-setup.md) | Levantar proyecto Supabase local |
| [supabase-schema-audit.md](supabase-schema-audit.md) | Auditoría SQL vs app |
| [dev-seed-users.md](dev-seed-users.md) | Usuarios y credenciales de prueba |
| [backend-e2e-bodegon.md](backend-e2e-bodegon.md) | Suite E2E `npm run e2e:bodegon` |

## Frontend

| Documento | Para qué sirve |
|-----------|----------------|
| [frontend-integration-checklist.md](frontend-integration-checklist.md) | Estado de integración UI por módulo |
| [frontend-product-bulk-import.md](frontend-product-bulk-import.md) | Importación masiva Excel en `/products/import` |
| [auth-permissions.md](auth-permissions.md) | Roles, permisos, sesión y demo |
| [responsive-ui.md](responsive-ui.md) | Breakpoints, drawer, tablas en tarjetas y formularios |
| [stitch-design-checklist.md](stitch-design-checklist.md) | Checklist UI/UX en Google Stitch (pantallas, modales, pendientes) |
| [stitch-prompts/README.md](stitch-prompts/README.md) | Prompts listos para pegar en Google Stitch (generación y rediseños) |
| [stitch-theming.md](stitch-theming.md) | Tokens BodegaSync (Stitch) vs theming actual y plan de alineación |

## Planificación

| Documento | Para qué sirve |
|-----------|----------------|
| [plan-erp.md](plan-erp.md) | Visión funcional y objetivos del producto |
| [web-app-build-checklist.md](web-app-build-checklist.md) | Plan histórico de construcción (MVP ya hecho) |
| [multi-store-options.md](multi-store-options.md) | Opciones para múltiples negocios/tiendas (sin membresías; exploración) |

## Contrato machine-readable

- OpenAPI: [public/openapi.yml](../public/openapi.yml)
- UI: `/api-docs` en dev

## Estructura de código

```text
src/app/          → rutas App Router + Route Handlers /api
src/modules/      → dominios (screaming: carpeta por pantalla)
src/shared/       → componentes, apiFetch, permisos
supabase/         → supabase-schema.sql, seed.sql
```
