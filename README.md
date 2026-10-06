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
npm run assistant:eval   # banco de preguntas del asistente IA contra /api/chat
```

### Laboratorio de inventario (`stock-lab:*`)

Base Supabase local en Docker, agentes operadores y oráculo de inventario. Nada de esto toca producción salvo el informe de solo lectura. Guía: [`docs/stock-integrity.md`](docs/stock-integrity.md) y [`docs/stock-lab.md`](docs/stock-lab.md).

| Script | Qué hace |
|--------|----------|
| `npm run stock-lab:db-up` | Levanta el Supabase local y aplica esquema + parches + seed + `verify-patches` |
| `npm run stock-lab:db-reset` | Vacía la base local y reaplica todo |
| `npm run stock-lab:db-down` | Apaga el Supabase local (conserva el volumen) |
| `npm run stock-lab:seed` | Crea o recrea la tienda `lab` con usuarios, catálogo y stock inicial |
| `npm run stock-lab:dev` | BFF en `http://localhost:3100` contra la base local (`next dev`) |
| `npm run stock-lab:start` | Igual, en modo producción (`next build` + `next start`; `-- --no-build` reutiliza el build) |
| `npm run stock-lab:run` | Agentes operadores + reconcile + `summary.md` (`-- --agents 5 --minutes 10 --seed 42` o `-- --serial --ops 200 --seed 42`) |
| `npm run stock-lab:scenarios` | Matriz serial, hipótesis y réplicas de one-shots (`-- --suite serial\|oneshots\|hypotheses\|all`) |
| `npm run stock-lab:ui` | Flujos de UI con Playwright comparados contra la base |
| `npm run stock-lab:chaos` | Casos de caos con oráculo SQL (`-- --all` o `-- --case 9.1`) |
| `npm run stock-lab:load` | Carga a ritmo constante con percentiles de latencia (`-- --ops 1000 --seconds 120`) |
| `npm run stock-lab:test` | Suite de regresión contra la base local |
| `npm run stock-lab:reconcile` | Oráculo de las nueve vistas de integridad; `-- --target production --read-only` genera el informe de producción sin escribir |
