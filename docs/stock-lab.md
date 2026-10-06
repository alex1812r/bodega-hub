Herramientas del plan stock-integrity para ejercitar el stock contra una base
Supabase LOCAL. Nada de aquí toca producción: todo lee `.env.stock-lab`
(`loadStockLabEnv`) y aborta si el host no coincide con
`STOCK_TEST_ALLOW_WRITES_HOST` (`assertAllowedWriteHost`).

| Script | Qué hace |
|---|---|
| `npm run stock-lab:db-up` / `db-reset` / `db-down` | Levanta, reinicia o apaga el Supabase local y aplica schema + parches. |
| `npm run stock-lab:dev` | Arranca el BFF en `http://localhost:3100` contra la base local. |
| `npm run stock-lab:seed` | Crea (o recrea) la tienda `lab` con usuarios, catálogo y stock inicial. |
| `npm run stock-lab:run` | Lanza los agentes operadores (paralelo o serial), reconcile y `summary.md`. |

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
## Agentes

Cada agente es un proceso independiente en `scripts/stock-lab/agents/<nombre>.ts`
que exporta `setup(ctx)`, `step(ctx)` y `teardown(ctx)` (`AgentContext` de
`base.ts`) y acepta `--run <id> --seed <n> (--minutes <m> | --ops <n>) --agent <nombre>`.

| agente | usuario lab | qué hace | op kinds |
| --- | --- | --- | --- |
| `vendedor` (`vendedor-1`, `vendedor-2`) | `lab-vendedor-1@lab.local` / `lab-vendedor-2@lab.local` (si `--agent` termina en `-2`) | abre su caja, vende por el POS, cancela/devuelve ventas, cierra su caja en el teardown | `sale_create`, `sale_cancel`, `sale_return` |
| `comprador` | `lab-admin@lab.local` | crea compras (`pedido`/`recibido`), las recibe, cancela o devuelve; paga por transferencia | `purchase_create`, `purchase_receive`, `purchase_cancel`, `purchase_return` |
| `almacen` | `lab-almacen@lab.local` | ajustes de stock, conversiones empaque↔unidad, altas de producto con stock inicial | `adjustment`, `conversion`, `product_create` |
| `caos` | `lab-admin@lab.local` (compras/ajustes/productos) + `lab-vendedor-1/2@lab.local` (ventas/caja) | dobles envíos, operaciones prohibidas, vender inactivos o sin stock, carreras entre dos vendedores | `chaos_double_sale`, `chaos_double_receive`, `chaos_forbidden_adjust`, `chaos_sell_inactive`, `chaos_over_stock`, … |
| `mixto` (solo serial) | los cuatro anteriores, cada uno con su cliente y login | un único proceso que elige en cada iteración vendedor 45 %, comprador 25 %, almacen 20 %, caos 10 % y llama su `step` | los de arriba, con `agent` = `mixto-<nombre>` |

Los cuatro agentes comparten la semilla de `--seed` (determinista: `createRng`),
los productos calientes `LAB-HOT-*` y el mismo archivo de eventos del run.

### Formato de `events.jsonl`

Todos los agentes de un run hacen append a
`scripts/stock-lab/runs/<id>/events.jsonl` (`EventLogger`). Una línea por
request HTTP (un doble envío = dos líneas):

```json
{"ts":"2026-10-05T10:00:04.900Z","agent":"vendedor-2","op":"sale_create","payload":{"items":[{"productId":"…","quantity":1}]},"status":201,"response_id":"<sale id>","expected_delta":{"<productId>":-1}}
```

| campo | significado |
| --- | --- |
| `ts` | ISO 8601, lo pone el logger al recibir la respuesta |
| `agent` | nombre pasado en `--agent` (o `mixto-<nombre>` en serial) |
| `op` | `OpKind` de `expected-delta.ts`, `chaos_*` o `agent_error` |
| `payload` | body enviado + ids relevantes |
| `status` | HTTP status; `0` si el agente reventó sin respuesta (`agent_error`) |
| `response_id` | id devuelto por el API (venta/compra/ajuste) o `null` |
| `expected_delta` | `productId → delta` de stock que esa operación debería producir |
| `error` | mensaje opcional (no-2xx o `agent_error`) |

Regla `expected_delta`: solo se rellena cuando la respuesta fue 2xx; en
cualquier otro status el logger lo fuerza a `{}` (una operación rechazada no
debe mover stock, y si lo mueve es justamente lo que queremos detectar).

## Corridas (run.ts)

```bash
# paralelo: N procesos (reparto cíclico vendedor-1, vendedor-2, comprador, almacen, caos; a partir del 6º se sufija -b, -c, …)
npm run stock-lab:run -- --agents 5 --minutes 10 --seed 42 [--run <id>]

# serial: un solo proceso agents/mixto.ts
npm run stock-lab:run -- --serial --ops 200 --seed 42
```

Requisitos: base local arriba (`npm run stock-lab:db-up`) con la tienda `lab`
sembrada, y el BFF del laboratorio en `http://localhost:3100`
(`npm run stock-lab:dev`). `--agents 3` lanza `vendedor-1`, `vendedor-2` y
`comprador`; cada proceso recibe `--seed <seed + i>` y el mismo `--run`.

El run id por defecto es `YYYYMMDD-HHmmss-seed<seed>`. Estructura de
`scripts/stock-lab/runs/<id>/` (gitignored):

| archivo | contenido |
| --- | --- |
| `events.jsonl` | eventos de todos los agentes (append) |
| `agents/<nombre>.log` | stdout + stderr de cada proceso de agente |
| `reconcile.log` / `reconcile.json` | salida del oráculo `reconcile.ts`, si existe |
| `summary.md` | resumen generado por `summary.ts` |

Al terminar los agentes, `run.ts`:

1. Ejecuta `npx tsx scripts/stock-lab/reconcile.ts --run <id>` por subproceso
   **si el archivo existe**; captura su salida en `reconcile.log` y, si deja
   `reconcile.json`, lo vuelca tal cual en la sección "## Reconcile" (contando
   `rows`/`mismatches` si son arrays). Si no existe, el summary dice
   "reconcile pendiente de integrar (fase 2)". Si reconcile revienta (exit ≠ 0 y
   ≠ 2) se anota y el run termina con exit 1.
2. Lee con `pg` (`STOCK_LAB_DB_URL`, guarda de host) los `products` y los
   `stock_movements` de la tienda `stores.slug = 'lab'`.
3. Escribe `summary.md` e imprime su ruta y tres líneas (agentes, eventos,
   roturas).

Exit 0 si todos los agentes salieron 0 (aunque haya descuadres: en esta fase
solo se registran); exit 1 si algún agente salió ≠ 0 o reconcile reventó.

### Qué contiene `summary.md`

- **Agentes**: exit code por proceso.
- **Operaciones por tipo**: total / 2xx / no-2xx por `op`.
- **Errores HTTP (status × op)**: solo no-2xx, incluido `0 (agent_error)`.
- **Descuadres por producto** (una fila por producto tocado en el run):
  - `esperado(eventos)` = Σ `expected_delta[producto]` de los eventos 2xx;
  - `Σmov(run)` = Σ `quantity_delta` de los movimientos con `created_at` dentro
    de la ventana del run (≥ ts del primer evento − 2 s);
  - `Σmov(total)` = Σ `quantity_delta` de todos los movimientos del producto
    (incluye el stock inicial si se creó por movimiento);
  - `current_stock` vs `último stock_after`: el stock vivo frente al
    `stock_after` del último movimiento; deben coincidir siempre.
  - `delta` = ok si `esperado(eventos) == Σmov(run)`; `stock` = ok si
    `current_stock == último stock_after`.
- **Primer evento que rompió cada producto**: la bisección (ver abajo).
- **Reconcile**: lo descrito en el punto 1.

### Cómo leer la bisección

`findFirstBreak` toma los eventos 2xx con `expected_delta[producto] ≠ 0`
ordenados por `ts` y los movimientos del producto en la ventana del run.
Primero el atajo: si Σ esperado == Σ `quantity_delta` y la cadena
`stock_after[i] = stock_after[i-1] + quantity_delta[i]` (ordenada por
`created_at, id`) es válida, no hay rotura. Si no, atribuye cada movimiento a
su evento **por referencia** (`sale_id` / `purchase_id` / `conversion_id` /
`id` == `response_id` del evento); solo los movimientos sin referencia
conocida (p. ej. `sale_return`, que hoy responde sin id) se atribuyen por
tiempo (`created_at ≤ ts + 2 s`). El `ts` del evento es la hora de la
respuesta en el cliente, por eso la ventana temporal sola daba falsos positivos
en corridas paralelas (STK-308). Devuelve lo primero que ocurra en el tiempo:

| motivo | significado | columna "evento" |
| --- | --- | --- |
| `missing_movement` | el evento 2xx no tiene ningún movimiento atribuible (venta/compra que no dejó `stock_movement`) | `ts · agent · op · response_id` del evento culpable |
| `delta_mismatch` | los movimientos atribuidos al evento no suman su `expected_delta` (cantidad mal, línea faltante, doble descuento) | ídem |
| `chain_break` | un movimiento tiene un `stock_after` que no es el anterior + su delta (dos escrituras pisándose) | `created_at · mov <id> · type · referencia` del movimiento que rompe |
| `unattributed_movements` | quedan movimientos del producto sin ningún evento que los explique (movimiento huérfano) | último evento del producto + movimiento sobrante |

Con el culpable localizado, busca en `events.jsonl` por `response_id` o `ts`
y en `agents/<agente>.log` el contexto de esa operación. Si la tabla está
vacía, la suma esperada coincide con los movimientos y la cadena es válida.