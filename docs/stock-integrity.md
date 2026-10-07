# Integridad de inventario

Entrega del plan [`agent-prompts/stock-integrity-gtm.md`](agent-prompts/stock-integrity-gtm.md) (rama `fix/stock-integrity`). Qué descuadraba el stock, cómo quedó protegido, cómo se verifica y cómo se despliega. Guía de las herramientas del laboratorio: [`stock-lab.md`](stock-lab.md). Receta de la base local: [`supabase-setup.md`](supabase-setup.md) §13.

Lectura rápida: ninguna RPC de stock perdía o duplicaba unidades por sí sola (39 155 eventos concurrentes en 3 semillas + 6 000 de carga con `current_stock = Σ quantity_delta`). El descuadre `current_stock ≠ Σ movimientos` nacía de escrituras de stock fuera de las RPC (C1, C2) y el descuadre "físico ≠ sistema" con el libro cuadrado, de ventas o compras duplicadas o infladas (C3–C6, C8, C13).

---

## 1. Fuente de verdad del stock

El libro mayor `stock_movements` manda. `products.current_stock` es un derivado que solo cambia como efecto de insertar un movimiento.

| Pieza | Parche | Qué hace |
|---|---|---|
| Trigger `trg_stock_movements_apply` (función `stock_movements_apply()`, `before insert` por fila) | `20261006a`, estricto en `20261006e` | Bloquea el producto (`for update`), asigna `seq` (secuencia tomada después del lock: orden real de la cadena), descarta el `stock_after` que traiga quien inserta y fija `stock_after = current_stock + quantity_delta`; saldo negativo → `PT409`; tienda distinta a la del producto → `PT409`; actualiza `products.current_stock` (exactamente 1 fila). Es el único escritor de `current_stock` en `public` (check en `verify-patches.sql`). |
| Guard `products_stock_guard()` sobre `products` | `20261006a`, estricto en `20261006e` | `update` de `current_stock` solo pasa con la GUC `app.stock_writer = '1'` (la pone el trigger) o si `session_user in ('postgres','supabase_admin')` (conexión directa: migraciones, one-shots, preparación de tests). Por PostgREST `session_user` es `authenticator`: admin, almacén, `service_role` y cualquier RPC quedan fuera (`PT409`). `insert` de producto con `current_stock <> 0` sin ese privilegio → `PT400`. |
| Solo-append | grants en `20261006a`, trigger `stock_movements_append_only` en `20261006g` | Los roles de PostgREST no tienen insert/update/delete sobre `stock_movements`; update/delete/truncate → `PT409` salvo sesión `postgres`/`supabase_admin`. Solo insertan las RPC `security definer`. |

**BEFORE y no AFTER.** El plan pedía actualizar `products` en un trigger AFTER. Se hace en el BEFORE porque los AFTER ROW se disparan al final de la sentencia: un `insert … select` con dos filas del mismo producto calcularía ambas sobre el mismo saldo y rompería la cadena. Efecto conocido (R10, baja): un `insert … on conflict do nothing` que choque mueve stock sin dejar fila; ninguna RPC lo usa.

**Qué debe hacer una RPC de stock** (contrato para cualquier RPC nueva o modificada):

1. `security definer`, `set search_path = public`, `assert_store_context()` en la primera sentencia.
2. Bloquear primero el documento (`sales`/`purchases` `for update`) y después todos los productos en una sola sentencia `… where id = any(v_ids) and store_id = v_store_id order by id for update`; `if not found` → `PT404`.
3. Insertar el movimiento con `stock_after` NULL y, si necesita el saldo, leerlo con `returning stock_after`.
4. No escribir `products.current_stock`. Otros `update products` (p. ej. `current_cost_ref`) llevan `store_id` + `get diagnostics row_count = 1`.
5. Errores de negocio con `errcode` `PT400`/`PT403`/`PT404`/`PT409` y mensaje en español.

**IVA de la línea de compra** (`20261007a`, plan ux-mejoras SHR-10). `create_purchase` conserva la firma de 14 argumentos y todo lo anterior; cada línea de `p_items` acepta además `tax_rate_code` (opcional). Con `tax_rate_code` la alícuota debe existir y estar activa para la tienda (`tax_rates`: propia o global; la propia manda sobre la global del mismo código) y su `pct` es el porcentaje que se congela en `purchase_items.tax_rate`; con solo `tax_rate` el porcentaje debe ser el de una alícuota activa y se guarda su código en `purchase_items.tax_rate_code`; si no coinciden o no hay alícuota activa, `PT400`. No cambia cantidades, costos, totales, bloqueos ni movimientos (test diferencial contra la versión de `20261006h` en `regression/tax-rates.test.ts`).

Lo mismo vale para scripts por conexión directa y fixtures: insertar el movimiento ya mueve el stock; acompañarlo de un `update` manual lo duplica.

---

## 2. Causas confirmadas (C1–C21)

`regression/` = `scripts/stock-lab/regression/` (suite `npm run stock-lab:test`, contra la base lab). Los ids de escenario son de `npm run stock-lab:scenarios`, `stock-lab:ui` y `stock-lab:chaos`. Todas tienen commit y test.

| id | Qué era | Evento / escenario reproductor | Test de regresión | Capa | Parche | Commit |
|---|---|---|---|---|---|---|
| C1 | `POST /api/products` con `currentStock > 0` (formulario e import Excel) dejaba stock sin movimiento `inventario_inicial`: diff permanente | `iva.new_product_stock_form`; UI f09, f10; `h09.*` | `src/modules/products/services/products.server.stock-integrity.test.ts`, `src/modules/products/products-import/services/runProductImportJob.stock-integrity.test.ts` | BFF | — | `1965096` |
| C2 | Sin trigger que atara `current_stock` al libro; admin/almacén podían hacer `PATCH /rest/v1/products {current_stock}` | `h07.dg1_direct_update_postgrest`, `h07.no_trigger` | `regression/rls-guards.test.ts`, `regression/ledger-strict.test.ts` | SQL (trigger + guard) | `20261006a`, `20261006e` | `e4efa15`, `5301e25` (test de INSERT directo: `9d4e4a3`) |
| C3 | Respuesta perdida tras el commit: la clave de idempotencia vivía en memoria; recargar, limpiar, salir o abrir otra pestaña creaba una segunda venta | UI `f03.iv_unknown_then_reload`, `f03.ii` | `src/modules/sales/sale-create/page.stock-integrity.test.tsx` | UI | — | `bd43474`, `4a752b1`, `689d66e` |
| C4 | Misma `clientRequestId` con otro carrito: 201 con la venta vieja | caos 9.8 | `regression/sales-payments.test.ts` | RPC | `20261006b` | `3fe2fba` |
| C5 | `POST /api/sales` sin clave duplicaba; el fallback en dos pasos repetía ventas con la misma clave. Reproduce el síntoma del 29-ago (4 `pendiente_pago` idénticas) | `9.1.no_key_x2`; `os.20260830.symptom` | `src/app/api/sales/route.stock-integrity.test.ts`, `src/modules/sales/services/sales.server.stock-integrity.test.ts` | BFF | requiere `20260909` | `d323d5d` |
| C6 | `create_purchase`, `adjust_stock` y `convert_pack_to_units` sin idempotencia: doble envío duplicaba con las 9 vistas en 0 | `h08.dg5_double_submit` | `regression/purchases-inventory.test.ts` | RPC + BFF + UI | `20261006c` | `160cd0e`, `6ec25d9`, `be730bb` |
| C7 | `return_sale` dejaba el pago `activo` en una venta `devuelta` (dinero atrapado) | `9.4.paid`; `h04.dg3` | `regression/sales-payments.test.ts` | RPC | `20261006b` | `3fe2fba` |
| C8 | `register_payment` aceptaba ventas `cancelada`/`devuelta` y las reabría; pago + `return_sale` sumaba stock en cada vuelta | caos propio N1 (pago 0,01 → `return_sale`, 5 ciclos: 10 → 15) | `regression/sales-payments.test.ts` | RPC | `20261006b`, `20261006c` | `3fe2fba`, `160cd0e` |
| C9 | Perfil con `is_active = false` pasaba la guarda de rol por NULL | `h12.dg2_inactive_user`; caos 9.9 | `regression/rls-guards.test.ts` | RPC | `20261006a` | `4f0181b` |
| C10 | Bloqueo en el orden de líneas del cliente: ventas cruzadas → `40P01` → 500 | caos 9.10; `h06.dg7_deadlock` | `regression/sales-payments.test.ts` | RPC + BFF | `20261006b`, `20261006c` | `3fe2fba`, `160cd0e` |
| C11 | Numeración por reloj a 1 ms: dos documentos en el mismo ms → 409 en una venta válida | caos 9.3; ola 8.2 (4/2/19 por semilla) | `regression/sales-payments.test.ts` | RPC | `20261006b`, `20261006c` | `3fe2fba`, `160cd0e` |
| C12 | Rechazos de negocio como 500 o con el error crudo de Postgres | caos `9.2.*`, 9.7; 20 celdas `*.purchase_*` de la matriz | `src/lib/supabase/errors.stock-integrity.test.ts`, `src/app/api/sales/route.stock-integrity.test.ts` | BFF + RPC | `20261006b`, `20261006c`, `20261006f` | `9926f6d`, `1d6b999`, `a4687b8`, `3fe2fba`, `160cd0e`, `9a5c4a0` |
| C13 | Modo empaque aceptaba `units_per_pack` del cliente sin contrastar con el par y sumaba unidades al SKU empaque | `pack.purchase_pack_upp_mismatch`, `pack.purchase_pack_on_pack_sku`; `h02.dg8` | `regression/purchases-inventory.test.ts` | RPC | `20261006c` | `160cd0e` |
| C14 | `return_purchase` sobre un `pedido` nunca recibido → `devuelto` sin movimientos | manual (devolver un pedido por API) | `regression/purchases-inventory.test.ts` | RPC | `20261006c` | `160cd0e` |
| C15 | Sin devolución parcial ligada al documento: ajuste `devolucion_cliente` + devolución total duplicaba unidades | `*.sale_return_partial` | `regression/purchases-inventory.test.ts`, `regression/rpc-review-g.test.ts` | RPC + BFF + UI | `20261006b`, `20261006c`, `20261006f`, `20261006g` | `3fe2fba`, `160cd0e`, `9a5c4a0`, `5e62968`, `7e1a840`, `e4746a9`, `bcc7e12` |
| C16 | `stock_chain_breaks` ordenaba por `created_at`: 715 falsos positivos; 4 mutaciones de documento no detectadas | `h07.dg9_*`; ola 8.2 | `regression/integrity-views.test.ts` | SQL (vistas) | `20261006d` | `67cdfd2` |
| C17 | admin/contador editaban `sales.status`, importes, `purchases.status` y `payments` por PostgREST | caos propio N3 | `regression/rls-guards.test.ts` | SQL (RLS/grants) | `20261006a` | `5b541d9` |
| C18 | 7 vistas de reportes sin `security_invoker`, legibles con la anon key y entre tiendas | caos propio N2 | `regression/rls-guards.test.ts` | SQL | `20261006a`, `20261006d` | `609779f`, `67cdfd2` |
| C19 | Vendedor vendía a 0,01 o con descuento ≥ total | caos propio N4 | `regression/sales-payments.test.ts` | RPC | `20261006b` | `3fe2fba` |
| C20 | Escanear con búsqueda lenta y cobrar enseguida vendía sin esa línea, que aparecía en el carrito siguiente | manual en el POS (escaneo lento + cobrar) | `src/modules/sales/sale-create/page.stock-integrity.test.tsx` | UI | — | `4251439` |
| C21 | Guardas de host del laboratorio saltables (`?host=` en la URL, host permitido tomado del entorno, puerto sin comprobar) | caos de fases 1–3 | `scripts/stock-lab/env.stock-integrity.test.ts`, `scripts/stock-lab/agents/lab-api-guard.test.ts` | infra (lab) | — | `eacba54`, `d49c82b` |

Arreglos posteriores del revisor de RPC que no son causa de descuadre pero cambian el comportamiento:

| Hallazgo | Parche | Commit |
|---|---|---|
| R1 `cancel_sale` repone vendido − ya devuelto; R2, R3, R5a, R6, R9 | `20261006f` | `9a5c4a0` |
| R4 devoluciones fuera del ajuste libre; R7, R11 (solo-append por trigger), R12, R17; RPC de precios con filtro de tienda | `20261006g` | `7e1a840` |
| N1/N2 RLS por tienda en líneas, historiales y empaques | `20261006h` | `5a18c6a` |
| N3 caja y baúl sin escritura por PostgREST | `20261006h` | `e9e5383` |
| N4/N6 NaN/Infinity en parámetros (`assert_finite_numeric`), `PT403` en RPC de precios | `20261006h` | `a33fdfb` |
| R5c sesión de caja abierta bloqueada en `cancel_payment_apply` | `20261006h` | `2ded98d` |
| NaN/Infinity escritos directo en columnas (triggers en 21 tablas) | `20261006i` | `5460ea7` |

Tests: `regression/rpc-review.test.ts`, `rpc-review-g.test.ts`, `rpc-review-h.test.ts`, `rpc-review-i.test.ts`.

---

## 3. Hipótesis (H1–H12)

Ninguna quedó "no reproducible".

| # | Qué se comprobó | Etiqueta | Evidencia |
|---|---|---|---|
| H1 | Compra `pedido` mueve stock o `receive` ingresa dos veces | descartada | `*.purchase_ordered_then_receive`, `h01.pedido_then_receive`; UI f05. Borde: C14 |
| H2 | Modo empaque normaliza mal | descartada (la normalización) | `pack.purchase_received_pack_6`, `_12`, `_24`; `h02.pack_normalization`. Variante confirmada: C13 |
| H3 | Cruce de tiendas | descartada | `h03.d1_store_isolation`, `h03.moved_product_ops`; caos 9.7 |
| H4 | Doble reversión | descartada en el camino directo; confirmada la variante C8/C15 | matriz cancelar/devolver dos veces; caos 9.4 (60 repeticiones); 0 dobles reversiones en 39 155 eventos |
| H5 | Conversión empaque→unidad desbalanceada | descartada | `pack.conversion_normal_6`, `_12`, `_24`; `h05.convert_balanced`; caos 9.6 |
| H6 | Carrera entre ventas simultáneas | descartada | olas 8.2 (3 semillas, 1 151 productos-run sin diferencia); caos 9.3; `h06.concurrent_sales`. Efectos laterales: C10, C11 |
| H7 | Escrituras de stock fuera de las RPC | confirmada | `h07.dg1_direct_update_postgrest`, `h07.no_trigger`, `os.20260821.sql_replica`. Causas C1, C2, C16, C17 |
| H8 | Doble envío / respuesta perdida en el POS | confirmada | UI `f03.iv_unknown_then_reload`; `9.1.no_key_x2` (30/30). Causas C3, C4, C5, C20 |
| H9 | Producto nuevo con stock sin movimiento | confirmada | `POST /api/products {currentStock: 7}` → diff 7 permanente; `h09.*`; UI f09, f10. Causa C1 |
| H10 | Venta `pendiente_pago` descuenta o repone mal | descartada (rama `borrador` sin cubrir: ningún endpoint la crea) | `*.sale_pending_then_paid`, `*.sale_cancel_before_pay`, `*.sale_cancel_after_pay`; caos 9.11 |
| H11 | Recepción doble de una compra | descartada | `*.purchase_receive_twice`; caos 9.2 (60/60); `h11.receive_twice` |
| H12 | RPC sin `security definer` o con updates de 0 filas en silencio | descartada | `h12.d0_catalog`, `h12.rpc_rowcounts`. Huecos adyacentes: C9, C12 |

---

## 4. Invariantes y vistas de integridad

Nueve vistas en `public` creadas por `20261005-stock-integrity-views.sql`; `20261006d-stock-integrity-views-v2.sql` reemplaza cuatro (`stock_chain_breaks`, `movements_without_document`, `reversal_mismatches`, `conversion_mismatches`). Todas tienen `store_id`, usan `security_invoker` y solo las leen `authenticated` y `service_role`. **Una fila = un descuadre**; vacías = el inventario cuadra.

| Vista | Qué detecta | Cómo se lee una fila |
|---|---|---|
| `stock_reconciliation` | `current_stock` ≠ Σ `quantity_delta` del producto | `diff = current_stock − ledger_stock`. Positivo: hay stock sin movimiento. Negativo: el libro tiene más de lo que dice el producto |
| `stock_chain_breaks` | Movimiento cuyo `stock_after` ≠ `stock_after` del anterior + su `quantity_delta`, en orden de `seq` (v2) | `expected_stock_after` frente a `stock_after`; `prev_movement_id` es el eslabón anterior. El primer movimiento del producto no se evalúa |
| `sales_without_movements` | Línea de venta viva sin movimiento `venta` o con delta ≠ −cantidad | `issue`: `missing` o `delta_mismatch`; `quantity` frente a `movement_delta` |
| `purchases_without_movements` | Línea de compra `recibido` sin movimiento `compra` o con delta ≠ cantidad normalizada | `issue`: `missing` o `delta_mismatch`; `normalized_quantity` frente a `movement_delta` |
| `movements_without_document` | Movimiento `venta`/`compra` sin documento coherente | `issue`: `null_document`, `missing_document`, `missing_document_line` (el documento ya no tiene línea de ese producto), `document_status_mismatch` (venta `borrador` o compra `pedido` con stock movido), `cancelled_without_reversal` |
| `reversal_mismatches` | Reversiones que no cuadran, por documento y producto | `original_delta` frente a `reversal_delta`. `issue`: `reversal_mismatch` (documento cancelado/devuelto cuyos inversos no suman el opuesto) o `reversal_on_live_document` (documento vivo con movimientos de cancelación o con más devuelto que movido) |
| `conversion_mismatches` | Par `conversion_salida`/`conversion_entrada` incoherente | `pack_delta`, `unit_delta`, `units_per_pack` registrado. `issue`: `missing_salida`, `missing_entrada`, `missing_link`, `ratio_mismatch`. `current_units_per_pack` es solo informativo |
| `negative_stock` | `current_stock < 0` o `stock_after < 0` | `source` = `product` o `movement`; `value` es el saldo negativo |
| `cross_store_movements` | Movimiento, producto y documento de tiendas distintas | `store_id` (movimiento) frente a `product_store_id` y `document_store_id` |

Oráculo: `select public.stock_integrity_report()` (todas las tiendas; superadmin o `service_role`) o `stock_integrity_report('<store uuid>')` devuelve un jsonb con el conteo de las nueve vistas. Todo en 0 = el inventario cuadra. `npm run stock-lab:reconcile` lo llama y muestra las filas.

Límites conocidos: las vistas no ven una venta o compra duplicada coherente (por eso existen las claves de idempotencia) ni un conteo físico distinto del sistema.

---

## 5. Cómo correr el laboratorio

Todo es local: los scripts leen `.env.stock-lab` (copiar de `.env.stock-lab.example`) y abortan si el host no es el permitido. Requiere Docker Desktop.

| Comando | Qué hace | Flags |
|---|---|---|
| `npm run stock-lab:db-up` | Supabase local + esquema + parches estructurales + seed + superadmin + `verify-patches` | — |
| `npm run stock-lab:db-reset` | Vacía la base y reaplica el pipeline | — |
| `npm run stock-lab:db-down` | `supabase stop` (conserva el volumen) | — |
| `npm run stock-lab:seed` | Crea o recrea la tienda `lab` (40 productos, 5 usuarios, stock por `inventario_inicial`) | — |
| `npm run stock-lab:start` | BFF en modo producción (`next build` + `next start`) en `http://localhost:3100` | `--no-build` |
| `npm run stock-lab:dev` | BFF con `next dev --webpack` en el mismo puerto | `--start [--no-build]`, `--mode dev\|start` |
| `npm run stock-lab:run` | Agentes operadores + reconcile + `summary.md` | `--agents <n>`, `--minutes <m>` o `--ops <n>`, `--seed <n>` (obligatoria), `--run <id>`, `--serial` |
| `npm run stock-lab:scenarios` | Matriz serial, hipótesis y réplicas de one-shots | `--suite serial\|oneshots\|hypotheses\|all`, `--run <id>`, `--only a,b`, `--list`, `--out <dir>` |
| `npm run stock-lab:ui` | 10 flujos por Playwright contra la app real | `--run <id>`, `--only 1,2,5`, `--seller vendedor1\|vendedor2`, `--headed`, `--list`, `--help`, `--out <dir>`, `--shots <dir>` |
| `npm run stock-lab:chaos` | Casos de caos 9.1–9.12 con oráculo SQL | `--case 9.1[,9.2…]` o `--all`, `--run <id>`, `--repeat N`, `--list`, `--out <dir>` |
| `npm run stock-lab:load` | Carga a ritmo constante con percentiles | `--ops 1000`, `--seconds 120`, `--concurrency 16`, `--mix create_sale=62,…`, `--seed 411`, `--run <id>`, `--out <dir>` |
| `npm run stock-lab:test` | Suite de regresión `scripts/stock-lab/regression/**` contra la base lab | argumentos de jest (p. ej. una ruta de test) |
| `npm run stock-lab:reconcile` | Oráculo: tabla vista / filas / estado + `reconcile.json` | `--run <id>`, `--store <uuid>`, `--limit 20`, `--target local\|production`, `--read-only` |

Ciclo típico antes de tocar una RPC de stock:

```bash
npm run stock-lab:db-reset && npm run stock-lab:seed   # verify-patches debe dar fail=0
npm run stock-lab:test                                 # regresión contra la base lab
npm run stock-lab:start                                # en otra terminal; --no-build si src/ no cambió
npm run stock-lab:reconcile                            # 0 en las 9 vistas antes de empezar
npm run stock-lab:run -- --serial --ops 200 --seed 42
npm run stock-lab:run -- --agents 5 --minutes 10 --seed 42
npm run stock-lab:reconcile                            # exit 0 = cuadra, 2 = hay descuadres
```

Notas: no correr `stock-lab:db-up` sobre una base con datos (usar `db-reset` + `seed`); reiniciar el BFF tras cada reset porque cachea la tasa oficial; cada ola de `scenarios`, `ui`, `chaos` o `load` parte de una base reseteada y sembrada.

### Cómo leer `summary.md`

Cada corrida deja `scripts/stock-lab/runs/<run-id>/` (gitignored) con `events.jsonl`, `agents/<nombre>.log`, `reconcile.log`, `reconcile.json` y `summary.md`.

| Sección | Qué mirar |
|---|---|
| Cabecera | `Eventos: N (2xx, fallidos)` y `Productos tocados: X · con descuadre: Y · con bisección: Z`. Una corrida limpia tiene `con descuadre: 0` y `con bisección: 0` |
| Agentes | Exit code por proceso; distinto de 0 = el agente reventó |
| Operaciones por tipo | Total / 2xx / no-2xx por `op` |
| Errores HTTP (status × op) | No debe haber 5xx ni `0 (agent_error)`. Los 400/403/404/409 son rechazos de negocio esperados |
| Descuadres por producto | Tres números que deben coincidir: `esperado(eventos)` (Σ `expected_delta` de los eventos 2xx), `Σmov(run)` (movimientos en la ventana del run) y `current_stock` frente a `último stock_after`. Columnas `delta` y `stock`: `ok` o `DESCUADRE` |
| Primer evento que rompió cada producto | Bisección: `missing_movement`, `delta_mismatch`, `chain_break` o `unattributed_movements`, con el evento o movimiento culpable. Se busca por `response_id` o `ts` en `events.jsonl` |
| Reconcile | Conteo de las nueve vistas al terminar |

Detalle de la bisección y del formato de eventos: [`stock-lab.md`](stock-lab.md).

---

## 6. Informe de producción (solo lectura)

```bash
npm run stock-lab:reconcile -- --target production --read-only
```

- `--target production` exige `--read-only`. Lee el `.env` de la raíz y no crea nada en la base: una transacción `READ ONLY` que termina siempre en `ROLLBACK`, solo `SELECT` (las comprobaciones v2 van inline, adaptadas a las columnas que la base tenga) y una guarda que rechaza cualquier otra sentencia.
- Salida: `scripts/stock-lab/runs/<run-id>/reconcile.json` y `reconcile.md`. Opcionales: `--store <uuid>`, `--limit <n>`, `--run <id>`.
- Por tienda incluye "Productos con diff != 0: N de M", suma de |diff|, los 20 peores, cadenas rotas, ventas y compras sin movimiento, primer descuadre por producto y un bloque "Parches presentes" (`create_sale_with_payments`, `sales.client_request_id`, `stock_movements.seq`, trigger `stock_movements_apply`, vistas de integridad).
- Si la base no tiene `stock_movements.seq`, la cadena se ordena por `created_at, id` y el informe lo avisa (puede dar falsos positivos bajo concurrencia).

Resultado del 2026-10-06 (el análisis fila a fila queda en `.notes/`, no versionado):

| Tienda | Productos con diff (N de M) | Suma \|diff\| | Cadenas rotas | Ventas sin movimiento | Compras sin movimiento | Movimiento sin línea de documento | Reversión sobre venta viva |
|---|---:|---:|---:|---:|---:|---:|---:|
| Bodega Las Luces | 2 de 190 | 11 | 3 | 0 | 0 | 1 | 1 |
| Total (4 tiendas) | 2 de 450 | 11 | 3 | 0 | 0 | 1 | 1 |

Las demás tiendas (Bodega Las Luces QA 0 de 130, Bodega QA Caos 0 de 130, BodegaHub 0 de 0) salieron en 0 en las nueve comprobaciones.

- Productos con diff: "Caja Cigarro Lucky Strike Eclipse" (`current_stock` 2, libro 12, diff −10; primer descuadre 2026-09-19, un `ajuste_entrada +10` que dejó `stock_after` 10 esperando 20) y "Glup Uva 400 ml" (`current_stock` 0, libro −1, diff +1; alta del 2026-10-04 con stock sin `inventario_inicial`, huella de C1).
- Ninguna de las dos fechas coincide con un parche o one-shot del historial (no hay parches entre `20260909` y `20261005`): los dos diff nacen del uso normal sobre una base sin guard (C1/C2). El movimiento sin línea y la reversión sobre venta viva sí son la huella del one-shot `20260830c` (corrección manual de una venta; sin efecto en stock).
- Parches presentes en producción: **ninguno** (17 de 17 comprobaciones AUSENTE): faltan `create_sale_with_payments` y `sales.client_request_id` (`20260909`), `stock_movements.seq`, el trigger del libro y los dos guards de `products.current_stock` (`20261006a`), el modo estricto (`20261006e`) y las nueve vistas (`20261005`, v2 `20261006d`). Sin `seq` la cadena se ordenó por `created_at, id`: las 3 cadenas rotas pueden incluir falsos positivos de orden.
- El informe no ve un físico distinto del sistema con el libro cuadrado (ventas o compras duplicadas, C3–C6, C8, C13).

### One-shot de resincronización

`supabase/patches/20261006z-one-shot-stock-resync.sql` está **escrito y no aplicado**. Por nombre (`one-shot`) queda fuera de `stock-lab:db-up`.

- Corrige solo los 2 productos del informe, listados por id y con guardas.
- Se aplica solo después de desplegar los parches de la sección 7 y de volver a correr el informe.
- Cada fila de la lista declara su acción; el parche ejecuta la declarada y no la deduce de los números ni del signo del libro:

  | Acción | Qué significa | Qué escribe | Producto |
  |---|---|---|---|
  | `stock_from_ledger` | El libro manda: los movimientos están completos y lo que quedó mal es `current_stock` | `current_stock := Σ libro`, sin movimiento. Solo sube el stock | Lucky Strike Eclipse: 2 → 12 |
  | `ledger_from_stock` | El stock manda: la mercancía está contada y al libro le falta un asiento | Un `inventario_inicial` por `current_stock − libro` (siempre > 0); `current_stock` queda como estaba | Glup Uva: `+1`, stock sigue en 0 |

- Lucky Strike (diff −10) se confirma antes con un conteo físico: el parche solo es correcto si el conteo da 12. Si da otra cosa, se quita de la lista y se ajusta por la app.
- Si los números de un producto cambiaron desde el informe, en su fila se actualizan solo `current_stock`, suma del libro y número de movimientos; **la acción no se cambia**. Ejemplo: Glup Uva recibe una compra de 5 antes de aplicar (stock 5, libro 4, 2 movimientos) → sigue siendo `ledger_from_stock`, el parche asienta `+1` y el stock queda en 5. Si la diferencia `current_stock − libro` ya no es la del informe (−10 y +1), el producto se quita de la lista y se revisa.
- Aborta sin tocar nada si: no se ejecuta como `postgres`; la sesión está en `session_replication_role = replica` (los triggers no dispararían); falla una guarda de prerrequisitos; la acción no es una de las dos; el `sku` declarado no es `products.sku` del id; tienda, `current_stock`, suma del libro o número de movimientos no coinciden exactamente con la lista; un `ledger_from_stock` ya cuadra sin marcador; `stock_from_ledger` con libro negativo (nunca stock negativo) o con `current_stock` por encima del libro (bajaría el stock sin movimiento: eso es `ledger_from_stock` o un ajuste de salida por la app); `ledger_from_stock` con `current_stock` por debajo del libro (no se asientan movimientos negativos de arreglo: ajuste por la app).
- Guardas de prerrequisitos: comprueba `20261006a` (trigger `stock_movements_apply` activo y columna `stock_movements.seq`), `20261006e` (trigger y guard sin el modo legado, y los dos triggers de guarda de `products` habilitados) y `20261006d` (vistas v2), y dice cuál falta. `b`, `c`, `f`, `g`, `h` e `i` no los comprueba: eso lo cubre `verify-patches.sql`, que se corre antes.
- Idempotente **por producto**: cada producto listado se salta por separado si ya está aplicado y los demás se procesan con todas sus guardas; el parche solo es un no-op total si se saltan todos. Así se puede aplicar primero la lista con un solo producto (Lucky Strike fuera, a la espera del conteo) y después el archivo completo. Qué cuenta como "ya aplicado":
  - `ledger_from_stock`: el producto tiene un movimiento con el marcador `ONE_SHOT:20261006z-stock-resync` en el `reason` (el asiento del parche).
  - `stock_from_ledger`: no deja marca; se salta si `current_stock` = Σ libro. No hay forma de marcarlo sin tocar el libro (delta 0 no existe, un delta cambia la suma y mueve el stock, escribir en un movimiento histórico es reescribir historia) y el repo no tiene tabla de marcadores. No distingue "lo aplicó el parche" de "lo ajustó otro": en los dos casos no queda nada que escribir.
  - Un `ledger_from_stock` que ya cuadra sin marcador no se da por aplicado: aborta (quitarlo de la lista), salvo que todos los listados cuadren ya.
- Filas esperadas en `stock_chain_breaks` después de aplicarlo, las dos permanentes:
  1. **Inmediata**: el `inventario_inicial` de Glup Uva asentado por el parche (`expected_stock_after` 1, `stock_after` 0). Se reconoce por su `reason`.
  2. **Diferida**: el primer movimiento real de Lucky Strike posterior al parche, sea venta, compra o ajuste. `stock_from_ledger` no toca ningún `stock_after` (no se reescribe historia), así que el último de la cadena sigue en su valor histórico (2 si el salto del 2026-09-19 es el único) mientras `current_stock` pasa a 12. El trigger calcula ese movimiento desde 12 y la vista lo compara con 2: con una venta de 1, `stock_after` 11 frente a `expected_stock_after` 1. La diferencia es siempre +10, lo que corrigió el parche; no es un fallo del trigger ni de esa venta. Solo ocurre una vez: desde el movimiento siguiente la cadena vuelve a ser coherente. Hasta entonces, `current_stock` (12) ≠ último `stock_after` (2) en ese producto, también esperado.

  No se puede evitar la segunda sin salir de las reglas del libro: un asiento marcador con delta 0 no existe (`quantity_delta <> 0`), un ajuste con delta cambiaría la suma del libro (que en este producto está bien) y corregir los `stock_after` posteriores al salto es reescribir historia.
- No corrige las 3 cadenas rotas históricas (incluida la de Lucky Strike del 2026-09-19) ni las dos filas documentales de la venta corregida por `20260830c`.
- Ensayo versionado: `scripts/stock-lab/regression/one-shot-resync-guard.test.ts` ejecuta el archivo real en el lab, dentro de una transacción con rollback, sobre productos de prueba que reproducen los dos casos (camino que escribe, segunda ejecución, guardas y la fila diferida).

---

## 7. Despliegue

Orden obligatorio:

1. `20260909-create-sale-with-payments.sql`
2. `20261005-stock-integrity-views.sql`
3. `20261006a` → `b` → `c` → `d` → `e` → `f` → `g` → `h` → `i`, en ese orden y en la misma ventana. De `a` a `e` no se admite despliegue parcial: entre `a` y `e` el trigger acepta un modo legado transitorio que solo existe para verificar cada parche, y `e` falla ventas y compras si queda viva una RPC antigua.
4. `20261007a-tax-rates.sql` (plan ux-mejoras, SHR-10; después de `i`): catálogo `tax_rates`, `categories.tax_rate_id`, `app_settings.default_tax_rate_id`, `purchase_items.tax_rate_code` y `create_purchase` con `tax_rate_code`. Migra datos la primera vez; revisar después `select * from public.tax_rates_pending_review;` (alícuotas `otro-<pct>` inactivas creadas para porcentajes distintos de 0, 8 y 16).
5. `verify-patches.sql` con todas las filas en `ok = true` (en el lab: `ok=100 fail=0`).
6. Deploy del BFF.

Reaplicar un parche de la serie: cada parche reinstala su propia versión de las funciones que define y pisa la de los parches posteriores. Regla única: **tras reaplicar cualquiera de `a`…`h`, reaplicar en orden todos los posteriores hasta `i` y correr `verify-patches.sql`** (son idempotentes). Por qué: `a` reinstala el modo legado que quita `e`; `b` y `c` reinstalan RPC que redefinen `f`, `g` y `h`; `f`, las que redefinen `g` y `h`; `g`, las que redefine `h`. `20261007a` redefine `create_purchase` a partir de `h`: tras reaplicar `c`, `f` o `h` hay que reaplicar también `20261007a`; y `i` puede reaplicarse sin más (regenera los triggers de NaN, incluidos los de `tax_rates`). Ejemplo de lo que pasa si se salta uno: reaplicar `c` y después solo `g` y `h` deja `cancel_purchase` y `return_purchase` en la versión de `c`, sin el rechazo de compras con pagos activos (R3), porque su última definición está en `f`.

El BFF desplegado sin parches sigue cobrando (cae al camino en dos pasos), pero sin idempotencia real ni las garantías nuevas.

Riesgos:

| Riesgo | Detalle |
|---|---|
| Bloqueos al aplicar en caliente | `20261006a` toma `lock table stock_movements in share row exclusive mode` mientras hace el backfill de `seq`; `20261006i` crea triggers en 21 tablas y las bloquea a todas. Aplicar con la tienda sin operar |
| Numeración nueva de documentos | `V-YYYYMMDD-NNNNNN` y `C-YYYYMMDD-NNNNNN` por secuencia; cambia respecto al formato por reloj |
| `clientRequestId` obligatorio | `POST /api/sales` responde 400 sin la clave. Cualquier cliente externo (móvil, scripts) debe enviarla |
| Devoluciones fuera del ajuste libre | `devolucion_cliente` y `devolucion_proveedor` ya no se ofrecen en el modal de ajuste y la RPC responde `PT400` sin `p_sale_id`/`p_purchase_id` |
| IVA fuera del catálogo (`20261007a`) | `create_purchase` responde `PT400` si el `tax_rate` de una línea no es el `pct` de una alícuota activa de la tienda, y `categories` responde `PT400` al guardar un `tax_rate` sin alícuota. Una categoría migrada a `otro-<pct>` (inactiva) no puede comprar con ese porcentaje hasta que el admin active la alícuota o reasigne la categoría |
| One-shots futuros | No acompañar un movimiento con `update products set current_stock`: el libro es la fuente. Usar `adjust_stock` o insertar el movimiento (el trigger mueve el stock). Un `stock_after` escrito a mano se ignora. Excepción documentada: `20261006z` (acción `ledger_from_stock`) devuelve `current_stock` a su valor previo y fija el `stock_after` de su propio asiento, porque la unidad ya estaba contada en el stock; el porqué está en la cabecera del parche |
| Escritura directa cerrada | `sales`, `purchases`, `payments`, sus líneas, caja y baúl solo se escriben por RPC; quedan dos updates por columnas del BFF (`sales.notes`, metadatos de `payments`) |

---

## 8. Estado del ciclo de calidad y hallazgos abiertos

Pasada 3: limpia (HEAD `a23215f`; 0 respuestas 5xx, reconcile 0/9 en todas las olas, `stock-lab:test` 245/245). Pasada 4: **incompleta por disco**: el gate, la ola serial y la matriz salieron limpias, pero el host se quedó sin espacio a mitad de la ola 8.2 (semilla 42) y el resto de olas no se ejecutó. No hay dos pasadas limpias consecutivas.

Abiertos, fuera del alcance del libro de stock (requieren decisión de producto):

| id | Sev. | Qué es |
|---|---|---|
| P4-1 | alta | `handle_new_user()` (`20260716c-seed-superadmin.sql`) toma `role` y `store_id` de `raw_user_meta_data`, que el cliente controla en el signup: alta como admin de cualquier tienda si el signup público está activo |
| P4-2 | media | Un vendedor por API puede vender con `discountRef = subtotal − 0,01` (C19 solo rechaza descuento ≥ subtotal) |
| P4-3 | media | `register_payment` no tiene clave de idempotencia: un reintento de abono duplica pago y asiento |
| R15 / M2 | media | Caja: anular o devolver un cobro en efectivo de una sesión cerrada y sin transferir deja el cierre teórico por encima de los cobros vivos; una venta cuyo cierre ya se transfirió no se puede devolver. Ver [`cuadre-baul.md`](cuadre-baul.md) |
| N7 | media | Un usuario desactivado conserva la lectura de su tienda por PostgREST (no escribe ni cruza tiendas) |

Bajas (lista corta; el detalle está en `.notes/stock-integrity-gtm/rpc-review.md` y en `qa/pass-3/33-rpc-review.txt`, `qa/pass-3/34-final-audit.txt`, `qa/pass-4/43-rpc-review.txt`, `qa/pass-4/44-final-audit.txt` de esa carpeta, no versionada):

| id | Qué es |
|---|---|
| R8 | Updates de `sales`/`purchases`/`payments`/`store_vaults` sin `store_id` en el `where` (la fila ya estaba bloqueada por tienda) |
| R10 | Trigger BEFORE: `insert … on conflict do nothing` movería stock sin fila |
| R13 | `service_role` conserva escritura directa sobre documentos |
| R14 | `inventario_inicial` repetible sobre un producto con historia |
| R16 | Orden de locks pago → compra en `cancel_payment_apply` |
| R18 | Claves de idempotencia quemadas tras cancelar; `stock_request_keys` no se purga |
| P3-1 | NaN heredado de antes del parche no corregible por las RPC de precio |
| Q1 | `verify-patches` no comprueba `tgenabled` de los triggers del libro |
| Q2 | La conexión del informe de producción no fija `statement_timeout` |
| otras | N5, N8–N11, B1–B14, L1–L9, P1–P7, P3-2…P3-6, P4-4…P4-8: solo en los archivos de evidencia |

Carencias de producto conocidas (salen como `finding` en los runners, no como fallo): producto inactivo acepta compras y ajustes; `pendiente_pago` abandonada retiene stock sin vencimiento; clave de idempotencia opcional en compras, ajustes y conversiones.
