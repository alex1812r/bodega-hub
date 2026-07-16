# BodegaHub

ERP web para ventas, compras, inventario, contactos, pagos y reportes. Stack: Next.js (App Router), Supabase, TanStack Query, Tailwind.

## Empezar

```bash
npm install
npm run dev
```

Abrir [http://localhost:3000](http://localhost:3000). Credenciales de desarrollo: [`docs/dev-seed-users.md`](docs/dev-seed-users.md). Supabase: [`docs/supabase-setup.md`](docs/supabase-setup.md).

## Documentación

Índice: **[`docs/README.md`](docs/README.md)**

| Documento | Uso |
|-----------|-----|
| [`docs/modules-catalog.md`](docs/modules-catalog.md) | Módulos, rutas, hooks, API, tablas |
| [`docs/frontend-api-guide.md`](docs/frontend-api-guide.md) | Conectar UI con `/api` |
| [`docs/mock-api-endpoints.md`](docs/mock-api-endpoints.md) | Contrato de endpoints BFF |
| [`public/openapi.yml`](public/openapi.yml) | OpenAPI (`/api-docs` en dev) |

## Scripts útiles

```bash
npm run typecheck
npm test
npm run e2e:bodegon
```
