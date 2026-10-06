Herramientas del plan stock-integrity para ejercitar el stock contra una base
Supabase LOCAL. Nada de aquí toca producción: todo lee `.env.stock-lab`
(`loadStockLabEnv`) y aborta si el host no coincide con
`STOCK_TEST_ALLOW_WRITES_HOST` (`assertAllowedWriteHost`).

| Script | Qué hace |
|---|---|
| `npm run stock-lab:db-up` / `db-reset` / `db-down` | Levanta, reinicia o apaga el Supabase local y aplica schema + parches. |
| `npm run stock-lab:dev` | Arranca el BFF (`next dev --webpack`) en `http://localhost:3100` contra la base local. |
| `npm run stock-lab:start` | Igual, pero en modo producción (`next build` + `next start`). Ver "BFF en modo producción". |
| `npm run stock-lab:test` | Suite de regresión `scripts/stock-lab/regression/**` contra la base lab. Ver "Suite de regresión". |
| `npm run stock-lab:scenarios` / `:ui` / `:chaos` / `:load` | Runners de la fase 4 (`scenarios/run.ts`, `ui/run.ts`, `chaos/run.ts`, `chaos/load.ts`). `:chaos` y `:load` siembran productos propios `C411-<run>-<nonce>-…` y al terminar los limpian: borran los que quedaron intactos y desactivan (sin borrar documentos) los que tienen historia. |
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

Cada venta de los operadores (`vendedor`, `caos`) lleva un `clientRequestId`
derivado de (semilla, run) con `idempotencyKey(rng, runId)` de `base.ts`: la
misma semilla en el mismo run repite las claves y en otro run da claves
distintas. `POST /api/sales` exige la clave, así que los casos de caos que la
omiten a propósito (`9.1.no_key_*`) esperan 400 y cero ventas.

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

Compras en modo empaque (`comprador.ts`): el esperado es
`packCount × unitsPerPack`, salvo que el producto sea el SKU EMPAQUE de un par
empaque→unidad: su stock se cuenta en empaques y entran `packCount`. Si el
producto pertenece a un par (como empaque o como unidad) el agente envía el
`unitsPerPack` del par; otro valor lo rechaza la RPC con 400.

Fixtures por SQL (scripts del lab con conexión `pg`): un producto se inserta
con `current_stock = 0` y el stock entra con UN movimiento (`inventario_inicial`
u otro) SIN columna `stock_after`; el trigger del libro fija el saldo y mueve
`products.current_stock`. Acompañarlo de stock en el alta o de un `update` lo
duplica. Para simular una corrupción: `update` directo como `postgres` sobre
`products.current_stock` o sobre el movimiento ya insertado.
`scripts/stock-lab/ledger-fixtures.test.ts` vigila ese patrón en todo el lab.

Reintentos idempotentes: dos eventos 2xx con el mismo `payload.clientRequestId`
y el mismo `response_id` son una sola operación; `dedupeIdempotentReplays`
(`expected-delta.ts`, lo aplica `summary.ts`) cuenta su `expected_delta` una
sola vez. Misma clave con `response_id` distinto no se deduplica: es un doble
descuento real.

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
    `stock_after` del último movimiento (el de mayor `seq`); deben coincidir
    siempre.
  - `delta` = ok si `esperado(eventos) == Σmov(run)`; `stock` = ok si
    `current_stock == último stock_after`.
- **Primer evento que rompió cada producto**: la bisección (ver abajo).
- **Reconcile**: lo descrito en el punto 1.

### Cómo leer la bisección

`findFirstBreak` toma los eventos 2xx con `expected_delta[producto] ≠ 0`
ordenados por `ts` y los movimientos del producto en la ventana del run.
Primero el atajo: si Σ esperado == Σ `quantity_delta` y la cadena
`stock_after[i] = stock_after[i-1] + quantity_delta[i]` (ordenada por
`stock_movements.seq`, el orden real de la cadena por producto; solo si la
columna no viene cae a `created_at, id`, que bajo concurrencia inventa roturas)
es válida, no hay rotura. Si no, atribuye cada movimiento a
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

## Esperados de los runners de escenarios y caos

`npm run stock-lab:scenarios -- --suite hypotheses|oneshots|serial --run <id>`
y `npm run stock-lab:chaos -- --all --run <id>` (sin `--all` ni `--case` el
runner de caos solo imprime la ayuda). Veredictos: `pass`, `fail` (bug
reproducido), `finding` (el stock queda bien, pero hay una carencia), `error`
(no se ejecutó), `skip`. Esperados que no son evidentes:

- **Devoluciones por ajuste** (`POST /api/inventory/adjustments` con
  `devolucion_cliente` / `devolucion_proveedor`): sin `saleId` / `purchaseId`
  es 400 y cero movimientos. Las celdas `*.sale_return_partial` y
  `*.purchase_return_partial` de la suite serial y
  `os.20260830b_remove.fix_by_api` comprueban ese rechazo y después devuelven
  por el camino ligado, verificando el tope (vendido/recibido − ya devuelto:
  pasarse es 409, el resto exacto pasa, una unidad más es 409).
- **Doble envío de compra, ajuste y conversión**: `h08.dg5_double_submit` manda
  la MISMA `clientRequestId` en los dos POST y exige una sola operación (mismo
  id, un movimiento). `h08.dg5_double_submit_no_key` repite el envío sin clave:
  la clave es opcional por contrato en esos tres endpoints, así que el
  duplicado sale como `finding` documentado, no como `fail`.
- **Réplicas de one-shots con residuo** (`os.20260821.sql_replica`,
  `os.20260830c.sql_replica`): el parche deja residuo por construcción. El
  esperado es `stock_reconciliation` = 0 y que las vistas v2 detecten
  exactamente ese residuo (821: 3 filas de `stock_chain_breaks`; 830c: una
  `missing_document_line` y una `reversal_on_live_document`). Eso es `pass`
  («el oráculo v2 detecta el residuo del one-shot»); cualquier otra fila en
  cualquier vista es `fail`. El resto de réplicas sigue exigiendo las 9 vistas
  en 0.
- **`h06.dg7_deadlock`**: 20 pares de ventas cruzadas [A,B] / [B,A] por HTTP en
  paralelo. Cada respuesta debe ser 2xx o un rechazo de negocio; un 40P01
  (también como el 409 reintentable al que lo traduce el BFF) o un 5xx es
  `fail`. No se encadenan dos `create_sale` en una transacción SQL: el producto
  ejecuta una RPC por transacción.
- **Caos 9.8** (respuesta perdida tras el commit): en las dos variantes
  `GET /api/sales/by-request/<clave original>` debe devolver la venta
  confirmada (es lo que consulta el POS antes de dejar reintentar).
  `9.8.same_key_retry` exige además que el reintento con esa clave devuelva la
  misma venta. `9.8.new_key_retry` es informativo: un reintento a ciegas con
  clave nueva está fuera de contrato (el servidor no puede distinguirlo de una
  venta nueva); el duplicado coherente se anota en el detalle y no cuenta como
  `finding`.
- **Reloj del contenedor lab**: retrocede ~0,7 s cada ~29 s, así que
  `created_at` puede invertir dos movimientos seguidos. Los runners ordenan
  por `stock_movements.seq`; las ventanas por tiempo de `summary.ts` llevan
  2 s de tolerancia. No ordenes por `created_at` en un caso nuevo.

## Ola UI (`stock-lab:ui`)

```bash
npm run stock-lab:ui -- --run <id> [--only 1,2,5] [--seller vendedor1|vendedor2] [--headed] [--list] [--help]
```

Maneja la app real con Playwright (login por el formulario, BFF lab en
`http://localhost:3100` en modo producción) y **verifica** los 10 flujos del
plan §8.3: en cada caso lee por SQL el estado antes y después (ventas, líneas,
pagos, movimientos por `seq`, stock) y lo compara con lo que la pantalla dice.
`pass` = el producto cumple el esperado; `fail` = bug de producto; `finding` =
stock correcto pero carencia de UX; `error` = el caso no se ejecutó. La ola
completa (23 casos) tarda ~5-6 min y se puede repetir sin reset: cada run crea productos
propios `U404-<run>-<nonce>-…`, con stock por `inventario_inicial`, que no
dejan filas en las vistas de `reconcile`.

Requisitos: base sembrada, BFF arriba (`stock-lab:start`) y nadie más usando la
caja de `lab-vendedor-1` (la ola abre su sesión de caja si no lo está y no la
cierra).

| flujo | esperado (caso `plan`) | casos `extra` |
|---|---|---|
| f01 | POS, venta de 3 líneas: una venta, una fila «Venta» por producto en `/inventory/movements` y el stock exacto en el detalle | — |
| f02 | 3G lento (CDP, 2 s de latencia) + doble clic en «Procesar venta»: UNA venta, un juego de movimientos, un POST | triple clic + Enter; 3 `click()` en la misma tarea JS (único que llega con el botón aún habilitado y ejercita el candado) |
| f03 | La respuesta del cobro se pierde con la venta ya confirmada. Si la consulta por clave responde, la UI muestra «Venta registrada». Si tampoco responde: aviso «La venta pudo haberse registrado…» + botón «Verificar», y con el aviso a la vista (a) «Verificar», (b) «Limpiar orden», (c) recargar, rehacer el carrito y cobrar, (d) salir a `/sales`, volver, rehacer y cobrar. En todos: exactamente 1 venta, 1 línea, 1 pago y 1 movimiento `venta` para ese carrito, 1 solo POST, y la UI termina nombrando la factura de la base | corte antes de llegar al servidor + reintento; respuesta retenida 35 s |
| f04 | Compra en modo empaque (3 × 12) como `pedido` → 0 movimientos; «Recibir pedido» → un movimiento `compra` +36 | doble clic en «Confirmar recepción» |
| f05 | Compra `pedido`: 0 movimientos y la UI dice de forma explícita que la mercancía no ha entrado | — |
| f06 | Ajuste de entrada y de salida desde `/inventory` → un movimiento cada uno. El selector «Tipo de movimiento» ofrece solo `Ajuste entrada`, `Ajuste salida` e `Inventario inicial`: una devolución en la lista es `fail` | salida mayor que el stock → mensaje y sin movimiento |
| f07 | «Abrir empaque» ×2 (x12) desde el detalle: `conversion_salida` −2 y `conversion_entrada` +24 con el mismo `conversion_id` | abrir empaque sin stock → mensaje propio a la vista, sin POST ni movimientos |
| f08 | Anular una venta `pendiente_pago` desde su detalle (doble clic): un movimiento inverso ligado a la venta, visible en movimientos | anular una venta pagada → rechazo explicado a la vista sin scroll, base intacta |
| f09 | «Nuevo producto» con stock inicial 15: `current_stock` 15 y un movimiento `inventario_inicial` +15 visible | — |
| f10 | Import Excel de 3 filas con `stock_inicial` 7/14/21: un `inventario_inicial` por producto | — |

Cómo se simula la respuesta perdida (f03): `page.route` deja pasar el
`POST /api/sales`, espera el 201 del servidor y descarta la respuesta
(`connectionreset`); para el caso «no se sabe» aborta además
`GET /api/sales/by-request/*`, que es lo que el POS consulta antes de dejar
cobrar otra vez. La red se restaura con `page.unroute`.

Salidas:

| archivo | contenido |
|---|---|
| `scripts/stock-lab/runs/<run>/ui.jsonl` | un caso por línea: `scope` (`plan`/`extra`), `steps`, `ui_says` (texto literal de la pantalla), `expected`, `actual` (filas de la base), `verdict`, `detail` y `evidence` (rutas de sus capturas) |
| `scripts/stock-lab/runs/<run>/ui.md` | cobertura (flujos ejecutados con captura), tabla flujo → veredicto, **capturas por flujo** y tabla por caso |
| `.notes/stock-integrity-gtm/qa/ui/<run>/` | `fNN-<caso>-<nn>-<paso>.png`, `ui-results.json` (lo mismo que el `.md`, en JSON) y, si un caso revienta, `…-error.aria.txt` |

El veredicto de un flujo es el peor de sus casos `plan`; los `extra` se
informan en su propia columna y no lo deciden. Un flujo sin casos o sin
ninguna captura aparece como `COBERTURA …` en la consola y en la línea
«Cobertura» del `.md`: no cuenta como probado. `--shots` y `--out` cambian las
dos raíces. La lógica pura (juez de la respuesta perdida, tipos del ajuste,
resumen por flujo) está en `scripts/stock-lab/ui/helpers.ts` y se prueba con
`npx jest scripts/stock-lab/ui`.

Los rechazos de `f07.sin_stock` y `f08.paid` se juzgan con
`judgeRejectionMessage` (STK-607): `pass` solo si el mensaje está entero dentro
de la ventana SIN hacer scroll (`boundingBox`, no presencia en el DOM), explica
el motivo en español, no hay burbuja de validación nativa del navegador y la
base no cambia; cualquier otra cosa es `fail`. Hasta `s606-ui-1` eran `finding`
(burbuja nativa en inglés; error bajo el pliegue, a ~990 px con ventana de 900).

## BFF en modo producción

`npm run stock-lab:start` (= `npx tsx scripts/stock-lab/dev.ts --start`) hace
`next build` y después `next start -p 3100`, ambos con el entorno lab ya puesto
en `process.env`. Mismas guardas que el modo dev (claves obligatorias y
`assertAllowedWriteHost` sobre `NEXT_PUBLIC_SUPABASE_URL`).

| Usa | Cuándo |
|---|---|
| `stock-lab:dev` | Iterar sobre el código del BFF (recarga en caliente) y corridas seriales cortas. |
| `stock-lab:start` | Olas concurrentes, caos y carga: sin compilación bajo demanda, ~2,5× más operaciones por minuto en la misma máquina y sin el 500 "sin cuerpo". |

- **Build**: ~90-100 s (Turbopack, el mismo `next build` del script `build`).
  Sale a `.next/`; `next dev` usa `.next/dev/`, así que no se pisan.
- **`--no-build`**: `npm run stock-lab:start -- --no-build` arranca en ~5 s
  sobre el build existente. Úsalo para reiniciar el BFF tras cada
  `stock-lab:db-reset` (el BFF hay que reiniciarlo siempre tras un reset).
  Recompila sin el flag si cambió algo en `src/**` o en `.env.stock-lab`.
- **Por qué el build es seguro**: `next build` inlinea las `NEXT_PUBLIC_*` en el
  bundle y Next carga `.env.local` (producción), pero no pisa variables ya
  presentes en el entorno, y el script pone antes las del lab. Además, antes de
  cada `next start` (con o sin build) `assertBuildTargetsLab` revisa
  `.next/static` y `.next/server` y se niega a servir si aparece un host
  `<ref>.supabase.co` o si falta la URL lab. No uses `npx next build` ni
  `npx next start` a mano sobre ese `.next`: te saltas el entorno y la guarda.
- **Límite de la guarda**: las variables de `.env.local` que el archivo
  stock-lab NO define (claves de IA, secretos de cron…) sí llegan al proceso,
  igual que en modo dev.
- **Parar el BFF en Windows** (Ctrl+C no siempre mata el árbol `npx` → `node`):

  ```powershell
  Get-NetTCPConnection -LocalPort 3100 -State Listen |
    ForEach-Object { taskkill /PID $_.OwningProcess /T /F }
  ```

  o `netstat -ano | findstr :3100` y `taskkill /PID <pid> /T /F`. Con `/T` caen
  también los hijos; el `npx`/`tsx` padre termina solo al morir el servidor.

### Medición del 500 "sin cuerpo" (STK-401)

Misma máquina y misma base (sin `db-reset` entre ambas),
`stock-lab:run -- --agents 5 --minutes 2`:

| modo | eventos | 500 total | 500 "sin cuerpo" | % | `Unexpected end of JSON input` en el log |
|---|---|---|---|---|---|
| `next dev --webpack` (seed 143) | 1296 | 36 | 2 | 0,15 % | 2 |
| `next build` + `next start` (seed 42) | 3263 | 103 | 0 | 0 % | 0 |

En dev los dos casos fueron `POST /api/sales/<id>/return` atendidos mientras
Next compilaba esa ruta por primera vez (`next.js: 12.0s` de los 12,8 s de la
respuesta). En producción no hay compilación bajo demanda y no apareció ni
una vez en 3263 eventos: se trata como artefacto de `next dev`, no como bug de
producto. Los demás 500 (`Solo se pueden recibir compras en estado pedido`,
`No hay stock suficiente para revertir la compra`, `deadlock detected`) salen
en ambos modos.

## Suite de regresión (`stock-lab:test`)

`npm run stock-lab:test` (= `jest --config jest.stock-lab.config.ts
--runInBand`) corre SOLO `scripts/stock-lab/regression/**/*.test.ts`:

- entorno `node` (sin jsdom ni `jest.setup.ts`), `testTimeout` de 120 s y en
  serie (`maxWorkers: 1`), porque todos los tests comparten la base lab local
  (`pg` + `STOCK_LAB_DB_URL` vía `loadStockLabEnv`, con `assertAllowedWriteHost`);
- esos tests pueden FALLAR a propósito: reproducen bugs todavía sin corregir.
  Por eso `npm test` (`jest.config.ts`) ignora la carpeta
  (`testPathIgnorePatterns`) y sigue verde;
- si la carpeta está vacía o no existe, termina con exit 0 (`passWithNoTests`).

Los demás tests de `scripts/stock-lab/*.test.ts` (unitarios, sin base) siguen
en `npm test`. Para un solo archivo:
`npm run stock-lab:test -- scripts/stock-lab/regression/<archivo>.test.ts`.

## Informe de producción (solo lectura)

```bash
npx tsx scripts/stock-lab/reconcile.ts --target production --read-only --run <id> [--store <uuid>] [--limit 20]
```

Único comando del laboratorio que toca producción, y solo para leer. La
conexión sale del `.env` de la raíz (`NEXT_PUBLIC_SUPABASE_URL` → project ref y
hosts candidatos, `SUPABASE_DB_PASS`), igual que `scripts/db-sql.mjs`; no usa
`.env.stock-lab` ni `STOCK_LAB_DB_URL`. Exit 0 = sin descuadres, 2 = hay
descuadres, 1 = error.

Qué garantiza (`scripts/stock-lab/reconcile-readonly.ts`):

- Sin `--read-only` aborta antes de abrir ninguna conexión.
- Toda la sesión va en `begin transaction isolation level repeatable read,
  read only` … `rollback`: Postgres rechaza cualquier escritura y todos los
  conteos salen de la misma foto.
- Todas las sentencias pasan por una única función (`createReadOnlyQuery`) que
  solo deja salir `SELECT` / `WITH … SELECT`, ese `BEGIN` y `ROLLBACK`; rechaza
  `INTO`, `FOR UPDATE`, CTE con escritura, varias sentencias y cualquier función
  fuera de una lista corta (`nextval`, `set_config`, RPC del esquema…).
- No crea ni usa objetos de los parches: las 9 comprobaciones de las vistas de
  integridad v2 van como `SELECT` inline, y antes mira en `information_schema`
  qué columnas existen.
- El informe se escribe solo en `scripts/stock-lab/runs/<id>/` (gitignored):
  `reconcile.json` (mismo formato que en lab más `host` y `readOnly`) y
  `reconcile.md`.

Cómo leer `reconcile.md`:

- **Cabecera y Avisos**: «Orden de la cadena» dice `seq` o `created_at,id`. Sin
  `stock_movements.seq` aparece el aviso «cadena ordenada por created_at,id:
  puede haber falsos positivos bajo concurrencia»: las filas de
  `stock_chain_breaks` (y la fecha del primer descuadre) son indicios, no
  pruebas. Una comprobación con «no evaluable: falta <columna>» no se ejecutó:
  su conteo es `-`, no 0 (en `report` del JSON cuenta 0; el estado real está en
  `readOnly.checks`).
- **Total** y una sección por **Tienda**: tabla de las 9 comprobaciones,
  productos con diff ≠ 0, suma absoluta del diff, cadenas rotas, ventas y
  compras recibidas sin movimiento.
- **Los 20 peores**: sku, nombre, `current_stock`, Σ movimientos, diff y el
  primer descuadre del producto: el primer movimiento cuyo `stock_after` no es
  el anterior + su delta (fecha, id, valor esperado), o «diff sin rotura de
  cadena: stock escrito fuera del libro» con la fecha de alta del producto y la
  del último movimiento. `readOnly.diffProducts` del JSON trae lo mismo para
  todos los productos con diff.
- **Muestras**: hasta `--limit` filas por comprobación y tienda (contienen ids
  y cantidades de producción: no sacar el directorio del run de la máquina).

`scripts/stock-lab/regression/reconcile-readonly.test.ts` comprueba contra la
base lab que el resultado inline coincide con las vistas v2 y que, tras quitar
`seq` y las vistas dentro de una transacción con rollback, sigue detectando los
descuadres inyectados.
