# Laboratorio de stock (`scripts/stock-lab/`)

Herramientas del plan stock-integrity para reproducir descuadres de inventario
contra una base Supabase local y un BFF de laboratorio (`http://localhost:3100`).
Todo lee el entorno de `.env.stock-lab` con `loadStockLabEnv()` y pasa por la
guarda `assertAllowedWriteHost` antes de escribir: nunca contra producción.

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
ordenados por `ts`, acumula el delta esperado y, en cada evento, lo compara con
la suma de `quantity_delta` de los movimientos del producto con
`created_at ≤ ts + 2 s` (también acepta la ventana estricta `≤ ts`, para no
culpar a un evento por una operación concurrente todavía en vuelo). En paralelo
valida la cadena `stock_after[i] = stock_after[i-1] + quantity_delta[i]`
(movimientos ordenados por `created_at, id`). Devuelve lo primero que ocurra en
el tiempo:

| motivo | significado | columna "evento" |
| --- | --- | --- |
| `expected_mismatch` | tras ese evento 2xx la suma esperada deja de coincidir con los movimientos (p. ej. una venta 2xx sin `stock_movement`, o un movimiento sin evento) | `ts · agent · op · response_id` del evento culpable |
| `chain_break` | un movimiento tiene un `stock_after` que no es el anterior + su delta (dos escrituras pisándose) | `created_at · mov <id> · type · referencia` del movimiento que rompe |

Con el culpable localizado, busca en `events.jsonl` por `response_id` o `ts`
y en `agents/<agente>.log` el contexto de esa operación. Si la tabla está
vacía, la suma esperada coincide con los movimientos y la cadena es válida.
