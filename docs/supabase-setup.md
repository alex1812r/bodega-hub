# Supabase setup — BodegaHub

Guia minima para levantar la base de datos de desarrollo y probar auth real contra `/api/auth/*`.

## 1. Crear proyecto Supabase

1. Crea un proyecto en [Supabase Dashboard](https://supabase.com/dashboard).
2. Copia `.env.local.example` a `.env.local` y completa:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (solo servidor, nunca en el cliente)
3. Opcional en dev local:
   - `API_DATA_SOURCE=supabase`
   - `ALLOW_DEMO_AUTH=true` (habilita `x-demo-role` en tests y dev)

## 2. Aplicar schema

En **SQL Editor** del dashboard, ejecuta el contenido completo de:

```text
supabase/supabase-schema.sql
```

No hay carpeta `supabase/migrations`; el schema es un archivo monolítico. Ver [`database-design.md`](database-design.md) y [`modules-catalog.md`](modules-catalog.md).

Verifica que existan tablas `profiles`, `app_settings`, RPC (`create_sale`, etc.) y politicas RLS.

## 2.1 Aplicar patches pendientes (obligatorio si el proyecto ya tenia schema)

Si el proyecto **ya** ejecuto `supabase-schema.sql` antes y luego el codigo agrego features, aplica los patches incrementales.

**Forma recomendada (todo junto):**

1. Abre [Supabase Dashboard](https://supabase.com/dashboard) → tu proyecto → **SQL Editor**.
2. Pega el contenido de [`supabase/patches/apply-all-pending.sql`](../supabase/patches/apply-all-pending.sql).
3. **Run**.
4. Pega [`supabase/patches/verify-patches.sql`](../supabase/patches/verify-patches.sql) y confirma que todas las filas tienen `ok = true`.

Orden individual (si prefieres uno por uno):

| Orden | Archivo | Que agrega |
|-------|---------|------------|
| 1 | `20260705-supplier-product-pack-cost.sql` | `last_pack_cost_ref` + RPC precio empaque |
| 2 | `20260706-product-barcode.sql` | `products.barcode` + indice unico |
| 3 | `20260707-product-images-storage.sql` | bucket `product-images` + policy lectura |
| 4a | `20260716a-user-role-superadmin.sql` | Enum `user_role.superadmin` (**corrida aparte**) |
| 4b | `20260716-multi-store.sql` | `stores`, `store_id`, RLS por tienda |
| 4c | `20260716b-multi-store-views.sql` | Vistas con `store_id` (dashboard/reportes) |
| 4d | `20260716c-seed-superadmin.sql` | Usuario `superadmin@example.com` (admin/vendedor intactos) |
| 5 | `20260717-enabled-payment-methods.sql` | Metodos de pago habilitados por tienda |
| 6 | `20260809-category-tax-rate.sql` | `categories.tax_rate` |
| 7 | `20260810-rpc-store-context.sql` | RPCs de compra/venta/pago con `store_id` |
| 8 | `20260810b-purchase-ves-fields.sql` | VES + tax snapshot en compras |
| 9 | `20260810c-purchase-trust-frontend.sql` | `create_purchase` confia REF+VES del frontend |
| 10 | `20260810d-purchase-paid-ref.sql` | `purchases.paid_ref` + saldo pendiente en REF |
| 10b | `20260810d-fix-existing-purchase-payment.sql` | One-shot: ajusta pago parcial existente (opcional) |
| 11a | `20260811a-stock-movement-conversion-enum.sql` | Enum `conversion_salida` / `conversion_entrada` (**corrida aparte**) |
| 11 | `20260811-pack-unit-conversion.sql` | Dual SKU pack→unidad: vínculo + RPC `convert_pack_to_units` |
| 12 | `20260811b-cash-registers-vault.sql` | Cajas, sesiones, baúl, RPC open/close/transfer/deposit + pagos efectivo |
| 13 | `20260811c-transfer-closures-to-vault.sql` | Transferencia al baúl por cierres pendientes (`vault_transferred_at`) |
| 14 | `20260811d-absorb-closures-on-reopen.sql` | Absorbe cierres pendientes al reabrir caja (`absorbed_by_session_id`) |
| 15 | `20260812-one-shot-backfill-vault-informal-purchase.sql` | One-shot: depósito+egreso baúl compra informal `C-20260810204259934` (opcional; ya aplicado en prod si corriste el backfill) |
| 16 | `20260812b-one-shot-backfill-vault-market-catia-purchase.sql` | One-shot: depósito+egreso baúl ligados al pago `punto_venta` existente de `C-20260810155452483` (sin crear pago nuevo) |
| 17 | `20260812c-vault-efectivo-vs-cuenta.sql` | Separa `balance_efectivo_ves` vs `balance_ves` (cuenta); PM/transfer/punto en caja `account_in` |
| 18 | `20260812d-pos-default-customer.sql` | Cliente sistema `Consumidor final` (`is_pos_default`) por tienda para ventas rapidas en POS |
| 19 | `20260813-add-product-barcode.sql` | RPC `add_product_barcode`: vendedor/cajero puede asignar barcode solo si el producto no tiene |
| 20 | `20260813b-product-cost-with-line-tax.sql` | Al comprar/recibir, `products.current_cost_ref` = unitario × (1 + tax_rate de la linea); exento queda neto |
| 21 | `20260813c-one-shot-backfill-product-cost-with-line-tax.sql` | One-shot: recalcula `current_cost_ref` (y `supplier_products.last_cost_*`) desde la ultima compra recibida |
| 22 | `20260813d-one-shot-split-jabo-harm-variants.sql` | One-shot: split `jabo-harm` → `jabo-harm-1/2/3` (24 stock c/u) y desactiva el original |
| 23 | `20260813e-one-shot-fix-shampoo-pack-qty.sql` | One-shot: `sham-sobr-head-shou` en `C-20260810155452483` → 3×12=36 u, **mismo costo total**, baja unitario; ajusta stock |
| 24 | `20260813f-one-shot-transfer-shampoo-suav-mane-ro.sql` | One-shot: transfiere 12 u `sham-sobr-head-shou-18ml` → `sham-sobr-head-shou-suav-mane-ro` (mismo precio/costo) |
| 25 | `20260813g-one-shot-backfill-vault-mercaseu-purchase.sql` | One-shot: depósito efectivo + pago + `purchase_out` baúl para `C-20260814011924874` (Mercaseu) |
| 26 | `20260813h-fix-adjust-stock-store-id.sql` | Fix RPC `adjust_stock`: setea `store_id` en `stock_movements` + contexto de tienda |
| 27 | `20260815-one-shot-backfill-vault-mercaseu-C-20260814214845696.sql` | One-shot: depósito efectivo + pago + `purchase_out` baúl para `C-20260814214845696` (Mercaseu) |
| 28 | `20260815b-one-shot-backfill-vault-delilicor-purchase.sql` | One-shot: depósito efectivo + pago + `purchase_out` baúl para `C-20260815204121850` (Delilicor) |
| 29 | `20260815c-one-shot-transfer-malta-manz-verd.sql` | One-shot: transfiere 6 u `mal-port-175-lt` → `mal-port-manz-verd-1-75lt` (mismo precio/costo) |

**Importante:** el patch 4b/4c **no** están embebidos en `apply-all-pending.sql`. Ejecuta **4a → 4b → 4c** en Runs separados del SQL Editor (PostgreSQL no permite usar un enum nuevo en la misma transacción donde se agregó).

Los patches son **idempotentes** (se pueden re-ejecutar). Requieren que el schema base y RPCs auxiliares (`append_supplier_product_price_history`, `current_user_role`) ya existan.

Si tu URL `NEXT_PUBLIC_SUPABASE_URL` no resuelve o el proyecto esta paused/deleted, reactivalo o actualiza `.env` antes de seguir.

### 2.2 Smoke test post-patches

Con la app en `npm run dev` y patches aplicados:

```bash
npm run smoke:patches
```

Cubre por API: login, create/lookup barcode, signed upload URL de imagen, reactivar producto/categoría, listado supplier-products (campo pack). Resultado en `scripts/smoke-post-patches-last-run.json` (gitignored).

**Checklist UI manual** (el script no cubre crop/canvas):

1. **Barcode** — Productos → crear/editar con código de barras → en POS o compras, escanear/Enter y que agregue al carrito.
2. **Imagen** — Formulario producto → subir imagen → crop 4:3 → opcional “quitar fondo” → guardar y ver preview en detalle.
3. **Empaque / pack cost** — Contacto proveedor → producto proveedor → registrar precio de empaque (o compra con pack) y confirmar que aparece en UI.

## 3. Ejecutar seed

Ejecuta en el mismo SQL Editor:

```text
supabase/seed.sql
```

Esto crea usuarios Auth, filas en `profiles`, `app_settings`, una categoria y una tasa de cambio con UUID fijos.

**Password de todos los usuarios seed:** `Admin123!`

Referencia completa (credenciales, roles y permisos): [`dev-seed-users.md`](dev-seed-users.md).

| Rol       | Email                  | UUID                                   |
| --------- | ---------------------- | -------------------------------------- |
| admin     | admin@example.com      | `11111111-1111-4111-8111-111111111111` |
| vendedor  | vendedor@example.com   | `22222222-2222-4222-8222-222222222222` |
| vendedor + contactos | vendedor.contactos@example.com | `55555555-5555-4555-8555-555555555555` |
| almacen   | almacen@example.com    | `33333333-3333-4333-8333-333333333333` |
| contador  | contador@example.com   | `44444444-4444-4444-8444-444444444444` |

## 4. Probar auth real

Con la app en dev (`npm run dev`):

```bash
# Login (cookies se guardan en el cliente)
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"Admin123!"}' \
  -c cookies.txt

# Perfil autenticado
curl http://localhost:3000/api/auth/me -b cookies.txt

# Logout
curl -X POST http://localhost:3000/api/auth/logout -b cookies.txt
```

Respuesta esperada de `/api/auth/me`: `{ data: { user, role, permissions, grantedPermissions, deniedPermissions, ... } }`.

## 5. Tests unitarios

Los tests Jest usan por defecto:

- `API_DATA_SOURCE=mock` (via `NODE_ENV=test`)
- `ALLOW_DEMO_AUTH=true` para headers `x-demo-role` / `x-demo-user-id`

No necesitas Supabase corriendo para `npm test` salvo pruebas de integracion manuales.

## 6. Vaciar datos (conservar usuarios y categorías)

Para borrar productos, contactos, ventas, compras y demás datos operativos **sin tocar usuarios** (`auth.users`, `profiles`) **ni categorías**, ejecuta en el SQL Editor:

```text
supabase/reset-data.sql
```

Opcional: ejecutar de nuevo la parte de `app_settings` y tasa BCV en `supabase/seed.sql` (los usuarios usan `on conflict do nothing`).

## 7. Catálogo de investigación de campo (jul/2026)

Proveedores, productos y vínculos con precios de cotización anotados en campo:

```text
supabase/seed-field-research-jul2026.sql
```

Incluye **Bodega de bebida** (6 bebidas) y **Tienda Congolos** (6 chucherías), categorías `Bebidas` / `Chucherias`, SKU derivados del nombre (ej. `glup-2lt`), empaques predeterminados (caja 6 / paquete 12) y costo unitario calculado del precio por empaque.

Alternativa vía API (con `npm run dev` y `.env.local`):

```bash
npx tsx scripts/seed-field-research/run.ts
```

## 8. Produccion

- `API_DATA_SOURCE=supabase`
- `ALLOW_DEMO_AUTH=false` (obligatorio)
- No commitear `.env` ni claves reales.

## 12. Caja y baúl

Aplica `supabase/patches/20260811b-cash-registers-vault.sql`, luego
`20260811c-transfer-closures-to-vault.sql` y
`20260811d-absorb-closures-on-reopen.sql` después de las patches de multitienda
y pagos. Crea las tablas de cajas, sesiones, movimientos de caja y baúl, junto
con las RPC de apertura, cierre, depósito, retiro y transferencia de **cierres
pendientes** al baúl. Al reabrir una caja, los cierres no transferidos de esa
caja se marcan absorbidos (`absorbed_by_session_id`) para no duplicar efectivo.

Tope de jornada: aplica `supabase/patches/20260819-cash-session-auto-close.sql`.
Las sesiones abiertas se cierran solas al cruzar medianoche Caracas o 24 h
(lo que ocurra primero), con el efectivo teórico. Configura `CRON_SECRET` y un
cron externo (GitHub Actions recomendado) hacia `/api/cron/cash-sessions/auto-close`.
Ver guía: [`cash-auto-close-github-actions.md`](cash-auto-close-github-actions.md).

## 13. Base de prueba local (stock-lab: db-up)

Receta reproducible para levantar, en Docker, una base **igual a producción**
(schema + todos los parches estructurales + seed) sin tocar ningún proyecto
remoto. Es la base que usa `docs/agent-prompts/stock-integrity-gtm.md`.

### Requisitos

- Docker Desktop corriendo.
- `npm install` (la CLI de Supabase y `@types/pg` son devDependencies; se usa
  `npx supabase`, el binario de `node_modules`).
- `.env.stock-lab` en la raíz (copiar de `.env.stock-lab.example`). `db-up`
  solo conecta a `STOCK_LAB_DB_URL` y aborta con exit 1 si su host no coincide
  con `STOCK_TEST_ALLOW_WRITES_HOST` o si esa variable está vacía (regla 1.4).
  Precedencia: `process.env` > `.env.stock-lab` > `.env.stock-lab.example`.
  Nunca lee el `.env` de producción.

### Comandos

| npm | Qué hace |
|-----|----------|
| `npm run stock-lab:db-up` | `supabase init` (si falta `supabase/config.toml`) + `supabase start` + pipeline SQL + `verify-patches.sql` |
| `npm run stock-lab:db-down` | `supabase stop` (conserva el volumen) |
| `npm run stock-lab:db-reset` | `supabase start` + `supabase db reset --local --no-seed` (vacía la base sin reiniciar contenedores) + pipeline SQL |

`scripts/stock-lab/db-up.{sh,ps1}`, `db-down.*` y `db-reset.*` son wrappers de
`npx tsx scripts/stock-lab/db-up.ts [up|down|reset]`; toda la lógica vive en el
`.ts` y la selección/orden de parches en `scripts/stock-lab/pipeline.ts`
(testeado en `pipeline.test.ts`).

`config.toml` versionado: `project_id = "control-ventas-stock-lab"`,
`db.seed`, `studio`, `analytics` y `edge_runtime` apagados; auth, rest, storage
y realtime quedan activos. **Puertos `1432x`** (api 14321, db 14322, shadow
14320, mailpit 14324) en lugar de los `5432x` por defecto: en Windows esos
caen dentro del rango dinámico (49152+) donde Hyper-V/WinNAT reserva bloques y
Docker no puede publicarlos (`bind: An attempt was made to access a socket in
a way forbidden by its access permissions`). `db-up` reescribe el `config.toml`
con estos valores si cambian (función `applyStockLabConfig`).

### Orden real aplicado

Cada archivo se ejecuta como una sola `query` multi-statement con `pg`:

1. `supabase/supabase-schema.sql` — **solo si la base está vacía**
   (`to_regclass('public.profiles') is null`). Sobre una base ya parcheada no es
   re-aplicable (las vistas con `store_id` no se pueden "replace" sin
   `store_id`); para partir de cero usa `db-reset`.
2. `supabase/patches/*.sql` estructurales, ordenados por nombre, con dos
   overrides porque el sufijo `a` ordena DESPUÉS del archivo base pero esos
   parches agregan valores de enum que el principal usa (PostgreSQL 55P04):
   - `20260716a-user-role-superadmin.sql` antes de `20260716-multi-store.sql`
     (y luego `20260716b-multi-store-views.sql`).
   - `20260811a-stock-movement-conversion-enum.sql` antes de
     `20260811-pack-unit-conversion.sql`.
3. `supabase/seed.sql`.
4. `supabase/patches/20260716c-seed-superadmin.sql`.
5. `supabase/patches/verify-patches.sql`: imprime `ok=N fail=M` y lista las
   filas en `false`; si hay alguna termina con exit 1 **después** del resumen.

Parches aplicados (34): 20260705, 20260706, 20260707, 20260716a, 20260716,
20260716b, 20260717, 20260809, 20260810, 20260810b, 20260810c, 20260810d,
20260811a, 20260811, 20260811b, 20260811c, 20260811d, 20260812c, 20260812d,
20260813, 20260813b, 20260813h, 20260819, 20260903, 20260904, 20260904b,
20260904c, 20260905, 20260906, 20260906b, 20260906c, 20260907, 20260909,
20261005.

### Invariantes de inventario

`20261005-stock-integrity-views.sql` crea nueve vistas (`stock_reconciliation`,
`stock_chain_breaks`, `sales_without_movements`, `purchases_without_movements`,
`movements_without_document`, `reversal_mismatches`, `conversion_mismatches`,
`negative_stock`, `cross_store_movements`), todas con `store_id` y una fila por
descuadre, y el oráculo `select public.stock_integrity_report()` (o
`stock_integrity_report('<store uuid>')`), que devuelve un jsonb con el conteo
de cada vista: si las nueve claves están en 0 el inventario cuadra. Para ver el
detalle: `select * from public.stock_reconciliation where store_id = '<uuid>'`.
Las vistas usan `security_invoker` (aplican las RLS); la función es
`security definer` y fuerza la tienda del usuario si no es superadmin.

Test de inyección de descuadres (`scripts/stock-lab/reconcile.test.ts`): con la
base arriba (`npm run stock-lab:db-up`) correr `npx jest scripts/stock-lab/reconcile.test.ts`;
crea una tienda `lab-test-<random>` dentro de una transacción con rollback (nada
persiste), inyecta descuadres y afirma el oráculo y las vistas con valores exactos.
Sin base, o sin el parche aplicado, los tests quedan `skipped` con un aviso en consola.

### Parches excluidos y por qué

- Por nombre: `*one-shot*`, `*query*`, `*diagnostic*`, `apply-all-pending.sql`
  (agregador), `verify-patches.sql` (se corre al final), `20260716c` (va tras
  el seed).
- Por contenido (`DATA_ONLY_PATCHES` en `pipeline.ts`): parecen estructurales
  por nombre pero corrigen filas concretas de producción (ids hardcoded):
  `20260810d-fix-existing-purchase-payment`, `20260819b-fix-cash-close-cab7b096`,
  `20260901b/c/d-transfer-*`, `20260902-fix-vault-inflacion-efectivo`.

### Qué falló al construirlo y cómo se resolvió

- `supabase-schema.sql` fallaba en un proyecto nuevo con `column "store_id"
  does not exist`: las vistas de reportes se habían actualizado al estado
  multitienda pero las tablas base no tienen `store_id`. Se quitó `store_id` de
  esas vistas en el schema (vuelven al estado base); `20260716b` las recrea con
  `store_id` (drop + create). Es la única edición a un archivo SQL histórico.
- `apply-all-pending.sql` no decía que `20260716a` va antes de `20260716`; se
  corrigió el comentario.
- Puertos `5432x` reservados por Hyper-V en Windows → `1432x` (ver arriba).

### Tiempos medidos (Windows 11, Docker Desktop, 2026-10-05)

- Primera descarga de imágenes Docker (postgres 17, kong, gotrue, postgrest,
  realtime, storage, mailpit, imgproxy): ~15 min, una sola vez; no cuenta.
- `db-up` con la base ya arrancada: **~21 s** (de los cuales ~15 s es el
  health check de `supabase start`; el SQL tarda ~1.5 s).
- `db-reset` completo: **66–127 s** (`supabase db reset` reinicia los servicios
  dependientes). Objetivo < 3 min cumplido.

Resultado: `verify-patches.sql ok=33 fail=0`, `stores=1`, `products=0` (el seed
base no trae productos; los crea `seed-lab`), `create_sale_with_payments=yes`.
