# Mejoras de producto (UX/funcional) — plan de ejecución por módulos con gerente y supervisores

> **Para el humano:** abre Claude Code en la raíz del repo sobre `main` **con `fix/stock-integrity` ya mergeada** (ver sección 0b: este plan construye encima del libro de stock nuevo y no arranca sin él) y escribe:
>
> ```text
> Eres el GERENTE. Lee docs/agent-prompts/equipo.md y docs/agent-prompts/ux-mejoras-gtm.md y síguelos al pie de la letra.
> Ejecuta el plan módulo por módulo con un supervisor por módulo. No te detengas hasta cumplir la sección 11. No pidas ayuda salvo lo que la sección 1 permite. Tu única salida al humano es el reporte final.
> ```

Fuente: [`docs/auditoria-producto-2026-10.md`](../auditoria-producto-2026-10.md). Este plan convierte sus 37 recomendaciones (§5) en nueve módulos de trabajo, cada uno con su supervisor y su equipo (coders, caos, fixer, QA por ticket y QA final), orquestados por un gerente. Los roles están en `.claude/agents/` (`supervisor`, `coder`, `fixer`, `caos`, `qa`, `qa-final`); el protocolo general en [`equipo.md`](equipo.md). Lo que diga este documento manda sobre `equipo.md` donde difieran.

---

## 0. Misión

Que registrar una compra, pagarla, dar de alta un producto y entender el stock dejen de ser tareas de varias pantallas y decenas de campos. Medible con las métricas de la sección 10. Entregable: rama `feat/ux-mejoras` lista para merge, con las 24 recomendaciones implementadas o explícitamente descartadas con motivo, verificadas en navegador, sin regresiones en POS, caja, baúl ni inventario.

---

## 0b. Estado del repo que este plan asume (actualizado 2026-10-07)

`main` ya contiene: la app móvil extraída a su propio repo (`bodegahub-app`) con el workspace **`@bodega/core`** (`packages/core`: moneda, fechas Caracas, permisos, métodos de pago, bancos/teléfono VE, SKU, borrador de compra, periodos de dashboard); el **asistente IA** (`/assistant`, `toolRegistry`); la **nómina** (`/payroll`, `/payroll/mine`); autenticación **Bearer** en el BFF; y el primer endurecimiento del POS (`clientRequestId`, venta + pagos en una RPC con fallback en dos pasos).

La rama **`fix/stock-integrity`** (plan `stock-integrity-gtm.md`, ejecutado) cambia la base sobre la que trabaja este plan y **debe estar mergeada antes de la Ola 0**. Lo que trae y lo que implica aquí:

| Cambio en `fix/stock-integrity` | Consecuencia para este plan |
|---|---|
| **El libro `stock_movements` es la única fuente de verdad**; `products.current_stock` lo escribe solo el trigger `stock_movements_apply` (`20261006a`/`e`). `products_stock_guard` rechaza `update current_stock` e `insert` con stock ≠ 0 desde PostgREST (`PT400`/`PT409`). `stock_movements` es solo-append. | Toda RPC nueva o modificada (PRO-12 surtido, COM-02 vínculo, COM-14 desarmar, INV-05 reposición) sigue el **contrato de §1 de `docs/stock-integrity.md`**: `security definer`, `assert_store_context()`, bloquear documento y luego productos `order by id for update`, insertar movimiento con `stock_after` NULL, nunca escribir `current_stock`, errores `PT4xx` en español. Los mocks y fixtures tampoco escriben `current_stock` a mano. |
| C1 corregido: producto nuevo con stock inicial genera `inventario_inicial`; `ProductFormModal` ya muestra "Stock actual" **solo lectura** con ayuda "Se corrige desde Inventario". | **PRO-03 queda reducido** a: botón "Ajustar stock" que abre `InventoryAdjustmentModal` precargado desde el formulario/detalle, y verificación en QA de que el campo sigue bloqueado. No reimplementar. |
| C6: `create_purchase`, `adjust_stock`, `convert_pack_to_units` idempotentes por `clientRequestId` (opcional en RPC); `POST /api/sales` lo exige (400 sin clave). `useRequestAttempt` ya existe y la compra lo usa. | COM-09 (borrador) y COM-12/13 (líneas) reutilizan `useRequestAttempt`; CNF-16 persiste la clave con el borrador. **Nuevo**: hacer la clave obligatoria en la UI de ajustes y conversiones (INV-07) y en abrir surtidos (INV-08). |
| C15: devoluciones de venta/compra **parciales y ligadas al documento**; `devolucion_cliente`/`devolucion_proveedor` ya no existen como ajuste libre. | CNF-03 y CNF-05 muestran las cantidades elegidas de la devolución parcial que ya existe; INV-07 no ofrece esos tipos en el modal de ajuste. |
| C12: errores de negocio con `errcode` `PT400/403/404/409` y mensaje en español, mapeados por `src/lib/supabase/errors.ts`. | `ConfirmActionModal`, `NumberInput`, los modales de pago y el `ProcessGuard` muestran `error.message` tal cual; no inventar textos; los tests de caos esperan códigos, no texto. |
| N3: `cash_*`, `store_vaults`, `vault_movements`, `sales`, `purchases`, `payments` y líneas **solo se escriben por RPC**; RLS por tienda en líneas, historiales y empaques (N1/N2); vistas de reportes con `security_invoker` (C18). | PAG-04 (abono a varios documentos) y PAG-01/02 llaman `register_payment` N veces; nada escribe tablas directo. PRO-11 (`keep_product_price`) y PRO-14 (`is_preferred`) van por RPC con `store_id`. Las vistas nuevas de REP-06/07 e INV-01 se crean con `security_invoker = true`. |
| C10/C11: bloqueo ordenado de productos y numeración por secuencia `V-YYYYMMDD-NNNNNN` / `C-…`. | Los textos de confirmación y recibos usan el número nuevo; los tests no asumen el formato antiguo. |
| C20: escaneo lento + cobrar vendía sin la línea. | POS-01 (cobro compacto) se construye sobre el `sale-create/page.tsx` nuevo y conserva la espera de líneas pendientes; QA repite el escenario `f03`/C20. |
| Vistas de integridad v2 (`20261006d`), `stock_integrity_report`, laboratorio `scripts/stock-lab/*` (`npm run stock-lab:db-up|seed|run|reconcile|scenarios|ui|chaos|test`). | **Son el oráculo de este plan**: `qa-final` de Compras, Productos, Inventario y Confirmaciones corre `npm run stock-lab:test` y `stock-lab:reconcile` con 0/9 antes de cerrar; caos de esos módulos añade escenarios al lab en vez de scripts sueltos. |
| Abiertos del plan de stock que tocan este plan: **P4-3** `register_payment` sin idempotencia; **P4-2** descuento = subtotal − 0,01; producto inactivo acepta compras y ajustes; `pendiente_pago` abandonada retiene stock sin vencimiento. | Entran como tickets: PAG-06, POS-05, COM-15, PAG-07 (abajo). |
| La pasada 4 del plan de stock quedó incompleta por falta de disco (ya limpiado el 2026-10-07: `runs/` y `qa/` del lab vacíos; se conservan `board.json`, `decisions.md`, `rpc-review.md`, `prod-report-20261006.md`). | El gerente, **antes de la Ola 0**, cierra esa pasada: `stock-lab:db-up`, `seed`, `test`, `scenarios`, `ui`, `chaos` y `reconcile` 0/9 sobre `main`. Si algo falla ahí, se repara primero (ticket `STK-*`, no `UX-*`): este plan no construye sobre un lab en rojo. Política de disco durante el plan: borrar `scripts/stock-lab/runs/*` y `.notes/ux-mejoras/qa/<ticket>/` de tickets ya `done` al cerrar cada módulo. |

Estado al 2026-10-07: `fix/stock-integrity` está mergeada en `main` (PR #3) y la serie de parches de `stock-integrity.md` §7 ya está aplicada en producción. Los parches de este plan se aplican después y cada uno añade sus filas a `verify-patches.sql`.

---

## 1. Reglas de operación

1. **Autonomía total.** Sin confirmaciones ni opciones al humano. Única pregunta permitida (una vez, sin bloquear): si el laboratorio de stock no levanta por falta de Docker o de `STAGING_SUPABASE_URL`: *"Necesito Docker Desktop corriendo (o un Supabase de staging en .env.local) para el laboratorio de stock que valida Compras, Productos, Inventario y Confirmaciones. Avanzo con la Ola 0 y los módulos que no tocan stock."*
2. **Silencio operativo.** Única salida al humano: reporte final (sección 12). Los status intermedios viven en `.notes/ux-mejoras/status.md`, no en el chat.
3. **Economía de tokens.** `grep`/`sed -n`. Toda devolución ≤ 15 líneas. Lo largo va a `.notes/ux-mejoras/`.
4. **Next 16 y versiones instaladas.** Leer `node_modules/next/dist/docs/` antes de tocar rutas; `.d.ts` de toda librería nueva. No añadir librerías de UI: `CollapsibleSection`, tabs y sheets se construyen con lo que hay (`@radix-ui/react-dialog` ya está; si hace falta `@radix-ui/react-tabs` o `react-collapsible`, se decide una vez en la Ola 0 y se documenta).
5. **Navegador obligatorio.** Cada ticket de UI se verifica en navegador por `qa`; cada módulo por `qa-final`. Nunca "se ve bien en el código".
6. **Git.** Rama `feat/ux-mejoras` desde `main`. Un worktree por coder; el supervisor integra en la rama del módulo `feat/ux-mejoras/<modulo>`; el gerente integra las ramas de módulo en `feat/ux-mejoras`. Commits pequeños en inglés imperativo con el id del ticket. Push permitido. Nunca merge a `main`, nunca force push, nunca producción.
7. **SQL.** Si una mejora necesita cambios de datos (p. ej. vínculo automático proveedor–producto al comprar, entradas/salidas 30 d), parche idempotente en `supabase/patches/`, no aplicado, listado en el reporte; y paridad en mock.
8. **No se rompe nada.** `npm run typecheck && npm run lint && npm test && npm run build` en verde al cerrar cada ticket y cada módulo. Los flujos "no debe romperse" de cada módulo (sección 4) los corre `qa-final`.
9. **Las reglas de negocio no cambian y el libro de stock manda.** Ninguna RPC cambia su semántica monetaria ni de stock. Toda RPC nueva o tocada cumple el contrato de `docs/stock-integrity.md` §1 (sección 0b) y se prueba contra el laboratorio (`npm run stock-lab:test`). Si una mejora parece exigir otra cosa, el supervisor lo sube al gerente y el gerente lo descarta o lo anota como fuera de alcance.
10. **Ganancia = markup sobre el costo, todo en REF.** `% = (salePriceRef − currentCostRef) / currentCostRef`. `products.current_cost_ref` **ya incluye el IVA** desde el parche `20260813b`; no volver a aplicarlo. El precio se fija en REF y no cambia con la tasa: el Bs es solo presentación. El % solo se mueve cuando cambia el costo (compra recibida con otro costo) o el precio (acción del admin). Umbrales por defecto rojo < 15 %, amarillo 15–24,9 %, verde ≥ 25 %; chips 12 / 20 / 30. Todo configurable (PRO-09).
10b. **El semáforo es una alerta de revisión, no un bloqueo.** Al fijar un precio se guarda el costo y la banda del momento. Si después el costo sube y la banda actual es peor que la guardada (verde→amarillo, amarillo→rojo, verde→rojo), el producto entra en "Por revisar" hasta que el admin cambie el precio o elija "Mantener precio" (que re-snapshotea). Nunca se cambia un precio automáticamente.
11. **Diseño.** Tokens de `docs/design-tokens.md`; componentes de `src/shared/components/`; español en toda la UI; estados vacío/cargando/error/403; móvil 390 px y oscuro. El POS es la referencia de calidad.
12. **Cero diálogos nativos del navegador.** Prohibidos `window.confirm`, `window.alert`, `window.prompt` y cualquier UI fuera del tema (única excepción: el aviso `beforeunload` al cerrar pestaña o recargar, que el navegador no permite personalizar; ver regla 14) (toasts de librería sin tokens, `<dialog>` sin estilo, pickers nativos donde exista componente propio). Toda confirmación, aviso o entrada usa los componentes de `src/shared/components/` (`ConfirmActionModal`, `Modal`, `Toast`, `BottomSheet` en móvil). Hoy los únicos usos están en `products/categories-list/page.tsx` (líneas 115 y 127); CNF-12 los elimina. Regla permanente: lint `no-restricted-globals` para `confirm`/`alert`/`prompt` en `eslint.config.mjs` (SHR-08) para que no vuelvan a entrar.
13. **El IVA es un catálogo, no un número.** Alícuotas fijas en `tax_rates` (Exento 0 %, Reducida 8 %, General 16 % como semilla; el admin puede activar/desactivar o añadir una desde Configuración si la ley cambia). Ningún formulario permite teclear un porcentaje de IVA: siempre chips de alícuota. Las líneas de compra congelan el % de la alícuota elegida (snapshot) para que un cambio legal futuro no altere compras pasadas. El `PricingFields` de ganancia (SHR-06) sí acepta % libre porque es margen, no impuesto.
14. **Ningún proceso crítico se pierde sin aviso.** Compra en curso, carrito del POS, formularios con cambios, importación en curso y modales de dinero (pago, ajuste, cierre, baúl) están protegidos por `ProcessGuard` (SHR-11): navegación interna → modal del tema que **nombra el proceso**; cierre de pestaña/recarga → `beforeunload` nativo, **única excepción permitida a la regla 12 y solo porque ningún navegador permite personalizar ese diálogo**; si en algún momento el navegador lo permite, se personaliza. Todo lo demás que ocurra dentro de la app (navegar, atrás, cerrar un modal) usa el modal del tema. El `beforeunload` va siempre acompañado de borrador local automático para restaurar al volver. El guardia se desactiva en cuanto el proceso termina con éxito (nunca debe aparecer después de confirmar una compra o cobrar una venta) y nunca bloquea el flujo del cajero dentro del POS.
15. **El estado de una lista vive en la URL.** Filtros, búsqueda, orden, página y tamaño de página se leen y escriben en los parámetros de la URL (`router.replace`, `scroll: false`, búsqueda con debounce). Un listado sin parámetros muestra sus valores por defecto; un listado con parámetros los respeta al montar, al recargar y al volver con "atrás". "Volver" desde un detalle regresa a la URL exacta de la lista de origen. Ningún listado nuevo o modificado en este plan guarda su estado solo en `useState`.

---

## 2. Organigrama y protocolo de reporte

```text
GERENTE (sesión principal)
 ├─ Ola 0: SUPERVISOR Compartidos  (CollapsibleSection, Tabs, PaymentModal base)
 ├─ Ola 1 en paralelo:
 │    ├─ SUPERVISOR Compras      ── coders ×3, caos, fixer, qa, qa-final
 │    ├─ SUPERVISOR Pagos        ── coders ×2, caos, fixer, qa, qa-final
 │    └─ SUPERVISOR Productos    ── coders ×2, caos, fixer, qa, qa-final
 ├─ Ola 2 en paralelo:
 │    ├─ SUPERVISOR Detalles     ── coders ×3, caos, fixer, qa, qa-final
 │    ├─ SUPERVISOR Confirmaciones ── coders ×2, caos, fixer, qa, qa-final
 │    └─ SUPERVISOR Inventario   ── coders ×2, caos, fixer, qa, qa-final  (si stock-integrity está listo)
 ├─ Ola 3 en paralelo:
 │    ├─ SUPERVISOR POS y navegación ── coders ×2, caos, fixer, qa, qa-final
 │    └─ SUPERVISOR Reportes       ── coders ×3, caos, fixer, qa, qa-final
 └─ Cierre: QA de integración + caos global + auditoría
```

**Quién habla con quién.** El humano solo con el gerente. El gerente solo con supervisores (y con `caos`/`qa-final` en el cierre global). Cada supervisor con sus coders, fixer, caos, qa y qa-final. Los agentes de un módulo **no** hablan con los de otro: si un ticket necesita algo de otro módulo, el supervisor lo sube al gerente y el gerente lo reasigna o lo serializa.

**Status del supervisor al gerente** (archivo `.notes/ux-mejoras/<modulo>/status.md`, reescrito en cada hito; además devuelto como mensaje ≤ 15 líneas):

```text
MÓDULO: compras · OLA: 1 · ESTADO: en curso | bloqueado | qa-final | cerrado
TICKETS: done 4/9 · doing 3 · fix_needed 1 · blocked 1
ÚLTIMO HITO: COM-04 integrado (línea simple por defecto) · QA pass
BLOQUEOS: COM-07 necesita CollapsibleSection (Compartidos) → pido al gerente
RIESGOS: la búsqueda global de productos en compras tarda 900 ms con 2k productos → ticket de índice
MÉTRICAS: pantallas compra nueva = 2 (meta 1) · campos/línea = 4 ✓
SIGUIENTE: COM-05, COM-06; qa-final al cerrar COM-09
```

Hitos que obligan a reportar: apertura del módulo, cada ticket integrado, cada bloqueo, cada fallo de caos alto/medio, veredicto de qa-final, cierre.

**Status del gerente** (`.notes/ux-mejoras/status.md`): tabla con una fila por módulo (estado, tickets, bloqueos, métricas), decisiones tomadas y riesgos. Se actualiza con cada status recibido. Es lo que un humano abriría para saber cómo va; el chat no.

**Escalamiento.** Un ticket `blocked` dos veces por lo mismo → el supervisor lo sube; el gerente decide en ≤ 1 iteración y lo escribe en `decisions.md`. Caos alto → bloquea el cierre del módulo. Métrica fuera de objetivo en qa-final → el módulo no cierra: el supervisor abre tickets hasta cumplirla o el gerente la rebaja con motivo escrito.

---

## 3. Contexto obligatorio por supervisor

Todos: `AGENTS.md`, `docs/README.md`, `docs/auditoria-producto-2026-10.md` (completo), `docs/modules-catalog.md` (su sección), `docs/frontend-api-guide.md`, `docs/responsive-ui.md`, `docs/design-tokens.md`, `src/shared/components/` (nombres y props), patrón de página en `src/modules/vault/`.

| Supervisor | Lee además |
|------------|-----------|
| Compartidos | `src/shared/components/Modal`, `Card`, `DetailSection`, `ActionsMenu`, `FormActions`; `src/modules/payments/components/RegisterPaymentModal.tsx`; `node_modules/@radix-ui/` disponibles |
| Compras | `src/modules/purchases/**`, `src/modules/contacts/components/supplier-products/**`, RPC `create_purchase` vigente (`20260905-purchase-line-subtotal-ref.sql`), `register_supplier_product_price`, `supplier_product_pack_units`, `docs/frontend-product-bulk-import.md` |
| Pagos | `src/modules/payments/**`, `src/modules/purchases/purchase-details/**`, `src/modules/sales/sale-details/**`, `src/modules/contacts/contact-details/**`, RPC `register_payment`, `src/modules/sales/sale-create/components/PosCheckoutModal.tsx` (referencia de "Completar restante") |
| Productos | `src/modules/products/**`, `src/modules/inventory/inventory-movements/components/InventoryAdjustmentModal.tsx`, `src/shared/utils/skuGeneration.ts` |
| Confirmaciones | Todos los `*ActionsMenu.tsx`, `*ConfirmModal.tsx`, `PurchaseSummaryCard.tsx`, `ProductDetailPriceChangeCard.tsx`, `InventoryAdjustmentModal.tsx`, `InventoryPackConversionModal.tsx`, `vault-home/components/*Modal.tsx`, `CloseCashSessionModal.tsx`, `settings/settings-list/**`, `categories-list/page.tsx`; RPC `cancel_sale`, `return_sale`, `cancel_payment`, `receive_purchase` (para saber qué efecto real producen) |
| Detalles | `src/modules/products/product-details/**`, `purchases/purchase-details/**`, `sales/sale-details/**`, `contacts/contact-details/**` |
| Inventario | `src/modules/inventory/**`, vista `stock_card`, `docs/stock-integrity.md` y vistas de integridad si existen, `src/modules/dashboard/**` (stock bajo) |
| Reportes | `src/modules/reports/**` (catálogo, paneles, export, servicios y vistas que usan), `src/modules/dashboard/**` (`DashboardSalesChartCard`, `DashboardPeriodFilterModal`, `kpiPeriod.ts`), `docs/design-tokens.md`, `supabase/supabase-schema.sql` vistas `daily_sales_summary`, `gross_profit_summary`, `customer_purchase_summary`, `supplier_purchase_summary`, `stock_card` |
| POS y navegación | `src/modules/sales/sale-create/**`, `src/shared/components/AppShell/**`, `src/shared/auth/permissions.ts`, `src/modules/settings/**` |

---

## 4. Módulos, tickets y criterios

Prefijos de ticket: `SHR` Compartidos · `COM` Compras · `PAG` Pagos · `PRO` Productos · `DET` Detalles · `CNF` Confirmaciones · `INV` Inventario · `POS` POS y navegación · `REP` Reportes y dashboard. Cada ticket cita la recomendación (`R#`) y el hallazgo (`H#/P#/…`) de la auditoría que cierra. El supervisor puede subdividir, nunca fusionar módulos.

### 4.1 Compartidos (Ola 0) — serializado, bloquea a los demás

| Ticket | Qué | Cierra |
|--------|-----|--------|
| SHR-01 | `CollapsibleSection` en `src/shared/components/`: título, `summary` (una línea visible cuando está cerrado), `defaultOpen`, `storageKey` para recordar estado en `localStorage`, chevron, animación corta, accesible (`aria-expanded`, teclado). Story + tests. | R12 |
| SHR-02 | `Tabs` compartido (si no existe) con los mismos tokens, URL `?tab=` opcional. Story + tests. | R13 |
| SHR-03 | `PaymentFormFields`: extraer de `RegisterPaymentModal` los campos por método (método, monto REF/Bs con equivalencia en vivo, banco, teléfono, referencia, notas) como componente reutilizable con `pendingBalance`, botón "Completar saldo" y chips 25/50/100 %. Sin cambiar la API. Tests. | R3 (base) |
| SHR-04 | `PrimaryStateAction`: patrón de cabecera de detalle con 4 cifras + acción primaria según estado + menú "…" secundario. Story. | R14 (base) |
| SHR-05 | `EntityAutocomplete` sobre el `SearchAutocomplete` existente: busca productos (nombre, SKU, código de barras) o contactos (nombre, RIF) **en servidor** con debounce, muestra 8 resultados con detalle secundario (SKU · stock · precio / tipo · teléfono), recientes al enfocar, soporta lector de barras (Enter), teclado y limpiar. Reemplaza todo `SelectField`/`<select>` alimentado con listas de productos o contactos; `SelectField` queda para listas cortas y fijas (estados, métodos, tipos). Story + tests. | R25, A1 |
| SHR-06 | `pricing.ts` en **`@bodega/core`** (`packages/core/src/pricing.ts`, reexportado en `src/shared/utils/`; la app móvil lo consume igual): `markupPct(cost, price)`, `priceFromMarkup(cost, pct)`, `marginBand(pct, thresholds) → 'low'|'mid'|'high'`, `bandDrop(prevBand, currentBand) → boolean`; redondeo con `roundMoney`; tests exhaustivos (costo 0, precio < costo → % negativo y banda `low`, IVA 0 y 16). `MarginBadge` (semáforo rojo/amarillo/verde con %, tooltip "ganancia sobre el costo (ya con IVA)" y variante con icono ⚠ "Por revisar" cuando la banda bajó). `PricingFields` (costo actual REF solo lectura · chips de % recomendados estilo badge-button · input % · input precio; bidireccional: % → precio y precio → %). Stories + tests. | R26, R27 |
| SHR-07 | `ConfirmActionModal` en `src/shared/components/`: título, texto corto, sección **"Qué va a pasar"** (lista de efectos pasada como `effects: {label, before?, after?, tone}[]` o un `renderEffects()`), variante `danger`, botón con etiqueta explícita ("Anular venta", nunca "Aceptar"), `requireTypedConfirmation?: string` (el usuario escribe la palabra para habilitar el botón), estado `isPending` con botón bloqueado, foco inicial en Cancelar en variante peligro, Esc cierra. Reemplaza `UnlinkSupplierProductConfirmModal`, `PaymentCancelConfirmModal`, `Deactivate/ReactivateProductConfirmModal` y las confirmaciones inline de los `ActionsMenu` (todas pasan a usarlo). Stories + tests. | R28, C1–C4 |

Flujos "no debe romperse": ninguno nuevo (solo componentes). `qa-final`: stories renderizan en claro/oscuro; tests en verde.

### 4.2 Compras (Ola 1)

| Ticket | Qué | Cierra |
|--------|-----|--------|
| COM-01 | Buscador de productos en `/purchases/create` sobre **todos** los productos activos de la tienda (no solo el catálogo del proveedor). Los vinculados aparecen primero con chip "Habitual · último costo X". Debounce, barcode incluido. | R1, H1 |
| COM-02 | Vínculo automático: al confirmar la compra, por cada línea cuyo producto no esté vinculado al proveedor, la RPC `create_purchase` (versión vigente en `20261006c`/`f`/`h`; leerla antes) crea `supplier_products` dentro de la misma transacción, respetando el contrato de §0b con el costo de la línea y, si fue por empaque, el `supplier_product_pack_units`. Parche SQL si va en RPC; paridad mock; tests. | R1, V1, V2 |
| COM-03 | Botón "Nuevo producto" en la compra: abre `ProductFormModal` en modo reducido (nombre, categoría, código de barras, precio REF; costo prellenado desde la línea) y agrega el producto creado a la compra. | R1, R5 |
| COM-04 | Línea simple por defecto: visibles producto, cantidad, costo, total. Chip "Empaque" convierte la línea (muestra tipo, empaques, uds/empaque, costo por empaque). Chip "IVA" muestra el % solo si el usuario quiere cambiarlo; por defecto el de la categoría. | R2, H2 |
| COM-05 | Moneda de costo **una vez por compra** (toggle REF/Bs en el resumen); la otra moneda solo en el resumen y en el total de línea como texto secundario. Quitar el selector por línea. | R2, H3 |
| COM-06 | "Pagar ahora" opcional al crear: montar `PurchasePaymentSection` reescrita sobre `SHR-03`; si se completa, el BFF registra la compra y el pago en secuencia (o RPC conjunta si ya existe el patrón de `create_sale` con pagos). | R3, H5 |
| COM-07 | Estado "Pedido" explícito: banner fijo en el detalle "El inventario no ha cambiado. Recibir mercancía →" con botón primario (usa `SHR-04`); badge distinto en la lista; al recibir, previsualizar cantidades que entran antes de confirmar. | R6, R24, H4, L4 |
| COM-08 | Lista de compras: columnas Pagado y Saldo, badge de estado de pago, filtro "con saldo pendiente", rango de fechas. | R5, P5, L1 |
| COM-09 | "Duplicar compra" desde el detalle (misma proveedor y líneas, cantidades editables, costos al último conocido). Borrador local de la compra en curso (`localStorage`, se ofrece restaurar). | R20, H6 |
| COM-10 | `LinkSupplierProductModal`: el select "Proveedor" pasa a `EntityAutocomplete` de contactos (proveedor/ambos). Cualquier otro select de producto o contacto que aparezca en el módulo se migra en el mismo ticket. | R25, A1 |
| COM-11 | Impuesto por alícuota en la línea: `TaxRateChips` junto al nombre del producto (preseleccionada la de la categoría), sin `LineFieldBox` a todo el ancho ni input numérico; la fila recupera altura mínima. Toggle **"Compra exenta"** en la cabecera (todas las líneas a Exento, también las nuevas; al desactivar vuelven a su categoría; si una línea tenía otra alícuota elegida a mano, aviso). El resumen muestra el desglose por alícuota (base + IVA por cada una). | R32, H7 |
| COM-12 | **Líneas bloqueables.** Candado por línea + "Bloquear todas / Desbloquear todas" en la cabecera de la tabla. Línea bloqueada: fila compacta de solo lectura (producto · cantidad/empaques · costo · total · IVA), sin inputs en el DOM (no recibe `Tab`, teclado ni rueda), fondo sutil y candado cerrado; se desbloquea con el candado o doble clic en la fila. Al agregar una línea nueva, las existentes se bloquean automáticamente (preferencia "Bloquear al agregar" activada por defecto, persistida por usuario en `localStorage`). La línea nueva siempre nace desbloqueada y con foco en Cantidad. El estado de bloqueo no viaja al backend. | R33, H8 |
| COM-13 | Edición segura: todos los campos de línea usan `NumberInput` (SHR-09); al cambiar un valor la celda se resalta 1,5 s y la fila muestra un punto "editada" hasta bloquearse o confirmar; atajo `Esc` deshace el último cambio de la celda enfocada; antes de confirmar la compra, el resumen lista "N líneas editadas tras ser agregadas" para revisión rápida. | R33, H8 |
| COM-14 | **Desarmar al recibir.** En la línea de compra de un producto con receta de apertura (simple o surtido), chip "Desarmar al recibir"; al recibir, el BFF ejecuta `receive_purchase` y luego `convert_pack_to_units` con la receta (o con la distribución que el usuario ajustó en la confirmación), en la misma transacción si la RPC lo permite o en secuencia con compensación si falla. Preferencia por producto "siempre desarmar" (en la receta). La confirmación de recepción (CNF-04) muestra ambos efectos. | R34 |

Caos del módulo: rueda del ratón sobre cantidad y costo enfocados (no cambia nada); `Tab` desde la última línea bloqueada (salta al buscador, no a una celda); bloquear todas y luego escanear un código (la nueva línea nace libre); toggle "Compra exenta" con una línea con alícuota elegida a mano (aviso y aplica); `POST /api/purchases` con `tax_rate: 13` (400: alícuota inexistente); desactivar la alícuota General con categorías que la usan (bloqueo con mensaje); autocomplete con 3.000 productos (respuesta < 300 ms, sin congelar el modal); compra con 50 líneas; producto desactivado en la búsqueda; mismo producto agregado dos veces; crear producto desde la compra con SKU duplicado; vínculo automático cuando el vínculo ya existe (no duplicar); duplicar compra de un proveedor inactivo; recibir dos veces.

Flujos "no debe romperse": compra en modo empaque por el camino antiguo sigue dando el mismo `quantity_delta`; `npm run stock-lab:test` en verde y `stock-lab:reconcile` 0/9 tras las compras de QA (base lab, `stock-lab:db-reset` antes); costos con IVA en la lista de productos iguales que antes.

Métricas: pantallas para comprar un producto nuevo y pagarlo = **1**; campos visibles por línea simple = **4**; altura de una línea simple ≤ **2 filas de texto**; marcar la compra como exenta = **1 clic**; porcentajes de IVA tecleables en toda la app = **0**; inputs numéricos sensibles a la rueda del ratón = **0**; una línea bloqueada no cambia con teclado ni rueda = **verificado en QA**; "¿qué compras debo?" respondible desde la lista en **1 pantalla**.

### 4.3 Pagos (Ola 1)

| Ticket | Qué | Cierra |
|--------|-----|--------|
| PAG-01 | Pagar dentro del detalle de compra: acción primaria "Pagar" (si hay saldo) abre modal con `SHR-03`, contexto fijo, saldo prellenado, "Completar saldo", REF/Bs. Sin navegar. Al registrar, invalida compra, pagos y baúl. | R3, P1, P3, P4 |
| PAG-02 | Lo mismo en el detalle de venta ("Cobrar saldo"). | R3, S4 |
| PAG-03 | Eliminar el modal genérico con ID a mano: en `/payments`, "Registrar pago" abre un buscador de documentos con saldo (ventas y compras por número, cliente/proveedor, fecha) y, al elegir, el modal con contexto fijo. | R4, P2 |
| PAG-04 | Cuentas por cobrar / por pagar en el detalle de contacto: tab "Saldos" con documentos pendientes, total, y "Abonar" que aplica a los más antiguos (varios `register_payment` en secuencia, mostrando el reparto antes de confirmar). | R19, P6, S4 |
| PAG-05 | Lista de pagos: filtros de fecha y método visibles; columna "Documento" enlazada al detalle. | D4 (parcial) |

Caos: pago mayor al saldo; dos pagos simultáneos a la misma compra; abono a contacto sin documentos pendientes; método bancario sin referencia; vendedor intentando pagar compra (403 y UI oculta); saldo del baúl insuficiente en pago a proveedor (mensaje claro, nada cambia).

Flujos "no debe romperse": POS cobra igual; `cancel_payment` sigue revirtiendo baúl y caja; reportes de métodos de pago iguales.

Métricas: clics desde detalle de compra hasta pago registrado = **≤ 3**; cero campos "ID" visibles al usuario.

### 4.4 Productos y categorías (Ola 1)

| Ticket | Qué | Cierra |
|--------|-----|--------|
| PRO-01 | `ProductFormModal` en dos niveles: básico (imagen, nombre, categoría, código de barras, precio REF, costo REF) y "Más opciones" colapsado (`SHR-01`: SKU, descripción, stock mínimo, empaque). Modo `compact` para COM-03. | R17, R1, R4 |
| PRO-02 | "+ Nueva categoría" inline en el select de categoría (mini-modal: nombre, alícuota de IVA con `TaxRateChips`); al crear, queda seleccionada. | R16, R2 |
| PRO-03 | Stock solo por movimiento — **ya resuelto en datos y BFF por `fix/stock-integrity` (C1, C2)**; queda la UI: botón "Ajustar stock" junto al campo bloqueado (crear y editar) que abre `InventoryAdjustmentModal` precargado con el producto, y test de que el campo sigue `readOnly`. No tocar `products.server.ts` ni el formulario más allá del botón. | R10, R3 |
| PRO-04 | "Guardar y crear otro" en producto y contacto; foco al primer campo; toast con enlace al creado. | R20, R5 |
| PRO-05 | SKU: opcional en el formulario (se genera si vacío), con texto de ayuda "código interno; si tienes código de barras, úsalo". | R4 |
| PRO-06 | `ProductPackConversionFields`: el select "Producto unidad" pasa a `EntityAutocomplete` (filtrado a productos activos sin vínculo de empaque). | R25, A1 |
| PRO-07 | Lista de productos: columna "Ganancia" con `MarginBadge` (reemplaza o acompaña a Costo/PVP; en móvil, badge junto al precio); filtro "Ganancia baja / media / alta"; orden por %. Detalle: `MarginBadge` junto al precio en el Resumen, sustituyendo "Margen (REF)" por % + REF. | R26, M1 |
| PRO-08 | `PricingFields` en `ProductFormModal` (modo completo y `compact` de COM-03) y en `ProductDetailPriceChangeCard`: el usuario elige chip o escribe % y el precio se completa; si edita el precio, el % se recalcula; el motivo del cambio se prellena "Ajuste de margen a X %". | R27, M2 |
| PRO-09 | Configuración → "Impuestos": lista de alícuotas (`tax_rates`) con activar/desactivar y "Añadir alícuota" (etiqueta + %), alícuota por defecto para categorías nuevas; sustituye el campo numérico `defaultTaxRate`. Configuración → "Precios": umbrales del semáforo (rojo < / amarillo < / verde ≥), chips de % recomendados (lista editable, por defecto 12 / 20 / 30) y, en categorías, "% de ganancia sugerido" opcional que aparece como primer chip. Parche SQL: `app_settings` (claves nuevas) y `categories.default_markup_pct`. Paridad mock. | R26, R27 |
| PRO-10 | Al recibir una compra cuyo costo unitario supera el registrado, el detalle de la compra lista los productos cuya banda bajó: "Costo 8 → 9 REF · PVP 10 REF · ganancia 25 % → 11 % (rojo). Reprecio al 25 % → 11,25 REF" con botones "Aplicar" (llama `update_product_price` con motivo automático) y "Mantener precio". | R27, M2 |
| PRO-11 | **Cola "Por revisar".** Parche SQL: `product_price_history` gana `cost_ref_snapshot` y `margin_band_snapshot`; `update_product_price` los rellena; RPC `keep_product_price(p_product_id, p_reason)` que inserta una fila de historial sin cambiar el precio (re-snapshot). Vista `products_price_review` (banda actual peor que la del último snapshot, con % anterior, % actual, costo anterior, costo actual, fecha de la compra que lo cambió). UI: badge ⚠ en la lista y en el detalle, filtro "Por revisar" en `/products`, tarjeta en el dashboard "N productos bajaron de ganancia → revisar", acción masiva "Reprecio al X %" sobre la selección y "Mantener precio" individual. Paridad mock. | R26, R27, M1 |
| PRO-12 | **Datos del empaque surtido.** Parche SQL: `product_pack_conversions` pasa a cabecera (`pack_product_id`, `label`, `total_units`, `is_active`) + tabla `product_pack_components` (`conversion_id`, `unit_product_id`, `units_per_pack`, `cost_weight numeric default 1`), con `check (sum(units_per_pack) = total_units)` vía trigger. Se elimina el índice único del lado unidad (un producto unidad puede venir de varios empaques); se mantiene el del lado empaque (un empaque tiene una sola receta activa). Migración: cada fila actual se convierte en cabecera + 1 componente. RPC `convert_pack_to_units(p_pack_product_id, p_pack_quantity, p_reason, p_components jsonb default null)`: si `p_components` viene, debe sumar `total_units × p_pack_quantity` y usa esa distribución real; si no, la receta. Costo: `valor_transferido = packs × costo_pack`; se reparte por `units × cost_weight` y cada componente actualiza su costo por promedio ponderado como hoy. Movimientos: 1 `conversion_salida` + N `conversion_entrada` con el mismo `conversion_id`, insertados con `stock_after` NULL (el trigger `stock_movements_apply` fija saldo y `seq`); nunca escribir `current_stock`. Actualizar `conversion_mismatches` en las vistas v2 (`20261006d`) para sumar componentes y añadir escenario `pack.assorted_*` a `stock-lab:scenarios`. Paridad mock + tests (receta 2-2-2, distribución real 3-1-2, suma incorrecta → 400, pesos distintos, 1 componente = comportamiento actual intacto). | R34, E1 |
| PRO-13 | **UI del surtido en producto.** `ProductPackConversionFields` → modo de vínculo gana "Surtido (varios productos)": lista de componentes con `EntityAutocomplete` + unidades cada uno + peso de costo opcional (colapsado en "Avanzado"), total calculado vs declarado con validación visible, botón "Crear producto unidad" inline (reusa PRO-01 compacto). Detalle del producto empaque: tarjeta "Se abre en: 2 Cola · 2 Manzana · 2 Naranja"; detalle de cada unidad: "Proviene de: Caja Cola x6, Refrescos sabores x6". | R34 |
| PRO-14 | **Proveedores en el formulario de producto.** Sección "Proveedores" dentro de "Más opciones" (y visible en edición): lista de proveedores vinculados con `EntityAutocomplete` de contactos (`proveedor`/`ambos`) para añadir, costo REF y SKU del proveedor opcionales por fila, quitar fila (desactiva el vínculo), y radio **"Habitual"** (uno por producto). Parche SQL: `supplier_products.is_preferred boolean default false` con índice único parcial `(product_id) where is_preferred`; al crear el primer vínculo de un producto se marca habitual automáticamente; COM-02 respeta el habitual existente y, si no hay, marca el del vínculo nuevo. Al guardar el producto, el BFF crea/actualiza/desactiva vínculos en una sola llamada (`PUT /api/products/[id]/suppliers`) con paridad mock. Consumidores del habitual: chip "Habitual" en COM-01 (primero en resultados), INV-05 (proveedor propuesto en la compra de reposición), PRO-10 (muestra al proveedor en el aviso de reprecio). Tests: dos proveedores, cambiar habitual, quitar el habitual (pasa al siguiente o queda sin habitual con aviso). | R36, V4 |

Caos: marcar habitual a un proveedor inactivo (bloqueo); el mismo proveedor dos veces en la lista (se funde en una fila); surtido cuya suma de componentes no da el total (bloqueo); abrir 0 empaques; componente desactivado en la receta (aviso, no bloquea la venta del empaque); el mismo producto unidad en dos recetas y apertura simultánea de ambas (stock y costo correctos, `conversion_mismatches` en 0); compra recibida que baja la banda de 40 productos a la vez (cola y acción masiva); "Mantener precio" y luego otra subida de costo (vuelve a la cola); costo baja (banda sube: sale de la cola sin acción); costo 0 con % escrito (precio = 0, aviso); precio menor al costo (badge rojo con % negativo, sin bloquear); IVA de categoría cambiado después de fijar el precio (el % mostrado se recalcula); umbrales invertidos en configuración (validación); categoría inline con nombre duplicado; cerrar el modal con cambios; SKU vacío y nombre con tildes/ñ; producto sin categoría (debe fallar con mensaje); imagen de 12 MP.

Flujos "no debe romperse": import Excel; lista de productos con costo+IVA; detalle de producto; **conversiones 1 a 1 existentes siguen funcionando igual y con el mismo costo**; `stock_integrity_report` en 0 tras abrir surtidos.

Métricas: campos visibles al abrir "Nuevo producto" = **≤ 6**; crear categoría sin salir del formulario = **sí**; fijar un precio al 30 % sobre el costo = **1 chip, 0 cálculos externos**; productos con % de ganancia y semáforo visibles en la lista = **100 %**; producto cuya banda bajó aparece en "Por revisar" **en la misma recepción de compra que lo causó**.

### 4.5 Detalles (Ola 2, requiere Ola 0)

| Ticket | Qué | Cierra |
|--------|-----|--------|
| DET-01 | Detalle de producto en tabs (`SHR-02`): Resumen (info + stock + precio + cambio de precio) · Proveedores · Historial (precios, ventas) · Avanzado (empaques, imagen). Tab inicial Resumen. | R13, D1, D2 |
| DET-02 | Detalle de compra: cabecera `SHR-04` (total, pagado, saldo, estado; acción primaria: Recibir / Pagar / Ver PDF según estado); secciones colapsables: productos (abierta), pagos (abierta si hay saldo), proveedor/fechas/notas (cerradas con resumen). | R14, D2, D3 |
| DET-03 | Detalle de venta: igual que DET-02 (acción primaria Cobrar saldo / Recibo); vista previa del recibo colapsada. | R14 |
| DET-04 | Detalle de contacto: tabs ya existentes + tab "Saldos" (de PAG-04) + resumen en cabecera (total comprado/vendido, saldo). | R14 |
| DET-05 | Enlaces cruzados: producto en tablas de compra/venta → detalle de producto; movimiento de stock → documento origen; documento → sus movimientos. | R15, D4 |
| DET-06 | **Migrar los doce listados** a `useUrlListState` con su schema Zod: productos (búsqueda, categoría, estado, ganancia, orden, página), categorías, inventario (búsqueda, categoría, estado de stock), movimientos (producto, tipo, rango), contactos (tipo, búsqueda), ventas (estado, cliente, rango), compras (búsqueda, estado, pago, rango), pagos (dirección, método, documento, contacto, rango — conservar el `purchaseId`/`saleId` inicial como parámetro normal), cajas, reportes (reporte activo, rango, agrupación), tiendas, usuarios. Todos los enlaces de fila a detalle usan `withReturnTo`; todos los `PageBackButton` de detalles reciben `fallbackHref` y dejan de ser un `Link` fijo. Los filtros que otros tickets añaden (COM-08 saldo, PRO-07 ganancia, INV-01) nacen ya en el schema. Test e2e por lista: filtrar → abrir detalle → Volver → mismos filtros, misma página, mismo scroll; recargar en el detalle y Volver → igual; enlace con filtros pegado en otra pestaña → lista filtrada. | R37, L5, L6 |

Caos: URL con `page=9999` (cae a la última página válida); `sort=campo_inexistente` (default sin error); `from=https://evil.example` (ignorado, usa `fallbackHref`); filtros + `F5` en la lista (idénticos); abrir dos pestañas con filtros distintos (independientes; "recordar filtros" guarda el último que se tocó); volver con `Alt+←`; lista de 50 páginas, ir a la 37, abrir detalle, Volver (página 37 y scroll); detalle de producto con 500 ventas históricas (paginado, no colgado); compra sin pagos; venta cancelada (acción primaria coherente); `localStorage` lleno o bloqueado (colapsables funcionan igual).

Flujos "no debe romperse": todas las acciones del menú "…" siguen disponibles; PDF de venta/compra idéntico.

Métricas: listados que conservan filtros, orden, página y scroll al volver del detalle = **12 de 12**; enlaces de lista con filtros compartibles por URL = **sí**; bloques expandidos al abrir el detalle de producto = **≤ 3**; acción primaria del estado visible sin abrir menú = **sí** en compra y venta.

### 4.6 Inventario (Ola 2; `fix/stock-integrity` ya mergeada es prerrequisito de todo el plan)

| Ticket | Qué | Cierra |
|--------|-----|--------|
| INV-01 | `/inventory` como vista única de stock: columnas stock, mínimo, entradas 30 d, salidas 30 d, último movimiento (fecha y tipo) y, para admin, badge si el producto aparece en `stock_reconciliation` con `diff ≠ 0`. Vista SQL `inventory_overview` (`security_invoker`, sobre `stock_movements` con `seq`) + mock. | R7, I1 |
| INV-02 | Fila expandible con los últimos 10 movimientos (kardex inline, `stock_after` visible) y enlace al kardex completo. | R7, I3 |
| INV-03 | Kardex en el detalle de producto (tab Resumen): saldo, mini-gráfico 30 d, últimos movimientos. | R8, I3 |
| INV-04 | Filtros de movimientos en servidor: tipo, rango, producto, documento; paginación. | R9, I2 |
| INV-05 | "Crear compra con estos productos" desde stock bajo (dashboard y reporte): precarga líneas con cantidad sugerida (mínimo × 2 − stock) y último proveedor. | R11, I4 |
| INV-06 | `/products` columna Stock enlaza a la fila de `/inventory`; se elimina la duplicación de filtros de stock en productos. | R7, I1 |
| INV-07 | Reemplazar los selects de producto por `EntityAutocomplete` en `InventoryAdjustmentModal` (Producto) e `InventoryPackConversionModal` (producto empaque); precargar el producto cuando el modal se abre desde su detalle; `clientRequestId` obligatorio vía `useRequestAttempt` en ambos (C6); los tipos `devolucion_cliente`/`devolucion_proveedor` no se ofrecen (C15: van por el documento). | R25, A1 |
| INV-08 | **Abrir empaque surtido.** `InventoryPackConversionModal` (y la acción desde el detalle del producto): tras elegir empaque y cantidad, muestra la receta como distribución editable (una fila por componente con `NumberInput`), suma en vivo contra el total, aviso si no coincide, "Restablecer receta"; `ConfirmActionModal` con el efecto: −N empaques, +a Cola, +b Manzana, +c Naranja y stock resultante de cada uno. | R34 |

Caos: producto con 10.000 movimientos; movimiento sin documento (one-shots históricos) se muestra como "ajuste manual"; filtro de rango invertido; stock negativo histórico.

Flujos "no debe romperse": `stock-lab:test` en verde y `stock-lab:reconcile` 0/9 tras QA; ajustes y conversiones generan los mismos movimientos; escenarios `h08.dg5_double_submit` y `pack.*` del lab siguen pasando.

Métricas: pantallas para responder "¿por qué este stock?" = **1**.

### 4.7 POS y navegación (Ola 3)

| Ticket | Qué | Cierra |
|--------|-----|--------|
| POS-01 | Modal "Cobrar" compacto: arranca con método + monto; billetes y vuelto aparecen solo con efectivo y diferencia > 0; "Expandir" manual. Mismas validaciones. | R18, S2 |
| POS-02 | Configuración → "El administrador puede vender" (toggle que otorga `sales.create` + `cash.operate` al rol admin de la tienda vía overrides existentes). Documentar. | R21, S3 |
| POS-03 | Búsqueda global en el header: código de barras / SKU / N° factura / N° compra / contacto → navega al detalle. Atajo `/`. | R22, L3 |
| POS-04 | Menú (hoy 19 entradas con Nómina, Mis recibos y Asistente): grupos colapsables "Operación" (Inicio, Ventas, Mi caja, Compras, Inventario, Productos, Contactos), "Dinero" (Cajas, Baúl, Pagos, Nómina), "Análisis" (Reportes, Asistente) y "Configuración"; "Mis recibos" solo para vendedor; rutas intactas; orden por rol. | R23, L2 |

Caos: cobrar con método bancario y vuelto en efectivo; toggle de admin con caja sin asignar; búsqueda con 1 carácter; búsqueda de UUID.

Flujos "no debe romperse": todos los flujos del POS (`scripts/e2e-bodegon`), cierre de caja, autocierre.

Métricas: campos visibles al abrir "Cobrar" con pago móvil exacto = **2**.

### 4.8 Confirmaciones y seguridad operativa (Ola 2, requiere SHR-07) — supervisor propio

Regla: toda acción que mueva stock, dinero, costos, precios o permisos confirma mostrando **el efecto concreto sobre ese documento**, calculado antes de ejecutar. Lo inofensivo no confirma. **Confirmar venta en el POS queda excluido**: es flujo de cajero y se protege con caja abierta, validación de stock e idempotencia, no con un modal.

| Ticket | Acción | Qué muestra la confirmación | Cierra |
|--------|--------|-----------------------------|--------|
| CNF-01 | **Confirmar compra** (`/purchases/create`) | Proveedor; N líneas; por producto: cantidad que entra (unidades normalizadas si fue por empaque), costo anterior → nuevo (y % de ganancia resultante con `MarginBadge` si baja de banda); productos que quedarán **vinculados por primera vez** al proveedor; total REF/Bs y tasa; si hay "Pagar ahora": método y monto que saldrá del baúl; si estado = `pedido`: aviso "el inventario NO cambia hasta recibir". | C2 |
| CNF-02 | **Anular venta** | Nº y cliente; por producto: unidades que vuelven al stock → stock resultante; pagos registrados (método, monto) y qué pasa con ellos (se revierten de caja/baúl o quedan por anular); variante peligro; si `paid_ves > 0`, escribir **ANULAR**. | C1 |
| CNF-03 | **Devolver venta** (total/parcial) | Igual que CNF-02 con las cantidades elegidas; monto a devolver al cliente por método. | C1 |
| CNF-04 | **Recibir compra** | Por producto: cantidad que entra → stock resultante; costo que se fija; productos cuya ganancia baja de banda (enlaza con PRO-10). Sustituye el texto genérico actual. | C1, L4 |
| CNF-05 | **Cancelar / devolver compra** | Si estaba recibida: unidades que salen → stock resultante (y aviso si quedaría negativo); pagos al proveedor y su destino; variante peligro. | C1 |
| CNF-06 | **Anular pago** | Documento, método, monto; efecto exacto: "vuelve Bs X a la caja de <nombre>" / "vuelve REF Y al baúl efectivo" / "vuelve Bs Z a cuenta"; nuevo saldo del documento y nuevo estado (`pendiente_pago`). | C1 |
| CNF-07 | **Cambio de precio** | Precio anterior → nuevo (REF y Bs a la tasa), % de ganancia anterior → nuevo con semáforo, motivo; aviso si el nuevo precio queda por debajo del costo. Aplica en `ProductDetailPriceChangeCard`, en el reprecio desde compra (PRO-10) y en la acción masiva (PRO-11: lista de productos con antes → después). | C2 |
| CNF-08 | **Ajuste de stock** y **conversión empaque→unidad** | Stock actual → resultante por producto; en conversión, ambas caras (−N empaques, +N×u unidades); motivo obligatorio visible. | C2 |
| CNF-09 | **Baúl: retiro, depósito, transferir cierres** | Saldo actual → resultante por cubeta (efectivo Bs / cuenta / REF); en transferir cierres: lista de cierres con fecha, caja, monto contado vs teórico y diferencia. | C2 |
| CNF-10 | **Cierre de caja** | Mantener el modal actual, añadir fila **Diferencia** (contado − teórico, en rojo si falta) y confirmación explícita cuando la diferencia supere un umbral configurable (`cash_close_diff_alert_ves`, default 0): "Vas a cerrar con Bs X de faltante. ¿Continuar?". | C2 |
| CNF-11 | **Usuarios y configuración** | Cambiar rol o desactivar usuario deja de guardarse en `onChange`: botón "Guardar" + confirmación con "Rol vendedor → admin: ganará acceso a compras, baúl, reportes…" (lista desde `rolePermissions`). Cambiar IVA por defecto y métodos habilitados: confirmación con lo que cambia. | C2 |
| CNF-12 | **Categorías y vínculos** | Reemplazar `window.confirm` en desactivar/reactivar categoría por `ConfirmActionModal` mostrando cuántos productos tiene y que seguirán vendiéndose; desvincular proveedor muestra historial de precios y empaques que dejarán de usarse. | C3 |
| CNF-13 | **Quitar confirmaciones inofensivas** | PDF, imprimir, "Ir a pagos", navegar: acción directa. Auditar todos los `ActionsMenu` para que solo confirmen acciones con efecto. | C4 |
| CNF-14 | **Cálculo del efecto** | Los efectos se calculan en el cliente con los datos ya cargados cuando alcanza (stock actual + cantidades); cuando no (pagos y su destino, cierres a transferir), endpoint `GET /api/<doc>/[id]/impact?action=` que devuelve el mismo resultado que la RPC va a aplicar, sin escribir. Tests que comparan el *impact* con el resultado real tras ejecutar. | C1 |
| CNF-15 | **Guardia en procesos críticos.** Activar `useProcessGuard` en: `/purchases/create` (activo con ≥ 1 línea o proveedor elegido; etiqueta con proveedor, nº de líneas y total; `onLeave: 'draft'` usando el borrador de COM-09), POS (activo con carrito no vacío **solo** para salir de la ruta del POS, nunca entre pasos del cobro; `onLeave: 'draft'` persistiendo el carrito por caja/usuario, restaurado al volver con aviso "Carrito recuperado"), `ProductFormModal`/`ContactFormModal` con cambios (`'discard'`, el modal pregunta antes de cerrarse con Esc o clic fuera), asistente de importación desde el paso 2 (`'discard'`), modales de pago, ajuste de stock, conversión, cierre de caja y operaciones del baúl mientras tienen datos tecleados (`'discard'`). Lista en `docs/modules-catalog.md` de qué procesos están protegidos. | R35, C6 |
| CNF-16 | **Borradores recuperables.** Compra: extiende COM-09 para guardar el borrador en cada cambio (debounce 500 ms) con proveedor, líneas, estado, notas y la lista de líneas bloqueadas; al entrar a `/purchases/create` con borrador, banner "Tienes una compra sin terminar (Distribuidora X, 12 líneas, hace 20 min) → Restaurar / Descartar". POS: carrito por caja/usuario en `localStorage`, restaurado al volver o al reabrir el navegador, invalidado al cobrar o al cerrar caja. Importación: el archivo no se puede persistir; el guardia basta. | R35 |

Caos del módulo: compra con 12 líneas → clic en "Ventas" del menú (modal con proveedor y 12 líneas; *Seguir aquí* no pierde nada; *Salir* deja borrador y al volver lo ofrece); botón atrás del navegador con carrito lleno (modal, y la URL no cambia si elige quedarse); `F5` con compra a medias (aviso nativo; al recargar, banner de borrador); confirmar compra y en la pantalla de detalle pulsar atrás (sin modal: el proceso ya terminó); POS: entre carrito y modal de cobro no aparece ningún guardia; dos pestañas con el mismo POS (el borrador del carrito no se pisa: clave por pestaña o aviso); modal de producto con cambios y Esc (pregunta); modal sin cambios y Esc (cierra directo); confirmar compra y cambiar una línea mientras el modal está abierto (el modal se recalcula o se cierra); anular venta cuyo pago ya fue anulado (efecto correcto: nada que revertir); recibir compra con producto desactivado; conversión que dejaría stock negativo (bloqueo antes del modal); escribir "anular" en minúsculas (acepta sin distinguir mayúsculas); doble clic en el botón del modal (una sola ejecución); impact de un documento de otra tienda (404).

Flujos "no debe romperse": POS confirma la venta sin modal adicional; `e2e-bodegon` completo; todos los `ActionsMenu` conservan sus acciones.

Métricas: procesos críticos que se pierden al navegar o recargar sin aviso = **0** (de todos); compra o carrito restaurados tras salir y volver = **sí**; guardias que aparecen después de completar un proceso = **0**; operaciones que mueven stock/dinero sin confirmación con efecto visible = **0** (de 10); confirmaciones en acciones inofensivas = **0** (de 3); diálogos nativos (`confirm`/`alert`/`prompt`) en `src/` = **0**, con lint que lo impide; tiempo de una venta en POS **sin cambio**.

### 4.9 Reportes y dashboard (Ola 3, en paralelo con POS y navegación; los reportes de stock esperan a `fix/stock-integrity`) — supervisor propio

Reglas: un solo componente de gráfico por tipo, con los tokens del tema y legible en claro/oscuro; sin inputs nativos de fecha; **nada por vendedor** (un vendedor por tienda; se anota como futuro). Antes de dibujar cualquier gráfico, el coder lee `docs/design-tokens.md` y la skill de visualización si está disponible en la sesión.

| Ticket | Qué | Cierra |
|--------|-----|--------|
| REP-01 | `TimeSeriesChart` compartido (Recharts): **línea** con marcadores, marcador destacado y etiqueta en los **picos** (máximos locales configurables, p. ej. top 3 del rango), tooltip con fecha Caracas, REF, Bs y nº de ventas, serie opcional del periodo anterior atenuada, eje Y en REF con toggle a Bs, estados vacío/cargando, responsive (sin etiquetas solapadas en 390 px). Reemplaza el `BarChart` de `DashboardSalesChartCard`. Story + tests. | R29, G1 |
| REP-02 | `DateRangeField` compartido (presets calculados con `@bodega/core/dates`): chips de preset (hoy, ayer, esta semana, semana pasada, este mes, mes pasado, últimos 30 días, personalizado) + rango con calendario propio (sin `type="date"`), siempre en día operativo Caracas; devuelve `{from, to, preset}`. Lo usan Reportes, Dashboard (sustituye `DashboardPeriodFilterModal`) y los filtros de listas que tengan fechas. Story + tests. | R30, G2 |
| REP-03 | Catálogo de reportes agrupado (Ventas · Compras · Inventario · Dinero) con descripción de una línea y búsqueda; reemplaza el `<select>` plano; el reporte activo va en la URL (`?report=`). | R30, G4 |
| REP-04 | Gráfico encima de la tabla en los reportes que lo piden: ventas diarias y ganancia bruta (línea, REP-01), métodos de pago (barras apiladas o dona, decidir una vez), top productos / top clientes / rentabilidad (barras horizontales ordenadas), compras por periodo (línea). Tabla debajo, colapsable (SHR-01). | R30, G1 |
| REP-05 | Comparación con periodo anterior (delta % y serie superpuesta) y agrupación día/semana/mes en los reportes de serie; parámetros `compare=1` y `groupBy=` en los servicios con paridad mock. | R30, G3 |
| REP-06 | Reportes nuevos **de dinero** (no dependen de stock): ventas por hora del día y por día de la semana (mapa de calor simple o barras); ventas y margen por categoría; cuentas por cobrar y por pagar con antigüedad (0–7, 8–30, >30 días) enlazadas a los documentos; diferencias de cierre de caja por fecha (contado − teórico, acumulado). Vistas SQL con RLS + mock + tests. | R31, G5 |
| REP-07 | Reportes nuevos **de inventario** (sobre el libro con `seq`): productos sin movimiento en N días con valor a costo (capital inmovilizado), rotación por producto y categoría, ajustes y mermas por motivo y periodo. | R31, G5 |
| REP-08 | Exportación: el PDF/Excel incluye el gráfico (imagen) cuando existe y un encabezado con rango, agrupación y filtros aplicados; nombre de archivo con reporte y rango. | R30 |
| REP-09 | Dashboard: gráfico en línea (REP-01) con periodo anterior; tarjeta "Por revisar" de precios (PRO-11) y "Cuentas por cobrar vencidas" enlazadas; `DateRangeField` para el rango. | R29 |

Caos del módulo: rango de 2 años en ventas diarias (agrupación automática a semana/mes o aviso, sin colgar); un solo día de datos (línea con un punto, sin NaN); periodo anterior sin datos (serie vacía, delta "—"); tema oscuro con 5 series; exportar PDF con gráfico en móvil; 10.000 filas en cuentas por cobrar (paginado).

Flujos "no debe romperse": cierre del día y depreciación FX idénticos en cifras; exportaciones existentes abren; dashboard carga en < 2 s con mock.

Métricas: reportes con gráfico = **todos los de serie o ranking** (de 0); inputs de fecha nativos = **0** (de 2); elegir "mes pasado" en un reporte = **1 clic** (de 2 fechas tecleadas); picos de venta identificables a simple vista en el dashboard = **sí** (verificado en QA visual).

---

## 5. Secuencia del gerente

1. **Arranque.** Rama, `.notes/ux-mejoras/` con `status.md`, `decisions.md`, `board.json` global (índice de tableros por módulo). Verificar entorno: dev server mock (`API_DATA_SOURCE=mock ALLOW_DEMO_AUTH=true`), navegador disponible. Comprobar `fix/stock-integrity`.
2. **Ola 0.** Supervisor Compartidos. Al cerrar: integrar en `feat/ux-mejoras`; todos los módulos siguientes parten de ahí.
3. **Ola 1.** Lanzar en paralelo supervisores Compras, Pagos, Productos, cada uno en `feat/ux-mejoras/<modulo>`. Archivos compartidos entre ellos (`RegisterPaymentModal`, `ProductFormModal` usado por COM-03 y PRO-01) → el gerente asigna el dueño (Pagos es dueño del modal de pago; Productos del formulario de producto; Compras consume) y secuencia: PRO-01 y SHR-03 antes de COM-03 y COM-06.
4. **Integración Ola 1.** Merge de las tres ramas en orden Pagos → Productos → Compras; resolver conflictos; `qa-final` de integración con los flujos de los tres módulos juntos ("comprar producto nuevo y pagarlo" de punta a punta).
5. **Ola 2.** Detalles, Confirmaciones e Inventario en paralelo (Confirmaciones en serie con Detalles sobre la rama de integración, porque ambos tocan los `ActionsMenu` de detalle: primero Detalles, luego Confirmaciones) . Integración igual.
6. **Ola 3.** POS y navegación y Reportes en paralelo (Reportes en worktree: `src/modules/reports`, `dashboard` y vistas SQL son disjuntos del shell y el POS; REP-02 reemplaza `DashboardPeriodFilterModal`, así que Dashboard es dueño de Reportes en esta ola).  Integración.
7. **Cierre global.** `caos` con todos los casos de los módulos + los globales (sección 7); `qa-final` global (sección 6); auditor sobre `git diff main...HEAD`; corrección; dos pasadas limpias.
8. **Entrega.** Docs (sección 9), push, reporte.

---

## 5b. Estrategia de ejecución: una sesión gerente, worktrees solo donde rinden

Una sola sesión de Claude Code (el gerente). Los supervisores y coders son subagentes de esa sesión. El paralelismo se consigue con `isolation: worktree`, **solo** donde los módulos son disjuntos; donde se pisan, se trabaja en serie sobre la rama de integración.

| Ola | Modo | Motivo |
|-----|------|--------|
| 0 Compartidos | Serie, sin worktree, en `feat/ux-mejoras` | Todo lo demás depende de ella; cuatro tickets pequeños |
| 1 Compras · Pagos · Productos | **3 worktrees**, uno por supervisor (`../control-ventas-wt/compras`, `/pagos`, `/productos`), rama `feat/ux-mejoras/<modulo>` | Carpetas disjuntas; los archivos compartidos ya tienen dueño (§5.3). Integrar Pagos → Productos → Compras |
| 2 Detalles → Confirmaciones | Serie, en `feat/ux-mejoras`, **después** de integrar la Ola 1; Confirmaciones tras Detalles | Toca los detalles de producto, compra, venta y contacto que la Ola 1 acaba de modificar; en worktree generaría conflictos en cada archivo |
| 2 Inventario | 1 worktree en paralelo con Detalles | Carpeta disjunta (`src/modules/inventory`, vistas SQL) |
| 3 POS y navegación | Serie | Toca `AppShell`, permisos y POS; pocos tickets |
| 3 Reportes | 1 worktree en paralelo con POS y navegación | `reports`, `dashboard` y vistas SQL son disjuntos del shell |
| Cierre | Serie, un solo dev server | QA final global, caos global, auditoría |

Dentro de un módulo, el supervisor abre worktrees para coders **solo** si hay ≥ 2 tickets con `files` disjuntos y de más de una hora; si no, los coders trabajan en serie dentro del worktree del módulo. Máximo **3 worktrees activos** a la vez en toda la ejecución.

Cada worktree necesita sus dependencias y su servidor para que `qa` pruebe en navegador: `npm ci` en el worktree (o enlazar `node_modules` del repo principal si el espacio aprieta; `.next` siempre propio) y `PORT=3001|3002|3003 API_DATA_SOURCE=mock ALLOW_DEMO_AUTH=true npm run dev`. El gerente anota puerto y ruta de cada worktree en `.notes/ux-mejoras/worktrees.md` y los borra (`git worktree remove`) al integrar el módulo.

El gerente **no lee diffs ni código**: su memoria son `status.md`, `board.json` y `decisions.md`. Si el contexto de la sesión se compacta, se reconstruye desde esos archivos.

## 6. QA final global (flujos de punta a punta, en navegador, con capturas)

1. Admin: llega mercancía de un proveedor nuevo con un producto nuevo → crear contacto (desde la compra si PRO-04/COM se lo permite, o antes) → `/purchases/create` → buscar producto (no existe) → "Nuevo producto" → agregar línea simple → agregar segunda línea (la primera se bloquea sola; rueda del ratón sobre ella no cambia nada) → marcar "Compra exenta" → "Pagar ahora" en efectivo USD → confirmar → detalle muestra pagado, stock subió, proveedor quedó vinculado con costo y empaque. **Una sola ruta de compra.**
2. Admin: compra en `pedido` → banner → "Recibir" → previsualización → stock sube → lista muestra saldo → pagar desde el detalle con "Completar saldo" en Bs → saldo 0.
3. Vendedor: vende con pago móvil exacto en 2 campos; vende con efectivo y vuelto; cierra caja. Baúl cuadra tras transferir.
4. Admin: `/inventory` responde "por qué este stock" en una fila expandible; kardex en detalle de producto coincide.
5. Admin: detalle de producto en tabs; detalle de compra y venta con acción primaria; colapsables recuerdan estado tras recargar.
6. Contador: tab Saldos de un proveedor → abonar → reparto a los más antiguos → pagos listados.
7. Búsqueda global por código de barras → detalle de producto; por N° factura → venta.
8. Admin: lista de productos con semáforo → filtra "ganancia baja" → abre uno → cambia precio eligiendo el chip 30 % → PVP completado y badge verde; recibe una compra con costo mayor → el producto aparece ⚠ Por revisar en la compra, en la lista y en el dashboard → "Reprecio al 25 %" → sale de la cola; otro producto → "Mantener precio" → sale de la cola con historial.
9. Admin: anula una venta pagada → el modal lista productos que vuelven al stock y pagos que se revierten → escribe ANULAR → stock y baúl coinciden con lo anunciado. Confirma una compra → el modal muestra entradas, costos y vínculos nuevos → coincide con el detalle. Cambia precio → antes/después con semáforo. Descarga un PDF → sin confirmación.
10. Admin: dashboard muestra la línea de ventas con los picos marcados y el periodo anterior atenuado → Reportes → elige "Mes pasado" con un clic → ganancia bruta con gráfico y tabla colapsada → exporta PDF con gráfico y rango en el encabezado → abre "Cuentas por cobrar" → clic en un cliente vencido → detalle de la venta.
11. Almacén: crea "Refrescos sabores" con receta 2 Cola · 2 Manzana · 2 Naranja → compra 3 cajas con "Desarmar al recibir" → al recibir ajusta una caja a 3-1-2 → confirmación muestra −3 cajas, +7 Cola, +5 Manzana, +6 Naranja → stock y costos por sabor correctos → `stock_integrity_report` en 0 → POS vende una Cola suelta.
12. Admin: compra con 5 líneas → clic en "Inventario" → modal nombra la compra → *Salir* → vuelve a Compras → banner de borrador → *Restaurar* → las 5 líneas y sus bloqueos intactos → confirma → en el detalle, atrás no pregunta nada. Vendedor: carrito con 3 productos → cierra la pestaña → abre de nuevo → "Carrito recuperado" → cobra.
13. Admin: productos → filtra categoría "Bebidas" + "ganancia baja" + página 2 → abre un producto → cambia el precio → Volver → misma lista, mismos filtros, página 2, mismo scroll → copia la URL y la abre en otra pestaña → misma lista filtrada. Lo mismo en ventas (estado + rango) y compras (con saldo).
14. Móvil 390 px y oscuro en 1, 2, 3, 4, 8, 9, 10, 11, 12 y 13. Fuente 130 % en 1 y 3.

Métricas medidas por `qa-final` global contra la sección 10. Antes de medir, `stock-lab:db-reset && stock-lab:seed` y, al terminar, `stock-lab:reconcile` 0/9.

---

## 7. Caos global (además del de cada módulo)

| # | Caso | Esperado | Severidad |
|---|------|----------|-----------|
| 7.1 | Compra con producto nuevo + pago ahora, red cortada tras confirmar | Un solo documento (idempotencia) o ninguno; nunca compra sin vínculo ni pago sin compra | Alta |
| 7.2 | Dos usuarios crean la misma categoría inline a la vez | Una categoría; el segundo la ve seleccionada | Media |
| 7.3 | Vínculo automático con proveedor inactivo | Compra rechazada con mensaje; nada se crea | Media |
| 7.4 | Vendedor abre `/purchases/create` | 403 y menú sin la entrada | Alta |
| 7.5 | Colapsables con `localStorage` deshabilitado | Funcionan con estado por defecto | Baja |
| 7.6 | `inventory_overview` con 5.000 productos | < 2 s con paginación; filtros en servidor | Media |
| 7.7 | Abono a contacto que paga parcialmente 3 documentos y falla en el 2.º | Los pagos ya registrados quedan; UI muestra qué quedó pendiente; nada duplicado | Alta |
| 7.8 | Toggle "admin puede vender" activado y luego desactivado con sesión de caja abierta | La sesión se puede cerrar; no se puede vender | Media |
| 7.9 | Búsqueda global con texto de inyección en el nombre de un producto | Se muestra como texto | Baja |
| 7.10 | Regresión: `scripts/e2e-bodegon`, `npm run stock-lab:test`, `stock-lab:scenarios`, `stock-lab:ui` y `stock-lab:chaos` tras todo el plan (base lab limpia) | Todo verde; `reconcile` 0/9 en todas las olas; 0 respuestas 5xx | Alta |

---

## 8. Ciclo de calidad por módulo (lo ejecuta cada supervisor)

1. Por ticket: coder → revisión del supervisor → `qa` (navegador) → `done` o `fixer`.
2. Al terminar los tickets: `caos` del módulo → fixers → repetir hasta sin altos/medios.
3. `qa-final` del módulo con sus flujos y métricas → `cerrado` o tickets nuevos.
4. Status `cerrado` al gerente con métricas medidas y enlaces a evidencia.

El gerente repite 2–3 a nivel global en el cierre (secciones 6 y 7) hasta dos pasadas limpias consecutivas.

---

## 9. Documentación a entregar

- `docs/modules-catalog.md`: cada sección tocada (Compras, Pagos, Productos, Inventario, Ventas, Settings, Auth/menú) con las pantallas y componentes nuevos; sección "Componentes compartidos" con `CollapsibleSection`, `Tabs`, `PaymentFormFields`, `PrimaryStateAction`.
- `docs/auditoria-producto-2026-10.md`: añadir §8 "Estado de las recomendaciones" (tabla R1–R24: implementada / descartada con motivo / pospuesta) con las métricas antes/después medidas.
- `docs/responsive-ui.md` y `docs/design-tokens.md`: patrones nuevos (colapsables, tabs, cabecera de detalle, sheet de filtros si se añadió).
- `docs/auth-permissions.md`: toggle "admin puede vender".
- `public/openapi.yml`: endpoints nuevos (búsqueda global, saldos por contacto, inventory overview, duplicar compra).
- Parches SQL listados en el reporte.

---

## 10. Métricas de aceptación (las mide `qa-final`, antes y después)

| Métrica | Antes (auditoría) | Meta |
|---------|-------------------|------|
| Pantallas para comprar un producto nuevo y pagarlo | 5 | 1 |
| Campos visibles por línea de compra simple | 8–9 | 4 |
| Clics de detalle de compra a pago registrado | 6–8 | ≤ 3 |
| Pantallas para responder "¿por qué este stock?" | 3 | 1 |
| Bloques expandidos al abrir el detalle de producto | 8 | ≤ 3 (+ tabs) |
| Campos visibles al abrir "Cobrar" con pago móvil exacto | 6+ | 2 |
| Campos visibles al abrir "Nuevo producto" | 11 | ≤ 6 |
| "¿Qué compras debo?" desde la lista | imposible | 1 pantalla, 1 filtro |
| Selects con lista completa de productos o contactos en modales | 4 | 0 |
| Productos con % de ganancia y semáforo visibles | 0 % | 100 % |
| Pasos para fijar un precio al 30 % sobre el costo | calculadora + 1 campo | 1 chip |
| Productos cuya ganancia bajó de banda sin que nadie lo sepa | todos | 0 (cola "Por revisar") |
| Operaciones que mueven stock/dinero sin confirmación con efecto visible | 10 | 0 |
| Confirmaciones en acciones inofensivas | 3 | 0 |
| Reportes con gráfico | 0 de 13 | todos los de serie o ranking |
| Inputs de fecha nativos en reportes | 2 | 0 |
| Elegir "mes pasado" en un reporte | 2 fechas tecleadas | 1 clic |
| Gestos para marcar una compra exenta | 3 por línea | 1 por compra |
| Porcentajes de IVA tecleables a mano | 3 sitios | 0 |
| Inputs numéricos que cambian con la rueda del ratón | todos | 0 |
| Registrar una caja surtida y venderla por sabor | imposible sin compras ficticias | 1 compra + 1 apertura |
| Procesos críticos que se pierden al navegar o recargar sin aviso | todos | 0 |
| Listados que conservan filtros, orden y página al volver del detalle | 0 de 12 | 12 de 12 |

---

## 11. Definición de hecho

- [ ] 37 recomendaciones con estado final (+ abiertos P4-2, P4-3, inactivos y `pendiente_pago` del plan de stock cerrados o pospuestos con motivo) (implementada / descartada con motivo / pospuesta con dependencia) en la auditoría §8.
- [ ] Nueve módulos cerrados por su `qa-final` con métricas en objetivo (o rebaja escrita por el gerente en `decisions.md`).
- [ ] QA final global (sección 6) con capturas; métricas de la sección 10 medidas y en meta.
- [ ] Caos de módulos y global sin altos/medios; `e2e-bodegon` verde; laboratorio de stock (`stock-lab:test`, `scenarios`, `ui`, `chaos`) verde con `reconcile` 0/9.
- [ ] Ninguna RPC cambió semántica monetaria ni de stock; toda RPC nueva cumple el contrato de `stock-integrity.md` §1 y `verify-patches.sql` sigue en verde (auditor lo confirma en el diff).
- [ ] typecheck, lint, test, build en verde; sin librerías de UI nuevas no decididas en Ola 0; lint contra diálogos nativos activo y en verde.
- [ ] Docs de la sección 9; parches SQL escritos y listados, no aplicados.
- [ ] `.notes/ux-mejoras/status.md` refleja el estado final por módulo.
- [ ] Rama `feat/ux-mejoras` pusheada, sin merge, sin secretos.

---

## 12. Reporte final del gerente (única salida al humano, ≤ 50 líneas)

```text
MEJORAS DE PRODUCTO — LISTO PARA REVISIÓN
Rama: feat/ux-mejoras (N commits) · Módulos cerrados: 9/9 (Inventario: completo | diseño sin datos — motivo)
Recomendaciones: implementadas X · descartadas Y (motivos abajo) · pospuestas Z

Métricas (antes → después):
  comprar producto nuevo y pagarlo: 5 → 1 pantallas · campos/línea: 9 → 4 · pago desde compra: 7 → 3 clics
  por qué este stock: 3 → 1 · detalle producto: 8 → 3 bloques · cobrar PM exacto: 6 → 2 campos · nuevo producto: 11 → 6

Calidad: QA final global 8/8 · caos módulos N/N · caos global 10/10 · e2e-bodegon ✓ · integridad stock ✓ · auditoría 0 altos 0 medios

Por módulo (una línea cada uno): compras … · pagos … · productos … · detalles … · confirmaciones … · inventario … · pos/nav … · reportes … · compartidos …

Para desplegar:
1. Aplicar en SQL Editor: <parches>
2. Merge y deploy
3. Opcional: activar "El administrador puede vender" en Configuración

Decisiones sin consultar (≤ 6) · Descartes con motivo (≤ 4) · Hallazgos bajos (≤ 6) · No verificado (≤ 3)
```
| SHR-09 | `NumberInput` compartido (envuelve `Input`): `inputMode="decimal"`, ignora la rueda del ratón/trackpad con el campo enfocado (`onWheel` → `blur()` o `preventDefault`), selecciona el contenido al enfocar, acepta coma y punto, `min`/`max`/`step`, formato al salir. Reemplaza todos los `type="number"` del repo (compras, pagos, producto, caja, baúl, ajustes). `TaxRateChips`: chip compacto `IVA 16 %` que abre popover con las alícuotas activas de `tax_rates` como chips (la de la categoría marcada "por defecto"); **sin input numérico**. `useTaxRates()` hook cacheado. Stories + tests (incluido test de que la rueda no cambia el valor). | R32, R33, H7, H8 |
| SHR-10 | Parche SQL `tax_rates` (`id`, `store_id` nullable para globales, `code` único, `label`, `pct numeric(5,2)`, `is_active`, `sort_order`) sembrado con `exento` 0, `reducida` 8, `general` 16; `categories.tax_rate_id` (FK) manteniendo `tax_rate` como columna derivada por trigger durante la transición; `purchase_items.tax_rate_code` + `tax_rate` (snapshot, ya existe); `app_settings.default_tax_rate_id`. Migración: 16→general, 8→reducida, 0→exento; cualquier otro valor crea una alícuota `otro-<pct>` inactiva y queda listado en el reporte para que el admin lo revise. RPC `create_purchase` acepta `tax_rate_code` y rechaza porcentajes que no correspondan a una alícuota activa. Paridad mock. Endpoints `GET /api/tax-rates`, `POST/PATCH` (admin). | R32, H7 |
| SHR-12 | `useUrlListState(schema)`: hook que sincroniza con la URL un objeto de estado de lista definido con Zod (`search`, filtros tipados, `sort`, `dir`, `page`, `limit`), con valores por defecto omitidos de la URL para mantenerla corta, parseo tolerante (parámetro inválido → default), `router.replace` con `scroll: false`, debounce de 300 ms para texto, y `reset()`. Integra `usePaginationState`/`useSortState` (pasan a leer/escribir vía el hook). `PageBackButton` inteligente: recibe `fallbackHref`; al navegar de lista a detalle, el enlace de la fila añade `?from=<URL de la lista codificada>` (helper `withReturnTo(href)` en `DataTable`/`ListCard`); el botón vuelve a `from` si existe y pertenece a la app, si no a `fallbackHref`; `Esc` o `Alt+←` también vuelven. Restauración de scroll por URL (`sessionStorage` con clave = URL completa, restaurado tras cargar datos). Opcional, detrás de preferencia "Recordar filtros" (por defecto activa): al entrar a una lista por el menú **sin** parámetros, se restauran los últimos usados desde `sessionStorage` y aparece el chip "Filtros recordados · Limpiar". Stories + tests (ida y vuelta, recarga, parámetro corrupto, `from` externo rechazado). Leer la API de navegación en `node_modules/next/dist/docs/` antes de implementar. | R37, L5, L6 |
