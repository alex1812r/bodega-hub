# Integridad de inventario — plan de ejecución autónoma (tienda de prueba + agentes en paralelo)

> **Para el humano:** abre Claude Code en la raíz del repo y escribe:
> `Ejecuta docs/agent-prompts/stock-integrity-gtm.md de principio a fin. No te detengas hasta cumplir la sección 12.`
> Lo único que acelera el arranque: tener Docker Desktop corriendo (para `supabase start`). Si no está, el plan te lo pide una vez y usa el plan B (proyecto Supabase de staging) o te espera trabajando en lo que no depende de la base.

---

## 0. Misión

Síntoma reportado: **se registran compras, ventas y ajustes, pero el stock no siempre se mueve.** La operación queda guardada (la compra muestra su cantidad, la venta sus ítems), pero `products.current_stock` no cambia, o `stock_movements` no tiene la fila, o la tiene con otro valor. Hay más de diez parches one-shot en `supabase/patches/` corrigiendo stock a mano: el problema es sistémico, no puntual.

Objetivo en tres partes, en este orden:

1. **Reproducir y aislar.** Montar una base de datos de prueba idéntica a producción (esquema + parches), una tienda de prueba con productos variados, y someterla a operaciones reales — por API y por navegador, en serie y **en paralelo** — hasta que el libro de inventario deje de cuadrar. Cada descuadre se captura con la operación exacta que lo produjo.
2. **Corregir la causa raíz** (RPC, servicio, UI o las tres) con test de regresión por cada causa encontrada.
3. **Dejar la red de seguridad instalada:** invariantes de inventario verificables en SQL, un script de reconciliación que corre contra cualquier base (incluida producción, solo lectura), y una suite de carga concurrente reutilizable.

Entregable: rama `fix/stock-integrity` lista para merge (parches SQL, código, tests, script de reconciliación, suite de agentes, docs) + reporte final con la lista de causas encontradas y un **informe de producción** (solo lectura) que diga cuántos productos tienen hoy el stock descuadrado y por cuánto. **No terminas hasta cumplir la sección 12.**

---

## 1. Reglas de operación

1. **Autonomía total.** Sin confirmaciones ni opciones. Decide y ejecuta. Preguntas permitidas al humano: solo las de 1.6, una vez cada una, sin detenerte.
2. **Silencio operativo.** Única salida: reporte final (sección 13, ≤ 50 líneas).
3. **Economía de tokens.** `grep`/`sed -n`. Subagentes devuelven ≤ 15 líneas. Los agentes operadores no narran: escriben eventos en un log JSONL y punto.
4. **Producción es solo lectura.** Contra el proyecto Supabase de producción solo se ejecutan `select` (el informe de la sección 8.4). Jamás `update/insert/delete`, jamás aplicar parches, jamás `reset-data.sql`. Si una credencial de producción aparece en `.env.local`, los scripts de prueba deben negarse a correr escrituras contra esa URL (guarda `STOCK_TEST_ALLOW_WRITES_HOST` = host de la base de prueba y aborta si no coincide).
5. **La base de prueba es desechable.** Se destruye y recrea en cada ciclo completo.
6. **Preguntas permitidas:** (a) si no hay Docker ni forma de `supabase start` y tampoco existe `STAGING_SUPABASE_URL`: *"Necesito Docker Desktop corriendo para levantar Supabase local, o un proyecto Supabase de staging en STAGING_SUPABASE_URL / STAGING_SERVICE_ROLE_KEY en .env.local. Mientras tanto preparo scripts, invariantes y tests unitarios."* (b) si el informe de producción requiere la service key y no está: *"Para el informe de descuadre en producción (solo lectura) necesito SUPABASE_SERVICE_ROLE_KEY en .env.local."*
7. **Git.** Rama `fix/stock-integrity` desde `main`. **Antes de empezar, lee `git log main..fix/sale-stock-hardening` y su diff:** ya hay trabajo previo sobre este problema (`create_sale` con pagos en una transacción, guardas contra drift en el POS). Si esa rama no está mergeada, parte de ella (`git checkout -b fix/stock-integrity fix/sale-stock-hardening`) para no duplicar ni pisar. Commits pequeños en inglés imperativo. Push permitido; nunca merge a `main`, nunca force push, nunca tocar Vercel.
8. **Next 16 y versiones instaladas.** Leer `node_modules/next/dist/docs/` antes de tocar rutas; leer `.d.ts` de cualquier librería nueva.
9. **No rompas lo existente.** `npm run typecheck && npm run lint && npm test && npm run build` en verde al cerrar cada fase.
10. **Navegador para los flujos de UI.** Claude in Chrome, Playwright MCP o script Playwright. La UI también se prueba porque una de las hipótesis (sección 5) es que la UI muestra éxito cuando el RPC falló.
11. **Cada hallazgo = test de regresión.** Sin excepción. Un bug corregido sin test que lo reproduzca no cuenta como corregido.

---

## 2. Contexto obligatorio (una lectura)

| Archivo | Qué extraer |
|---------|-------------|
| `AGENTS.md`, `docs/README.md`, `docs/modules-catalog.md` (§Inventario, §Productos, §Ventas, §Compras, §RPC) | Endpoints, hooks, RPC |
| `docs/database-design.md` §stock, `docs/supabase-schema-audit.md` | Modelo de `stock_movements` (`quantity_delta`, `stock_after`, `sale_id`, `purchase_id`, `conversion_id`), vista `stock_card` |
| `docs/supabase-setup.md` | Cómo se levanta y migra el proyecto; que **no hay auto-deploy** de parches |
| `docs/cuadre-baul.md` §3 | Precedente: contadores denormalizados sin reconciliación (mismo patrón que `current_stock`) |
| `supabase/supabase-schema.sql` → `create_sale`, `create_purchase`, `receive_purchase`, `adjust_stock`, `cancel_sale`, `return_sale`, `cancel_purchase`, `return_purchase`, trigger(s) sobre `products`/`stock_movements`, enum `stock_movement_type` | Versión base de cada RPC |
| Parches, en orden: `20260716-multi-store`, `20260810-rpc-store-context`, `20260810c-purchase-trust-frontend`, `20260811-pack-unit-conversion`, `20260811a-…enum`, `20260813b-product-cost-with-line-tax` (redefine `create_purchase` y `receive_purchase`), `20260813h-fix-adjust-stock-store-id`, `20260904c-sale-integrity`, `20260905-purchase-line-subtotal-ref`, `20260909-create-sale-with-payments` (si existe) | **Versión vigente** de cada RPC. Anota en `.notes/rpc-versions.md` qué parche define la última versión de cada función — es el mapa del problema |
| Todos los `*one-shot*` que tocan `stock_movements` o `current_stock` | Cada uno es un síntoma documentado: extrae qué pasó (cantidad mal, movimiento faltante, producto equivocado, doble descuento) y conviértelo en un escenario de la sección 8 |
| `scripts/e2e-bodegon/*` (`client.ts`, `phases.ts`, `data.ts`), `docs/backend-e2e-bodegon.md` | Cliente HTTP con `x-demo-role`/login y fases existentes: **se reutiliza**, no se reescribe |
| `scripts/smoke-post-patches.ts`, `supabase/patches/verify-patches.sql`, `apply-all-pending.sql` | Cómo se verifican hoy los parches |
| `supabase/seed.sql`, `seed-field-research-jul2026.sql`, `reset-data.sql` | Datos de arranque y cómo limpiar |
| `src/modules/sales/services/sales.server.ts`, `purchases/services/purchases.server.ts`, `inventory/services/inventory.server.ts` (+ mocks y tests) | Cómo el BFF llama cada RPC, qué hace con el error, si hay reintentos |
| `src/modules/sales/sale-create/**` (checkout, `useCreateSale`), `purchases/purchase-create/**`, `inventory/inventory-movements/**` | Qué hace la UI tras éxito/error; si invalida queries; si permite doble submit |
| `src/modules/products/products-import/**`, `docs/frontend-product-bulk-import.md` | Si el `stock_inicial` del import genera movimiento `inventario_inicial` |
| `docs/dev-seed-users.md`, `.env.local.example` | Credenciales y variables |

---

## 3. Decisiones fijas

| Tema | Decisión |
|------|----------|
| Base de prueba | **Supabase local** vía CLI (`npx supabase init` si falta `supabase/config.toml`, `npx supabase start`). Se construye con `supabase-schema.sql` + **todos los parches estructurales en orden cronológico** (excluyendo `*one-shot*`, `*query*`, `*diagnostic*`, `apply-all-pending`, `verify-patches`) + `seed.sql` + `20260716c-seed-superadmin`. Script `scripts/stock-lab/db-up.sh` (y `.ps1`) que hace todo y termina ejecutando `verify-patches.sql`. **Esto también deja resuelto el problema de que el esquema base está desactualizado**: `db-up` es la receta reproducible. |
| Plan B | Si no hay Docker: proyecto Supabase de **staging** (nunca producción) con `STAGING_SUPABASE_URL` + `STAGING_SERVICE_ROLE_KEY`; `db-up` aplica el mismo pipeline por `psql`/API SQL. |
| Tienda de prueba | `stores.slug = 'lab'`, creada por `scripts/stock-lab/seed-lab.ts` con: 40 productos en 6 categorías (con y sin IVA, con y sin código de barras, 5 pares empaque↔unidad vinculados en `product_pack_conversions`, 3 inactivos, 2 con stock 0, 2 con stock mínimo alto), 3 proveedores con catálogo y empaques, 5 clientes + consumidor final, 2 cajas registradoras, usuarios `lab-admin`, `lab-vendedor-1`, `lab-vendedor-2`, `lab-almacen`, `lab-contador`. Stock inicial cargado **por el camino real** (`adjust_stock` tipo `inventario_inicial` o import), nunca por `update products set current_stock`. |
| BFF | `npm run dev` apuntando a la base de prueba (`.env.stock-lab` con `NEXT_PUBLIC_SUPABASE_URL` local, `API_DATA_SOURCE=supabase`, `ALLOW_DEMO_AUTH=false`: los agentes hacen **login real** con los usuarios lab, para que `auth.uid()`, RLS y `assert_store_context()` se ejerciten de verdad). Puerto 3100 para no chocar con el dev server habitual. |
| Libro mayor esperado | Cada agente operador escribe cada operación que ejecuta (y su resultado HTTP) en `scripts/stock-lab/runs/<run-id>/events.jsonl`. El Auditor reconstruye el stock esperado **solo desde esos eventos** y lo compara contra la base. Tres fuentes, tres números por producto: esperado (eventos), `products.current_stock`, `Σ stock_movements.quantity_delta`. Los tres deben coincidir. |
| Invariantes | Definidos en SQL en `supabase/patches/YYYYMMDD-stock-integrity-views.sql` (sección 4) y ejecutables contra cualquier base. |
| Concurrencia | Agentes operadores son procesos Node (`tsx`) independientes, lanzados en paralelo por el Orquestador (`scripts/stock-lab/run.ts --agents 5 --minutes 10 --seed 42`), con semilla para reproducir. |
| Corrección | Preferir arreglar en la RPC (fuente de verdad) y añadir **guardas en base de datos** (trigger que mantiene `current_stock` desde `stock_movements`, o al revés, pero una sola fuente de verdad) sobre parches en la UI. La UI se corrige donde oculte errores o permita doble envío. |
| Producción | Informe de descuadre con la vista de reconciliación, solo lectura, con `SUPABASE_SERVICE_ROLE_KEY`. Un parche `one-shot` de corrección masiva **se escribe pero no se aplica**; se lista en el reporte con el número de productos afectados. |

---

## 4. Invariantes de inventario (parche `YYYYMMDD-stock-integrity-views.sql`)

Vistas, todas filtrables por `store_id`:

| Vista | Qué verifica |
|-------|--------------|
| `stock_reconciliation` | Por producto: `current_stock`, `ledger_stock = Σ quantity_delta`, `diff`, nº de movimientos, último movimiento. Filas con `diff <> 0` son descuadres. |
| `stock_chain_breaks` | Movimientos cuyo `stock_after` ≠ `stock_after` del movimiento anterior del mismo producto + `quantity_delta` (orden por `created_at, id`). Detecta escrituras fuera de las RPC y carreras. |
| `sales_without_movements` | `sale_items` de ventas no `cancelada`/`borrador` sin movimiento `venta` con ese `sale_id` y `product_id`, o con `quantity_delta ≠ -quantity`. |
| `purchases_without_movements` | `purchase_items` de compras `recibido` sin movimiento `compra` o con `quantity_delta ≠ quantity` normalizada (empaque × unidades). |
| `movements_without_document` | Movimientos `venta`/`compra` cuyo `sale_id`/`purchase_id` es nulo o apunta a un documento cancelado sin movimiento inverso. |
| `reversal_mismatches` | Ventas `cancelada`/`devuelta` y compras `cancelado`/`devuelto` cuyos movimientos inversos no suman exactamente el opuesto del original. |
| `conversion_mismatches` | Pares `conversion_salida`/`conversion_entrada` con el mismo `conversion_id` que no respetan `units_per_pack`. |
| `negative_stock` | Productos con `current_stock < 0` o `stock_after < 0`. |
| `cross_store_movements` | Movimientos cuyo producto pertenece a otra tienda que el documento. |

Función `stock_integrity_report(p_store_id uuid default null) returns jsonb` que devuelve el conteo de cada vista. Y `scripts/stock-lab/reconcile.ts` que la llama, imprime una tabla y guarda `runs/<id>/reconcile.json`. Es el **oráculo**: si devuelve todo en 0, el inventario cuadra.

---

## 5. Hipótesis a descartar (en este orden; cada una con un escenario que la reproduce)

| # | Hipótesis | Cómo se prueba |
|---|-----------|----------------|
| H1 | La compra se crea con `status = pedido` y el stock solo entra en `receive_purchase`; la UI o el usuario no completan el "recibir" y la compra "parece registrada" sin stock | Crear compra `pedido` por UI y por API; revisar si la pantalla indica claramente que falta recibir; revisar si `create_purchase` con `status = recibido` sí mueve stock |
| H2 | Modo **empaque** normaliza mal: `pack_count × units_per_pack` no coincide con `quantity_delta`, o se suma 1 por empaque | Compras en modo empaque con distintos `units_per_pack`; comparar movimiento |
| H3 | `store_id` en la RPC: el `update products` filtra por una tienda y el producto está en otra, o `assert_store_context()` devuelve otra tienda para el usuario (precedente: `20260813h-fix-adjust-stock-store-id`) | Operar con usuarios lab de la tienda `lab` mientras existe la tienda `default`; revisar cada `update public.products ... where store_id = …` en las RPC vigentes |
| H4 | `cancel_sale`/`return_sale`/`cancel_purchase`/`return_purchase` no revierten, revierten doble o revierten sin movimiento | Cancelar y devolver cada tipo, parcial y total, dos veces seguidas |
| H5 | Conversión empaque→unidad desbalancea (`conversion_salida` sin su `entrada` o con cantidad distinta) | Conversiones normales, con stock insuficiente, concurrentes |
| H6 | **Carrera**: dos ventas simultáneas del mismo producto leen el mismo `current_stock` y una pierde el decremento (falta `select … for update` o el decremento no es `current_stock = current_stock - q`) | 2–5 agentes vendiendo el mismo producto al mismo tiempo durante minutos; comparar esperado vs real |
| H7 | `stock_after` y `current_stock` divergen porque algo escribe uno sin el otro (one-shots, trigger ausente) | `stock_chain_breaks` tras cada ola |
| H8 | La UI muestra éxito cuando el RPC falló, o reintenta y duplica (doble submit, reintento de TanStack en mutaciones, timeout del BFF con la transacción ya confirmada) | Navegador: doble clic, red lenta (throttling), cortar la red justo tras enviar; comparar lo que la UI dice con la base |
| H9 | Import Excel / creación de producto con `currentStock` escriben `current_stock` **sin** movimiento `inventario_inicial`, así que el libro mayor nace descuadrado | Crear productos por formulario con stock inicial y por import; revisar `stock_reconciliation` |
| H10 | Ventas `pendiente_pago` o `borrador` descuentan (o no) stock de forma inconsistente con su estado final | Crear venta sin pago, pagar después, cancelar sin pagar |
| H11 | `receive_purchase` ejecutado dos veces (doble clic, reintento) suma stock dos veces | Llamar `receive` dos veces, en serie y en paralelo |
| H12 | RLS o `security definer` sin `set search_path` hacen que el `update` afecte 0 filas sin error | Revisar `get diagnostics`/`found` tras cada `update` en las RPC; probar como `vendedor` y como `admin` |

Cada hipótesis se cierra con una de tres etiquetas en `.notes/hypotheses.md`: **confirmada** (con el evento que la reproduce y el commit que la corrige), **descartada** (con el escenario que la cubrió y pasó), o **no reproducible** (con lo intentado).

---

## 6. Fases

Cada fase cierra con verde en typecheck/lint/test/build y commit.

### Fase 0 — Preparación
Rama según 1.7. Lectura de contexto. `.notes/rpc-versions.md` (qué parche define la versión vigente de cada RPC de stock) y `.notes/hypotheses.md`. Inventario de one-shots → escenarios de la sección 8 (tabla `.notes/oneshots-to-scenarios.md`).

### Fase 1 — Base de prueba reproducible
`scripts/stock-lab/db-up.*`, `db-down.*`, `db-reset.*`. Pipeline: schema → parches estructurales en orden → seed → superadmin → `verify-patches.sql`. Si un parche falla por orden o dependencia, se documenta en `docs/supabase-setup.md` el orden correcto (y se corrige `apply-all-pending.sql`). Resultado: `npm run stock-lab:db-up` deja una base limpia en < 3 min. Commit.

### Fase 2 — Invariantes
Parche de vistas + función (sección 4), aplicado a la base de prueba. `scripts/stock-lab/reconcile.ts`. Tests SQL básicos: inserta un descuadre artificial en la base de prueba y verifica que la vista lo detecta. Commit.

### Fase 3 — Tienda y agentes
`seed-lab.ts` (sección 3). `scripts/stock-lab/agents/`: `base.ts` (login real, cliente HTTP reutilizando `e2e-bodegon/client.ts`, logger JSONL, generador aleatorio con semilla), y un agente por rol (sección 7). `run.ts` que lanza N agentes en paralelo, espera, corre `reconcile.ts`, y produce `runs/<id>/summary.md` con: operaciones por tipo, errores HTTP por tipo, descuadres encontrados y **el primer evento que rompió cada producto** (bisección sobre `events.jsonl` ordenado por tiempo contra la cadena de `stock_after`). Commit.

### Fase 4 — Reproducción
1. **Ola serial** (1 agente, 200 operaciones mixtas): descarta errores de lógica básica (H1, H2, H4, H5, H9, H10, H11, H12).
2. **Ola concurrente** (5 agentes, 10 min, semilla fija): H6, H7, H11.
3. **Ola UI** (Navegante, sección 8.3): H8.
4. **Ola one-shots** (escenarios derivados de los parches históricos).
Cada ola termina con `reconcile`. Cada descuadre → entrada en `hypotheses.md` con el evento mínimo que lo reproduce → **test de regresión que falla** (jest contra el mock si la lógica está en el BFF; SQL/pgTAP o script contra la base de prueba si está en la RPC) antes de corregir.

### Fase 5 — Corrección
Por cada causa confirmada: fix mínimo en la capa correcta, test de regresión en verde, commit `Fix: <causa>`. Además, independientemente de lo encontrado, instalar la red de seguridad:
- **Una sola fuente de verdad**: trigger `before insert on stock_movements` que fija `stock_after` desde el `current_stock` bloqueado (`select … for update`) y `after insert` que actualiza `products.current_stock`; las RPC dejan de actualizar `current_stock` a mano (o al revés, pero una sola). Decide tras leer las RPC vigentes; documenta.
- `select … for update` en todo producto tocado por `create_sale`, `create_purchase`, `receive_purchase`, `adjust_stock`, `convert_pack_to_units`, cancelaciones y devoluciones, en **orden determinista por `product_id`** para evitar deadlocks.
- Idempotencia: `receive_purchase` rechaza si ya está `recibido`; `create_sale` acepta una `p_client_request_id` única por intento (índice único) para que un reintento no duplique.
- `found`/`get diagnostics row_count = 1` tras cada `update products`; si es 0, `raise exception`.
- UI: botón deshabilitado durante la mutación, sin `retry` en mutaciones, el estado de éxito se toma de la respuesta del servidor y la lista/stock se invalida.
- Para productos creados con stock inicial: movimiento `inventario_inicial` obligatorio (RPC `create_product_with_stock` o trigger).

### Fase 6 — Verificación (sección 10) hasta 2 pasadas limpias con las cuatro olas en 0 descuadres.

### Fase 7 — Producción (solo lectura) y entrega
`reconcile.ts --target production --read-only` con la service key: aplica las vistas **en una transacción que hace rollback** (o ejecuta sus `select` inline sin crear objetos) y guarda `runs/prod-<fecha>/reconcile.json`. Escribe `supabase/patches/YYYYMMDD-one-shot-stock-resync.sql` que corrige `current_stock` desde el libro mayor **solo para los productos listados**, con marcador de idempotencia, **sin ejecutarlo**. Docs (sección 11). Push. Reporte.

---

## 7. Agentes

| Agente | Rol | Qué hace |
|--------|-----|----------|
| **Orquestador** | sesión principal | Coordina, lanza olas, integra, decide, escribe el reporte |
| **Arqueólogo** | fase 0 | Mapa de versiones de RPC y escenarios desde one-shots |
| **Constructor DB** | fases 1–2 | `db-up`, invariantes, `reconcile` |
| **Operador Vendedor ×2** (`lab-vendedor-1/2`) | fase 4 | Abre caja; vende por POS/API productos aleatorios (sesgados hacia 5 "productos calientes" compartidos para forzar carreras); pagos mixtos; algunas ventas `pendiente_pago`; cancela/devuelve el 10 %; cierra caja |
| **Operador Comprador** (`lab-admin`) | fase 4 | Compras `pedido` y `recibido`, unidad y empaque, recibe pedidos (a veces dos veces), cancela/devuelve el 10 %, registra pagos |
| **Operador Almacén** (`lab-almacen`) | fase 4 | Ajustes entrada/salida con motivo, conversiones empaque→unidad (algunas sin stock), crea productos con stock inicial, desactiva/reactiva |
| **Operador Caos** (`lab-admin`) | fase 4 | Sección 9: doble envío, reintentos, timeouts, borrar categorías con productos, cambiar precio en medio de una venta, cambiar tasa, vender producto inactivo |
| **Navegante** | fase 4 ola UI | Flujos de 8.3 en navegador con throttling y capturas |
| **Auditor de inventario** | fin de cada ola | `reconcile.ts` + bisección del primer evento que rompe cada producto; devuelve lista `producto → evento → hipótesis` |
| **Reparador** | fase 5 | Test de regresión que falla → fix mínimo → verde → commit |
| **Revisor de RPC** | fase 5 | Lee cada RPC vigente línea a línea buscando: `update` sin `for update`, sin `store_id`, sin verificar `found`, orden de bloqueo, `search_path`; devuelve hallazgos con línea |
| **Auditor final** | fase 6 | `git diff main...HEAD`: que ninguna RPC toque `current_stock` fuera de la fuente de verdad; que no haya escrituras a producción en los scripts; que los tests cubran cada causa |

Los operadores escriben `events.jsonl` con `{ts, agent, op, payload, status, response_id, expected_delta: {product_id: n}}` y nunca narran. No piden ayuda. El Orquestador nunca acepta "no se pudo reproducir" sin las cuatro olas ejecutadas y las 12 hipótesis etiquetadas.

---

## 8. Escenarios

### 8.1 Serie (todos, por API, un agente)
Para cada tipo de producto (con IVA, sin IVA, con empaque, inactivo, stock 0): venta pagada · venta `pendiente_pago` luego pagada · venta cancelada antes y después de pagar · devolución parcial y total · compra `recibido` unidad · compra `recibido` empaque (units_per_pack 6, 12, 24) · compra `pedido` → recibir · recibir dos veces · cancelar compra recibida · devolver compra parcial · ajuste entrada/salida · conversión empaque→unidad normal y sin stock · producto nuevo con stock inicial por formulario y por import · venta con cantidad > stock (debe fallar y no mover) · venta de producto inactivo (debe fallar). Tras **cada** operación: `reconcile` debe seguir en 0.

### 8.2 Concurrencia (5 agentes, 10 min, semilla 42; luego semillas 7 y 99)
Los 5 productos calientes reciben ventas de 2 vendedores, compras del comprador, ajustes del almacén y caos al mismo tiempo. Métrica: 0 descuadres, 0 `stock_chain_breaks`, 0 stock negativo salvo que el negocio lo permita (verificar en `create_sale`), y que toda venta rechazada por stock insuficiente **no** haya dejado movimiento.

### 8.3 UI (Navegante)
1. POS: vender → verificar en `/inventory/movements` y en el detalle del producto que el movimiento existe y el stock bajó exactamente. 2. POS con red lenta (throttling 3G): doble clic en confirmar → una sola venta. 3. POS: cortar la red justo después de confirmar → al volver, la UI y la base coinciden (o la UI avisa que no se sabe y permite verificar). 4. Compra en modo empaque por UI → recibir → movimiento con unidades correctas. 5. Compra `pedido` → ¿la UI deja claro que el stock no entró? (si no, hallazgo de UX, severidad media). 6. Ajuste desde inventario → movimiento. 7. Conversión desde detalle de producto. 8. Cancelar venta desde detalle → movimiento inverso visible. 9. Crear producto con stock inicial → aparece movimiento `inventario_inicial`. 10. Import Excel con `stock_inicial` → idem.

### 8.4 Producción (solo lectura)
`reconcile.ts --target production --read-only`. Informe: productos con `diff ≠ 0`, suma absoluta, los 20 peores, cadenas rotas, ventas/compras sin movimiento, fecha del primer descuadre por producto (para correlacionar con los parches del historial).

---

## 9. Caos (Operador Caos + Navegante)

| # | Caso | Esperado | Severidad |
|---|------|----------|-----------|
| 9.1 | `POST /api/sales` idéntico dos veces en 50 ms | Una venta, un movimiento (idempotencia) | Alta |
| 9.2 | `PATCH /api/purchases/[id]/receive` dos veces en paralelo | Un solo ingreso de stock; el segundo 409/400 | Alta |
| 9.3 | Vender cantidad = stock desde 2 agentes a la vez | Una pasa, otra falla por stock; nunca negativo | Alta |
| 9.4 | Cancelar venta mientras otro agente la devuelve | Una sola reversión | Alta |
| 9.5 | Ajuste de salida mayor al stock | Rechazado sin movimiento | Media |
| 9.6 | Conversión con `units_per_pack` cambiado entre lectura y escritura | Usa el valor bloqueado en la transacción | Media |
| 9.7 | Cambiar `store_id` del producto a mano (simula dato corrupto) y vender | La RPC falla con mensaje claro; no mueve stock de otra tienda | Alta |
| 9.8 | Timeout del BFF (simular `statement_timeout` corto) con la transacción ya confirmada | La UI no reintenta a ciegas; con `client_request_id` el reintento devuelve la misma venta | Alta |
| 9.9 | Usuario `vendedor` llama `adjust_stock` por API | 403, sin movimiento | Alta |
| 9.10 | Venta con 30 líneas de productos distintos mientras otro agente vende los mismos en orden inverso | Sin deadlock (orden de bloqueo determinista) o deadlock detectado y reintentado por la RPC | Media |
| 9.11 | Desactivar un producto con una venta `pendiente_pago` abierta | La venta se puede pagar o cancelar; el stock cuadra | Baja |
| 9.12 | Borrar categoría (soft) con productos y vender uno | Funciona o falla limpio; sin movimiento huérfano | Baja |
| 9.13 | 1.000 operaciones en 2 min (carga) | `reconcile` en 0; p95 de `create_sale` documentado | Media |

---

## 10. Ciclo de calidad (hasta 2 pasadas limpias consecutivas)

1. `npm run typecheck && npm run lint && npm test && npm run build`.
2. `npm run stock-lab:db-reset && npm run stock-lab:seed` → base limpia.
3. Olas 8.1, 8.2 (tres semillas), 8.3, 9 → `reconcile` en 0 en todas; `summary.md` por corrida.
4. Revisor de RPC y Auditor final sin hallazgos altos/medios.
5. Reparación → volver a 1.

---

## 11. Documentación a entregar

- `docs/stock-integrity.md`: causas encontradas (con evento reproductor y commit), invariantes, cómo correr `db-up`/`seed`/`run`/`reconcile`, cómo leer `summary.md`, cómo correr el informe de producción, y la fuente de verdad del stock tras el cambio.
- `docs/supabase-setup.md`: receta `db-up` como forma oficial de levantar una base igual a producción; orden de parches.
- `docs/modules-catalog.md` §Inventario: vistas de integridad y RPC modificadas.
- `README.md`: scripts `stock-lab:*`.
- `AGENTS.md`: una línea: "Antes de tocar RPC de stock, leer `docs/stock-integrity.md` y correr `npm run stock-lab:run`."

---

## 12. Definición de hecho

- [ ] `db-up` levanta una base igual a producción desde cero en < 3 min; orden de parches documentado.
- [ ] Vistas de invariantes + `stock_integrity_report` + `reconcile.ts`, con test que detecta un descuadre inyectado.
- [ ] Tienda `lab` sembrada por caminos reales; 5 agentes operando en paralelo con semilla reproducible; `events.jsonl` + `summary.md` por corrida.
- [ ] Las 12 hipótesis etiquetadas (confirmada/descartada/no reproducible) con evidencia.
- [ ] Cada causa confirmada: test de regresión que fallaba y ahora pasa; fix en la capa correcta.
- [ ] Fuente de verdad única para `current_stock`; `for update` con orden determinista; `receive_purchase` idempotente; `create_sale` idempotente por `client_request_id`; `inventario_inicial` obligatorio.
- [ ] Cuatro olas + caos en 0 descuadres, dos pasadas seguidas.
- [ ] Flujos UI 8.3 con capturas; doble clic y red lenta sin duplicados.
- [ ] Informe de producción (solo lectura) generado y parche de resincronización escrito sin aplicar.
- [ ] Docs de la sección 11; typecheck/lint/test/build en verde; rama pusheada sin merge.

---

## 13. Reporte final (≤ 50 líneas)

```text
INTEGRIDAD DE INVENTARIO — LISTO PARA REVISIÓN
Rama: fix/stock-integrity (N commits, parte de fix/sale-stock-hardening: sí/no)
Base de prueba: supabase local | staging · db-up en M min · parches aplicados: K (orden en docs/supabase-setup.md)

Causas confirmadas (cada una con evento, commit y test):
  C1. … (hipótesis Hx) — capa: RPC|BFF|UI
  C2. …
Hipótesis descartadas: Hx, Hy, … · No reproducibles: …

Olas: serie ✓ · concurrente (semillas 42/7/99) ✓ · UI ✓ · caos N/13 · carga p95 create_sale = X ms
Red de seguridad instalada: trigger fuente de verdad · for update ordenado · receive idempotente · client_request_id · inventario_inicial

PRODUCCIÓN (solo lectura, fecha):
  productos descuadrados: N de M · suma |diff| = X unidades · cadenas rotas: Y · ventas sin movimiento: Z
  primer descuadre detectado: <fecha> (coincide con parche …)
  parche de resincronización escrito: supabase/patches/<fecha>-one-shot-stock-resync.sql (NO aplicado)

Para desplegar:
1. Aplicar en SQL Editor, en orden: <parches nuevos>
2. Merge de la rama y deploy
3. Correr `npm run stock-lab:reconcile -- --target production --read-only`; si cuadra con el informe, aplicar el one-shot de resincronización
4. Programar `reconcile` semanal (GitHub Actions, solo lectura) con alerta si diff ≠ 0

Decisiones sin consultar: (≤ 5 líneas) · Hallazgos bajos: (≤ 6) · No verificado: (≤ 3)
```
