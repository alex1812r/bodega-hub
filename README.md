# Control Ventas ERP

ERP web para ventas, compras, inventario, contactos, pagos y reportes. Stack: Next.js (App Router), Supabase, TanStack Query, Tailwind.

## Empezar

```bash
npm install
npm run dev
```

Abrir [http://localhost:3000](http://localhost:3000). Credenciales de desarrollo: [`docs/dev-seed-users.md`](docs/dev-seed-users.md). Supabase local: [`docs/supabase-setup.md`](docs/supabase-setup.md).

## Documentación

Índice completo: **[`docs/README.md`](docs/README.md)**

| Documento | Uso |
|-----------|-----|
| [`docs/modules-catalog.md`](docs/modules-catalog.md) | Referencia maestra: módulos, rutas, hooks, API, tablas |
| [`docs/frontend-api-guide.md`](docs/frontend-api-guide.md) | Conectar UI con `/api` |
| [`docs/frontend-integration-checklist.md`](docs/frontend-integration-checklist.md) | Estado de integración por módulo |
| [`docs/mock-api-endpoints.md`](docs/mock-api-endpoints.md) | Contrato de endpoints BFF |
| [`public/openapi.yml`](public/openapi.yml) | OpenAPI (`/api-docs` en dev) |

## Scripts útiles

```bash
npm run typecheck
npm test
npm run e2e:bodegon   # suite E2E manual (ver docs/backend-e2e-bodegon.md)
```
