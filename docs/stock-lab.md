# Laboratorio de stock (`scripts/stock-lab/`)

Herramientas del plan stock-integrity para ejercitar el stock contra una base
Supabase LOCAL. Nada de aquí toca producción: todo lee `.env.stock-lab`
(`loadStockLabEnv`) y aborta si el host no coincide con
`STOCK_TEST_ALLOW_WRITES_HOST` (`assertAllowedWriteHost`).

| Script | Qué hace |
|---|---|
| `npm run stock-lab:db-up` / `db-reset` / `db-down` | Levanta, reinicia o apaga el Supabase local y aplica schema + parches. |
| `npm run stock-lab:dev` | Arranca el BFF en `http://localhost:3100` contra la base local. |
| `npm run stock-lab:seed` | Crea (o recrea) la tienda `lab` con usuarios, catálogo y stock inicial. |

## Seed de la tienda lab

`npm run stock-lab:seed` (= `npx tsx scripts/stock-lab/seed-lab.ts`) deja una
tienda `stores.slug = 'lab'` ("Laboratorio Stock") lista para los agentes de la
fase 3 (`.notes/stock-integrity-gtm/phase3-contracts.md`).

### Qué crea

- Tienda `lab` activa y su fila de `app_settings` (mismos valores que `createStore`).
- 5 usuarios (Supabase Auth + `profiles` en la tienda lab), clave única **`Lab2026!`**:

| email | rol |
|---|---|
| `lab-admin@lab.local` | admin |
| `lab-vendedor-1@lab.local` | vendedor |
| `lab-vendedor-2@lab.local` | vendedor |
| `lab-almacen@lab.local` | almacen |
| `lab-contador@lab.local` | contador |

- 6 categorías: 3 con `tax_rate` 16 y 3 con 0 (hay productos con y sin IVA).
- 40 productos con SKU determinista (22 con barcode EAN-13 único, el resto sin):
  - `LAB-HOT-01..05`: activos, sin empaque, stock inicial 500..1000 (los "calientes" compartidos por los agentes).
  - `LAB-PACK-0n` / `LAB-UNIT-0n`: 5 pares en `product_pack_conversions` con `units_per_pack` 6, 12, 24, 6, 12.
  - `LAB-INACT-01..03`: `is_active = false` (con stock 10/20/30).
  - `LAB-ZERO-01..02`: quedan en stock 0 (no se llama al RPC).
  - `LAB-MIN-01..02`: `min_stock` 500 con stock 20.
  - `LAB-001..018`: genéricos.
- 3 proveedores (`contacts.type = 'proveedor'`) con 8 `supplier_products` cada uno y 3 `supplier_product_pack_units` por proveedor.
- 5 clientes `Cliente Lab 1..5` + "Consumidor final" con `is_pos_default = true`.
- 2 cajas: `Caja Lab 1` asignada a lab-vendedor-1 y `Caja Lab 2` a lab-vendedor-2.
- 1 tasa de cambio vigente (`rate_ves` 52, `source` Manual).

El stock inicial se carga **solo por el camino real**: el script inicia sesión
como `lab-admin` con la anon key y llama al RPC `adjust_stock(p_product_id,
p_quantity_delta, 'Inventario inicial lab', 'inventario_inicial')` por cada
producto con stock > 0 (38). Los productos se insertan con `current_stock = 0` y
nunca se hace `update products set current_stock`. Al final verifica por SQL que
los movimientos `inventario_inicial` de la tienda coinciden con los productos
con stock > 0; si no, termina con exit 1.

### Cómo correrlo

```bash
npm run stock-lab:db-up      # Supabase local arriba (una vez)
cp .env.stock-lab.example .env.stock-lab   # si aún no existe
npm run stock-lab:seed
```

Imprime un resumen con una línea por entidad (productos, inactivos, stock 0,
pares, usuarios, cajas, proveedores, clientes, categorías, movimientos
`inventario_inicial`).

### Idempotencia y seguridad

- Es idempotente: si la tienda `lab` ya existe, borra todo lo suyo (tablas con
  `store_id` en orden de FK, `profiles` y sus `auth.users`) y la recrea desde
  cero. La tienda `default` y sus usuarios no se tocan.
- Solo local: lee `.env.stock-lab` (nunca `.env`/`.env.local`) y aborta con
  exit 1 si `NEXT_PUBLIC_SUPABASE_URL` o `STOCK_LAB_DB_URL` no apuntan a
  `STOCK_TEST_ALLOW_WRITES_HOST`.
- El plan del catálogo es puro (`buildLabCatalog()`) y está cubierto por
  `scripts/stock-lab/seed-lab.test.ts`.
