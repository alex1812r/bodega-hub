# E2E backend — Bodegón La Esquina

Plan de pruebas **solo backend** (`/api`) contra Supabase real. Tema: bodega de chucherías, refrescos, helados, despensa (arroz, pasta, harina, aceite), snacks y limpieza.

**Mapa de módulos y endpoints:** [`modules-catalog.md`](modules-catalog.md)

## Prerrequisitos

1. Ejecutar [`supabase/supabase-schema.sql`](../supabase/supabase-schema.sql) y [`supabase/seed.sql`](../supabase/seed.sql).
2. [`.env`](../.env) o `.env.local` con:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `API_DATA_SOURCE=supabase`
   - `ALLOW_DEMO_AUTH=true` (opcional en dev)
3. Servidor: `npm run dev`
4. Credenciales seed: ver [`dev-seed-users.md`](dev-seed-users.md) (`Admin123!`).

## Ejecución automatizada

```bash
npm run dev
# otra terminal:
npm run e2e:bodegon
```

Variables opcionales:

```bash
SMOKE_API_BASE_URL=http://localhost:3000
SMOKE_API_EMAIL=admin@example.com
SMOKE_API_PASSWORD=Admin123!
```

Salidas:

- `scripts/e2e-bodegon/manifest.json` — IDs creados (categorías, productos, ventas, etc.)
- `scripts/e2e-bodegon/last-run.json` — log de cada paso + resumen

## Orden de fases (dependencias)

| Fase | Módulo | Rol típico | Depende de |
|------|--------|------------|------------|
| 1 | Auth | admin, vendedor | seed usuarios |
| 2 | Settings, tasas | admin | auth |
| 3 | Categorías (9) | admin | — |
| 4 | Productos (~29) + plantilla import | admin | categorías |
| 5 | Contactos (14) | admin | — |
| 6 | Proveedor-producto (15) | admin | productos + proveedores |
| 7 | Inventario inicial (18 SKUs) | admin | productos |
| 8 | Compras (recibido, pedido, receive, cancel, return) | almacen | stock, contactos |
| 9 | Pagos compra (5 métodos) | contador | compras |
| 10 | Ventas | vendedor | stock, clientes |
| 11 | Pagos venta (5 métodos) | contador | ventas |
| 12 | Cancel / return venta | admin | ventas |
| 13 | Cambio precio + historial | admin | productos |
| 14 | Dashboard + 11 reportes | contador | datos previos |
| 15 | Usuarios / permisos | admin | — |

## Catálogo de datos

Definido en [`scripts/e2e-bodegon/data.ts`](../scripts/e2e-bodegon/data.ts):

- **Categorías:** Chucherías, Refrescos, Helados, Snacks, Despensa (granos / harinas), Lácteos, Limpieza.
- **Productos:** SKUs `BOD-XXX-NNN` (~29 ítems).
- **Proveedores:** 5 distribuidores.
- **Clientes:** 8 + 1 contacto `ambos`.

## Métodos de pago probados

| Método | Compra | Venta | Campos extra |
|--------|--------|-------|----------------|
| `efectivo_ves` | Sí | Sí | `currency: VES` |
| `efectivo_usd` | Sí | Sí | `currency: USD` |
| `pago_movil` | Sí | Sí | `bankName`, `phone`, `referenceCode` (4 dígitos) |
| `transferencia` | Sí | Sí | `bankName`, `referenceCode` |
| `punto_venta` | Sí | Sí | `referenceCode` opcional |

## Pruebas negativas incluidas

- SKU / categoría / `taxId` duplicado → 409
- Stock insuficiente en venta y ajuste → 400
- `pago_movil` sin teléfono → 400
- Vendedor → `POST /api/purchases` → 403
- Almacén → `POST /api/sales` → 403
- Vendedor → `GET /api/users` → 403
- Proveedor inválido en `supplier-products` → error

## Gaps API (no cubiertos)

- `DELETE /api/contacts/[id]` — no existe
- `DELETE /api/supplier-products/[id]` — no existe

## Playbook curl (ejemplo Fase 4)

```bash
# Tras login (guardar cookie en cookies.txt)
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"Admin123!"}' \
  -c cookies.txt

curl -X POST http://localhost:3000/api/products \
  -b cookies.txt -H "Content-Type: application/json" \
  -d '{"sku":"BOD-CHU-001","name":"Chicle Trident menta","salePriceRef":1.2,"currentCostRef":0.7,"minStock":20,"currentStock":0}'
```

## Re-ejecución

Cada corrida usa un sufijo unico (`E2E_RUN_SUFFIX` auto) en SKUs, categorias y taxId para evitar colisiones.

Con `ALLOW_DEMO_AUTH=true` el runner envia `x-demo-role` / `x-demo-user-id` para probar permisos por rol (la API prioriza demo sobre cookies). Para probar solo sesion real, reinicia `npm run dev` con `ALLOW_DEMO_AUTH=false`.

## Notas RLS

Algunos PATCH (notas de venta/pago) pueden requerir rol `admin` si RLS no permite actualizar al `vendedor`/`contador`; el runner reintenta con admin y acepta `404` documentado.

## Referencias

- Guia frontend (consumir estos flujos desde UI): [`frontend-api-guide.md`](frontend-api-guide.md)
- Checklist endpoints: [`api-endpoints-checklist.md`](api-endpoints-checklist.md)
- Smoke mínimo: [`scripts/smoke-api.ts`](../scripts/smoke-api.ts)
- OpenAPI: `/api-docs` o [`public/openapi.yml`](../public/openapi.yml)
