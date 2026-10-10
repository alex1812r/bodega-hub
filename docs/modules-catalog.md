# Catálogo de módulos — BodegaHub

Documento maestro (julio 2026) que describe **todos los módulos** del proyecto: rutas, permisos, pantallas, hooks, endpoints API, tablas Supabase y huecos conocidos.

Documentos relacionados:

| Tema | Archivo |
|------|---------|
| Endpoints y payloads | [`mock-api-endpoints.md`](mock-api-endpoints.md) |
| Checklist API | [`api-endpoints-checklist.md`](api-endpoints-checklist.md) |
| Guía hooks frontend | [`frontend-api-guide.md`](frontend-api-guide.md) |
| Checklist integración UI | [`frontend-integration-checklist.md`](frontend-integration-checklist.md) |
| Modelo de datos | [`database-design.md`](database-design.md) |
| Permisos | [`auth-permissions.md`](auth-permissions.md) |
| Import Excel | [`frontend-product-bulk-import.md`](frontend-product-bulk-import.md) |
| OpenAPI | [`public/openapi.yml`](../public/openapi.yml) |

## Índice de módulos

| Módulo | Rutas app | Permiso mínimo | Tablas principales |
|--------|-----------|----------------|-------------------|
| Auth | `/login`, `/` | — / sesión | `profiles`, `auth.users` |
| Platform (superadmin) | `/platform/dashboard`, `/platform/stores`, `/platform/users`, `/platform/reports` | `platform.dashboard.view`, `platform.stores.*`, `platform.users.*`, `platform.reports.view` | `stores`, `profiles`, vistas de reportes/dashboard |
| Dashboard | `/dashboard` | `dashboard.view` | vistas agregadas, `sales`, `products` |
| Productos | `/products`, `/products/[id]`, `/products/categories`, `/products/import` | `products.view` / `products.manage` | `products`, `categories`, `product_price_history` |
| Inventario | `/inventory`, `/inventory/movements` | `inventory.view` / `inventory.manage` | `products`, `stock_movements` |
| Contactos | `/contacts`, `/contacts/[id]` | `contacts.view` / `contacts.manage` | `contacts` |
| Ventas | `/sales`, `/sales/create`, `/sales/[id]` | `sales.view` / `sales.create` | `sales`, `sale_items`, `payments` |
| Compras | `/purchases`, `/purchases/create`, `/purchases/[id]` | `purchases.view` / `purchases.create` | `purchases`, `purchase_items`, `supplier_products` |
| Pagos | `/payments`, `/payments/[id]` | `payments.view` / `payments.manage` | `payments` |
| Caja | `/cash`, `/cash/registers` | `cash.view` / `cash.operate` / `cash.manage` | `cash_registers`, `cash_sessions` (`closed_reason`), `cash_movements` |
| Baúl | `/vault` | `vault.view` / `vault.manage` | `store_vaults` (`balance_efectivo_ves`, `balance_ves` cuenta, `balance_ref`), `vault_movements.bucket` |
| Nómina | `/payroll`, `/payroll/[id]`, `/payroll/settings`, `/payroll/mine` | `payroll.manage` / `payroll.view_own` | `payroll_settings`, `payroll_employees`, `payroll_periods`, `payroll_items`, `payroll_commission_sales` |
| Reportes | `/reports` | `reports.view` | vistas `daily_sales_summary`, etc. |
| Asistente IA | `/assistant` | `assistant.use` | `assistant_queries`, vista `store_capital_summary` |
| Settings | `/settings` | `settings.view` / `users.manage` | `app_settings`, `profiles`, `exchange_rates` |

**Rol admin:** sin `sales.create` ni `cash.operate` (no POS ni “Mi caja”). Conserva `sales.view`, `cash.manage` y `vault.*`. Para reactivar: devolver esos permisos en [`src/shared/auth/permissions.ts`](../src/shared/auth/permissions.ts).

**Caja — tope de jornada:** una sesión abierta vence al **mínimo** entre medianoche Caracas del día de apertura y 24 h. El cron `GET/POST /api/cron/cash-sessions/auto-close` (cada 15 min, `CRON_SECRET`) cierra con el monto teórico y no transfiere al baúl. POS y Mi caja muestran cuenta regresiva y bloquean ventas al vencer. Patch: `supabase/patches/20260819-cash-session-auto-close.sql`.

**Caja — reglas de turno (POS-F3, aplicadas en el BFF; las RPC `open_cash_session` / `close_cash_session` no cambian):**

- **Abrir** (`POST /api/cash/session/open`): solo la caja asignada a quien la abre (otra o sin asignar → 403) y un solo turno abierto por usuario (con uno propio abierto en otra caja → 409).
- **Cerrar** (`POST /api/cash/session/close`, `cash.operate` o `cash.manage`): solo el turno que abrió quien llama; ajeno → 403, inexistente o de otra tienda → 404. Un administrador ya no cierra por esta ruta el turno de un vendedor.
- **Asignar caja** (`PATCH /api/cash/registers/[id]`, pantalla Cajas): a cualquier usuario activo con `cash.operate` efectivo (`canBeAssignedCashRegister`), no solo vendedores; otro → 400. Si el usuario ya tiene otra caja activa asignada → 409 «Ese usuario ya tiene otra caja activa asignada. Desasígnala antes de asignarle esta.»; la pantalla muestra el motivo del servidor en un `Toast` y el selector vuelve al valor real.
- **Cierre con totales frescos** (`CloseCashSessionModal` + `useCashCloseTotals`, POS-F8): el modal lee teórico, ventas y cobros en cuenta de `GET /api/cash/movements` en cada apertura, nunca de la caché. Hasta que llega la lectura muestra «Actualizando los totales de la caja…», sin montos precargados ni botón de cerrar activo; si falla lo dice y ofrece «Reintentar». «Mi caja» relee el dinero del turno al entrar (`useCashMovements(…, { alwaysFresh: true })`) y muestra «Actualizando…» en lugar de una cifra vieja.
- **Jornada vencida** (`CashSessionExpiredPanel`): «Cerrar con teórico y continuar» lee el teórico del servidor en ese momento (si no puede, no cierra) y lleva un cerrojo síncrono contra el doble clic.

Detalle y casos límite en [`auth-permissions.md`](auth-permissions.md#abrir-y-cerrar-caja-las-mismas-reglas-que-el-vendedor).

Rutas auxiliares: `/api-docs` (Swagger), `/dev/welcome` (demo). Rutas legacy `/products/detail`, `/contacts/detail`, etc. redirigen a `[id]` con query `?id=`.

---

## Arquitectura transversal

```text
page.tsx (App Router)
  → AuthenticatedAppShell (permiso + menú + tasa header)
  → módulo src/modules/<dominio>/<página>/page.tsx
  → hooks TanStack Query
  → apiFetch("/api/...")
  → Route Handler src/app/api/...
  → *.mock-server.ts | *.server.ts
  → Supabase tablas / RPC
```

- **Sesión:** cookies Supabase vía `POST /api/auth/login`; perfil `GET /api/auth/me`.
- **Entrada `/`:** redirect en [`src/proxy.ts`](../src/proxy.ts) según sesión/rol (home del usuario o `/login`).
- **401 global:** `apiFetch` (y, como red de seguridad, [`src/lib/query/query-client.ts`](../src/lib/query/query-client.ts)) lleva a `/login?next=<ruta actual>` ante cualquier 401 que no sea el del propio login. Ver [Sesión caducada y login](#sesión-caducada-y-login).
- **Demo dev:** `ALLOW_DEMO_AUTH=true` + headers `x-demo-role` desde `localStorage`.
- **Paginación:** `PaginatedList<T>` con `skip`, `limit`, `total`, `items`.
- **Plantilla Excel:** generación con **exceljs**; lectura de archivos subidos con **xlsx**.
- **Componentes compartidos:** `src/shared/components/`. `DataTable` acepta `renderExpandedRow(row)`: el contenido expandido se pinta en una fila propia a todo el ancho bajo la fila (al pie de la tarjeta en móvil); `null` / `false` = cerrada. Qué fila está abierta y el botón que la abre (`aria-expanded` / `aria-controls`) son de la pantalla que usa la tabla (hoy, `/inventory`).
- **`RouteError`** ([`src/shared/components/RouteError/`](../src/shared/components/RouteError/RouteError.tsx)): contenido de todo `error.tsx` de ruta (`src/app/error.tsx`, `global-error.tsx`, `dashboard/`, `reports/`, `sales/create/`). En español y con el tema; nunca enseña el `message` ni la traza del error (van a la consola), solo el `digest` como «Referencia para soporte». Props: `title`, `description?`, `error`, `retry` (el `unstable_retry` de `error.tsx`), `queryKey?` (descarta esas consultas antes de reintentar) y `homeHref?` (`/` por defecto; `null` oculta «Volver al inicio», como en el POS, que conserva el menú). No necesita proveedores. El 404 de toda la app es `src/app/not-found.tsx` («No encontramos esta página»).
- **`GlobalSearch`** (`src/shared/components/AppShell/GlobalSearch.tsx`): buscador del header; lo monta `AppHeader` con los permisos efectivos. Ver [Búsqueda global](#búsqueda-global).
- **Helpers del BFF** (obligatorios en rutas nuevas; convenciones en [`frontend-api-guide.md`](frontend-api-guide.md#convenciones-del-bff)):
  - `readJsonBody(request)` / `readOptionalJsonBody(request)` ([`src/lib/api/readJsonBody.ts`](../src/lib/api/readJsonBody.ts)): cuerpo vacío o que no es JSON → 400 `BAD_REQUEST` «El cuerpo de la solicitud no es un JSON válido.» (antes 500). La variante opcional devuelve `{}` cuando no hay cuerpo.
  - `fetchListPage({ rows, count })` ([`src/lib/supabase/pagination.ts`](../src/lib/supabase/pagination.ts)): página de una lista con `count: "exact"` + `.range()`; si `skip` cae más allá del total (PostgREST 416 / `PGRST103`) recuenta con los mismos filtros y responde sin filas y con el total real, como `paginateList` en el mock. `count` solo se ejecuta en ese caso.
  - `sessionErrors` ([`src/lib/supabase/auth/sessionErrors.ts`](../src/lib/supabase/auth/sessionErrors.ts)): `isSessionAuthError` («no hay sesión válida» → 401) e `isAuthServiceFailure` (Supabase no llegó a decidir → 5xx). Clasifican los errores de `getUser()` por tipo, código y estado HTTP, no por texto.
  - `loginRedirect` ([`src/shared/auth/loginRedirect.ts`](../src/shared/auth/loginRedirect.ts)): `buildLoginUrl`, `resolveLoginNextPath`, `isLoginNextPath` y `redirectToLoginOnSessionExpired` (una sola navegación aunque fallen varias peticiones a la vez).
- **`ConfirmActionModal`** ([`src/shared/components/ConfirmActionModal/`](../src/shared/components/ConfirmActionModal/ConfirmActionModal.tsx)): confirmación única de toda acción que mueve stock, dinero, costos, precios o permisos. Base: `title`, `description`, `confirmLabel` (obligatoria, explícita), `effects` (`{ label, before?, after?, tone? }`) o `renderEffects()`, `children` (contexto: documento, nota), `variant="danger"`, `requireTypedConfirmation` (palabra a teclear, sin distinguir mayúsculas), `error` (mensaje del negocio tal cual), `isPending` y cerrojo propio contra el doble clic. **Props de estado del efecto** (para cuando el efecto se calcula con una petición, p. ej. un `impact`):
  - `status`: `"ready"` (por defecto) · `"loading"` (zona de carga en lugar de los efectos) · `"error"` (no se pudo calcular) · `"blocked"` (la acción no se puede ejecutar). Fuera de `ready` **no hay botón de confirmar**, ni lista de efectos, ni palabra tecleada (lo escrito se borra): no se confirma a ciegas.
  - `statusMessage`: texto de la carga, mensaje del error o motivo del bloqueo (tal cual lo dice el servidor); si falta, uno por defecto («Calculando qué va a pasar…», «No se pudo calcular el efecto de la acción.», «La acción no se puede ejecutar ahora.»).
  - `statusHint`: línea secundaria bajo `statusMessage` (p. ej. «No se ha cambiado nada.»).
  - `onRetry`: solo con `status="error"`; pinta «Reintentar».
  - `blockedActions`: solo con `status="blocked"`; salidas alternativas (botones o enlaces) en el pie, después de «Cerrar».
  - `closeLabel`: etiqueta del botón de cerrar cuando `status` no es `ready` (por defecto «Cerrar»; en `ready` es `cancelLabel`).
  - `ConfirmActionScrollArea` (`{ labelledBy, className?, children }`): zona con scroll propio para los efectos o listas largas del contexto; si desborda se vuelve parada de Tab con nombre (se lee con flechas, AvPág y Fin), si cabe no añade nada al orden de foco.
- **Efecto calculado en servidor — `src/shared/impact/`** (CNF-14). Endpoints de **solo lectura** que dicen qué hará la acción antes de ejecutarla, siguiendo a la RPC real en su orden de guardas:
  - `GET /api/sales/[id]/impact?action=cancel|return` (permiso `sales.create`), `GET /api/purchases/[id]/impact?action=receive|cancel|return[&disassemble=<json>]` (`purchases.create`), `GET /api/payments/[id]/impact?action=cancel` (`payments.manage` + acceso al pago). `action` ausente, repetida o inválida → 400; documento inexistente **o de otra tienda → 404**; siempre `Cache-Control: no-store`.
  - Respuesta `{ data }` con un veredicto común (`ImpactVerdict`: `allowed`, y si es `false` `reason` = mensaje exacto de la RPC + `reasonCode`), el documento con su estado antes → después, líneas de stock (`ImpactStockLine`: `quantityDelta`, `stockBefore`, `stockAfter`), pagos (`ImpactPaymentLine` con `outcome` `reverted | already_cancelled | blocks_action | unchanged` y `effects: ImpactMoneyEffect[]` con `target` `caja | baul_cuenta | baul_efectivo_ves | baul_ref`, `delta` con signo y, en baúl, `balanceBefore/After`) e `inexact: { reason }` cuando una parte no se puede predecir con exactitud (nunca se inventa la cifra). Con `allowed=false` no se proyecta nada (el "después" es el "antes").
  - Piezas compartidas: `types.ts`, `impactVerdict.ts` (`impactAllowed`, `impactRejected`, `firstInexact`, `toCents`/`fromCents`: el dinero se suma en céntimos enteros), `impactServer.ts` (`parseImpactAction`, `assertImpactDocumentId`, `impactJson`) e `impactQuery.ts` (`impactQueryOptions`: sin caché entre aperturas, sin reintentos ni refrescos en segundo plano; `impactQueryKey("sales"|"purchases"|"payments", id, action)`).
  - Lo que de verdad hacen las RPC (y por tanto muestra el modal): **anular** una venta o una compra con un pago activo se rechaza (`allowed=false`, el pago sale `blocks_action`): ninguna de las dos toca dinero. **Devolver una venta** es siempre total y anula cada pago activo con `cancel_payment_apply`. **Recibir una compra** fija el último costo con IVA (no promedio) y, al desarmar, el componente queda en promedio ponderado. **Cancelar/devolver una compra** no revierte pagos ni costos. **Anular un cobro** saca el dinero de la caja (borra su asiento) y **anular un pago a proveedor** lo devuelve al baúl sin cambiar el estado de la compra. No existe devolución parcial en `return_sale` (la parcial es un ajuste `devolucion_cliente`, otra acción).
  - Casos declarados inexactos: modo demo (el mock no guarda asientos de caja/baúl por pago), más de un asiento del mismo tipo para un pago, baúl ilegible, asiento de caja de tipo desconocido, producto que ya no existe, costo/IVA/peso no legibles. No detectable en lectura: carreras entre el impact y la ejecución; por eso el modal muestra además el `error.message` de la mutación si la RPC rechaza.
  - Para añadir un impact: función pura `compute…Impact` en `src/modules/<dom>/services/<doc>Impact.ts`, cargador `…Impact.server.ts` (solo `select`, filtrando `id` + `store_id` del servidor) y `…Impact.mock-server.ts` con la misma firma, ruta con `requireStorePermission(<permiso de la acción real>)` → `parseImpactAction` → `resolveDataSource()` → `impactJson`, entrada en `public/openapi.yml`, hook con `impactQueryOptions` y test de laboratorio copiando `scripts/stock-lab/regression/impact-sale.test.ts`.

### Procesos protegidos (ProcessGuard)

Regla 14: ningún proceso a medias se pierde sin aviso. [`useProcessGuard`](../src/shared/hooks/useProcessGuard.ts) (y `ProcessGuard` / `ProcessGuardModal` / `GuardedLink` en [`src/shared/components/ProcessGuard/`](../src/shared/components/ProcessGuard/ProcessGuard.tsx)) pregunta con el modal del tema «¿Salir sin terminar?», **nombrando el proceso**, antes de: seguir un enlace interno a otra ruta, ATRÁS del navegador, `guardedNavigate(href)` y `requestLeave(run)`. Recargar o cerrar la pestaña muestra el aviso nativo (`beforeunload`, única excepción a "nada de diálogos nativos"). `router.push`/`replace` directos **no** se interceptan: dentro de una pantalla protegida se navega con `guardedNavigate` y, cuando es el propio proceso el que termina, con `runUnguarded`. «Seguir aquí» no pierde nada; «Salir» guarda el borrador (`onLeave: "draft"`) o descarta (`"discard"`).

Lista completa de lo protegido (leída del código):

| Proceso (texto que nombra el modal) | Pantalla / componente | Se activa cuando | Modo | Borrador | Se desactiva |
| --- | --- | --- | --- | --- | --- |
| «Compra a X · N líneas · REF T» / «Compra sin proveedor · …» | `/purchases/create` (`purchase-create/page.tsx`) | hay ≥ 1 línea **o** proveedor elegido, y la compra no está confirmada | `draft`; pasa a `discard` (con explicación) si no hay dónde guardar: ya hay dos borradores sin decidir o `localStorage` no deja escribir | `localStorage` `bodegahub:compras:borrador:v1:<tienda>:<usuario>` (segunda ranura `…:nuevo`). Guardado automático 500 ms después de cada cambio (`PURCHASE_DRAFT_SAVE_DELAY_MS`); «Salir» lo escribe en el acto. Se invalida al confirmar la compra o descartarlo, y se ignora si es de otra tienda/usuario/versión o está corrupto. Nunca guarda el pago inicial ni la clave de idempotencia | al confirmar: `runUnguarded` navega al detalle sin preguntar |
| «Venta en curso · N productos · REF T · cliente» | POS `/sales/create` (`sale-create/page.tsx` + `usePosCartDraft`) | el carrito tiene líneas. **Solo al salir de la ruta del POS** | `draft`; `discard` si `localStorage` no dejó guardar | `localStorage` `bodegahub:pos:carrito:v1:<tienda>:<usuario>:<caja>:<pestaña>`: líneas, cliente, sesión de caja y fecha. Guardado 500 ms después del último cambio (`POS_CART_DRAFT_SAVE_DELAY_MS`) y al salir. Al volver se restaura revalidado contra el catálogo, con el aviso «Carrito recuperado» (y «Vaciar»). Se invalida: carrito vacío (venta cobrada u orden limpiada) lo borra en el acto; uno de otra sesión de caja no se restaura y se borra; caja cerrada o vencida borra todos los del usuario. Nunca guarda datos del cobro ni la clave de idempotencia | al cobrar o vaciar (carrito sin líneas) |
| «Producto nuevo «X» sin guardar» / «Edición de producto «X»» / «Proveedores del producto «X» sin guardar» | `ProductFormModal` | abierto, con cambios respecto a como abrió (campos, imagen, empaque, proveedores) y sin guardado en curso | `discard` | — | al guardar; tras «Guardar y crear otro» el formulario queda limpio |
| «Contacto nuevo «X» sin guardar» / «Edición de contacto «X»» | `ContactFormModal` | abierto, con algún campo distinto de como abrió (volver al valor original no cuenta) y sin guardado en curso | `discard` | — | al guardar; tras «Guardar y crear otro» |
| «Importación de productos · paso N de 5 · K filas» | `ProductImportWizard` (`/products/import`) | desde el paso 2 con archivo cargado o leyéndose, en la vista previa y mientras importa | `discard` (el archivo no se puede guardar) | — | en la plantilla (paso 1), en el paso 2 sin archivo y en el resumen final |
| «Pago de Bs X a Proveedor sin registrar» / «Cobro de Bs X a Cliente sin registrar» | `RegisterPaymentModal` (pagar compra / cobrar venta) | abierto y el usuario cambió el método o tecleó monto, banco, teléfono, referencia o nota. El monto de «Completar saldo» o de un atajo de porcentaje **no cuenta** hasta que se edita | `discard` | — | al registrar el pago (formulario limpio; el modal sigue abierto para otro abono), con el pago en vuelo y con un intento por confirmar |
| «Cobro en curso» / «Pago en curso» | `RegisterPaymentModal` | abierto con el pago en vuelo o por confirmar (resultado incierto) | `discard` | el intento por confirmar vive en la instancia del modal (misma clave de idempotencia al reintentar) | al registrarse, al rechazarlo el servidor con 4xx o al descartarlo |
| «Pago de Bs X a Proveedor sin registrar» / «Cobro de Bs X a Cliente sin registrar» | `ContactSettlementModal` («Abonar»), pasos formulario y reparto | abierto y el usuario cambió el método o tecleó monto, banco, teléfono, referencia o nota. El monto de «Completar total pendiente» y el que deja «Volver a editar» **no cuentan** hasta que se editan | `discard` | — | con el resultado del abono a la vista (paso de envío), con pagos en vuelo y con un abono por confirmar |
| «Abono en curso» | `ContactSettlementModal` | hay pagos del abono enviándose o un abono por confirmar | `draft` | `sessionStorage` por tienda, usuario, contacto y tipo (`pendingSettlementStore`): se escribe en cada paso de la secuencia y se borra al resolverse o descartarse | al registrarse todos los pagos, al rechazarlos el servidor o al descartarlo |
| «Ajuste de stock de «Producto» sin registrar» | `InventoryAdjustmentModal` (Inventario, detalle del producto, formulario de producto) | abierto y cambió el producto, el tipo, la cantidad o el motivo. El producto precargado o bloqueado no cuenta | `discard` | — | al registrar el ajuste (cierra) y con el ajuste en vuelo |
| «Conversión de «Empaque» sin registrar» | `InventoryPackConversionModal` | abierto y cambió el empaque, la cantidad (inicial: 1), el reparto del surtido o el motivo | `discard` | — | al convertir (cierra y avisa con un toast) y con la conversión en vuelo |
| «Apertura de empaque «Empaque» sin registrar» | `ProductDetailPackConversionCard` (modal «Abrir empaque» del detalle) | abierto y cambió la cantidad (inicial: 1), el reparto del surtido o el motivo | `discard` (al salir se limpian cantidad y motivo) | — | al abrir el empaque (cierra) y con la apertura en vuelo |
| «Cierre de caja «Caja 1» sin terminar» | `CloseCashSessionModal` | abierto y lo contado difiere de lo precargado (el teórico). Lo precargado sin tocar no cuenta | `discard` | — | al cerrar la caja y con el cierre en vuelo |
| «Apertura de caja «Caja 1» sin terminar» | `OpenCashSessionModal` (Caja y puerta de entrada al POS, `PosCashSessionGate`) | abierto y un monto difiere de como abrió (vacío o precargado con el último cierre sin transferir) | `discard` | — | al abrir la caja y mientras se abre |
| «Retiro del baúl de Bs X · REF Y sin registrar» / «Depósito al baúl … sin registrar» | `VaultCashMovementModal` (`VaultWithdrawalModal`, `VaultDepositModal`) | abierto con un monto o una nota tecleados | `discard` | — | al registrar (cierra) y con la operación en vuelo |
| «Transferencia de N cierres al baúl sin registrar» | `VaultTransferFromCashModal` | abierto con cierres seleccionados o una nota tecleada | `discard` | — | al transferir (cierra) y con la transferencia en vuelo |

`RestockSelection` y `PageBackButton` no protegen nada propio: usan `guardedNavigate` / `GuardedLink` para respetar al guardia que esté activo en la pantalla.

**Modales con confirmación interna.** Los modales de dinero y stock tienen su propio paso de confirmación (`ConfirmActionModal`). Cancelarla (botón, Esc) vuelve al formulario y **no** dispara el guardia: este solo responde al cierre del formulario (Esc, clic fuera, Cancelar, la X) y a salir de la pantalla. Si el guardia pregunta con la confirmación abierta (ATRÁS del navegador), la confirmación se oculta mientras dura la pregunta y vuelve con «Seguir aquí»: nunca hay tres niveles apilados. Con la petición en vuelo el modal no se cierra y el guardia de datos tecleados está inactivo.

**Cómo proteger un proceso nuevo.**

- *Formulario en modal:* [`useFormModalDiscardGuard({ active, label })`](../src/shared/hooks/useFormModalDiscardGuard.ts) → `{ guard, requestClose, trackFocus }`. `active` = modal abierto **y** datos cambiados respecto a como abrió **y** sin petición en vuelo (lo precargado no cuenta: guarda el punto de partida y compara contra él). En el `onOpenChange` del `Modal`, el cierre pasa por `requestClose(() => { limpiar; cerrar })`; el botón Cancelar llama solo a `close` (sin limpiar antes: se limpia dentro de `requestClose`). `onFocus={trackFocus}` en el formulario (para devolver el foco con «Seguir aquí») y `<ProcessGuardModal guard={guard} />` **dentro** del `Modal`. Si hay confirmación interna, su `open` es `confirmOpen && !guard.dialog.open`. El camino de éxito limpia el formulario y cierra directamente (sin `requestClose`): al quedar limpio el guardia se apaga solo. `label` nombra el proceso con su dato principal («… de «Producto» sin registrar»).
- *Pantalla completa:* `useProcessGuard({ active, label, onLeave, onSaveDraft?, onDiscard?, description? })` + `<ProcessGuardModal guard={guard} />`; `guardedNavigate` para la navegación interna y `runUnguarded` para la que hace el proceso al terminar. Con `"draft"`, `onSaveDraft` debe escribir en el acto (el aviso nativo no espera) y el borrador se ofrece al volver.
- *Tests:* el hook usa `useRouter`, así que todo test que monte un componente protegido simula `next/navigation`. Utilidades en `src/shared/hooks/useFormModalDiscardGuard.testUtils.tsx` (cuatro formas de cerrar, «Seguir aquí»/«Salir», `beforeunload`, enlace a otra ruta); patrón en los `*.discard-guard.test.tsx`.
- **Nunca entre pasos del cobro del POS.** Confirmar una venta no lleva modal de confirmación ni guardia: es flujo de cajero y se protege con caja abierta, validación de stock e idempotencia. El guardia del POS solo pregunta al **salir de la ruta** con el carrito lleno; abrir el cobro, el cliente o el escáner no lo dispara, y `PosCheckoutModal` y el resto de `src/modules/sales/sale-create/**` no usan `useFormModalDiscardGuard`. `RegisterPaymentModal`, `ContactSettlementModal` y `PaymentFormFields` no se montan dentro del POS. El único modal protegido que aparece en esa ruta es `OpenCashSessionModal`, desde `PosCashSessionGate`: se muestra **antes** de entrar al POS, cuando no hay caja abierta (ni carrito ni cobro), y solo pregunta si se tecleó un fondo y se cierra sin abrir la caja.

---

## Auth

Login, sesión y perfil. Roles: `superadmin`, `admin`, `vendedor`, `almacen`, `contador`.

### Rutas y permisos

| Ruta | Guard | Descripción |
|------|-------|-------------|
| `/login` | Público | Formulario email/password |
| `/` | Server redirect | Con sesión → home por rol; sin sesión → `/login` |
| `/platform/dashboard` | `platform.dashboard.view` | Inicio multi-tienda (KPIs, tendencia, ventas, bajo stock) |
| `/platform/stores*` | `platform.stores.*` | Backoffice tiendas (no opera ERP) |
| `/platform/users*` | `platform.users.*` | Directorio usuarios + crear admin de tienda |
| `/platform/reports` | `platform.reports.view` | Reportes multi-tienda (una / seleccionadas / todas) |

### Hooks y endpoints

| Hook | Método | Endpoint | Campos / respuesta |
|------|--------|----------|-------------------|
| `useLogin` | POST | `/api/auth/login` | Body: `email`, `password` → cookies + `{ role, user }` |
| `useLogout` | POST | `/api/auth/logout` | Limpia sesión y cache |
| `useCurrentUser` | GET | `/api/auth/me` | `user`, `role`, `storeId`, `permissions`, overrides |

### Platform (superadmin)

| Ruta UI | Permiso | API |
|---------|---------|-----|
| `/platform/dashboard` | `platform.dashboard.view` | `GET /api/platform/home/*?storeScope=&storeIds=` |
| `/platform/stores` | `platform.stores.view` | `GET /api/platform/stores` |
| `/platform/stores/new` | `platform.stores.manage` | `POST /api/platform/stores` |
| `/platform/stores/[id]` | `platform.stores.view` / `.manage` | `GET/PATCH /api/platform/stores/[id]` |
| `/platform/users` | `platform.users.view` | `GET /api/platform/users` |
| `/platform/users/[id]` | `platform.users.view` | `GET /api/platform/users/[id]` |
| `/platform/users/new-admin` | `platform.users.manage` | `POST /api/platform/users` (solo rol `admin`) |
| `/platform/reports` | `platform.reports.view` | `GET /api/platform/reports/[report]?storeScope=&storeIds=` |

Módulo: `src/modules/platform/`. Aislamiento ERP: `requireStorePermission` + `store_id`. Ver [`multi-store-options.md`](multi-store-options.md).

### Flujo

1. Usuario envía credenciales → BFF valida en Supabase Auth + `profiles.is_active`.
2. Shell carga `useCurrentUser` → filtra menú con permisos efectivos.
3. Cada request de negocio pasa `requireStorePermission` (ERP) o `requirePermission` (plataforma).

### Menú lateral

Definido en [`src/shared/components/AppShell/appShellNav.ts`](../src/shared/components/AppShell/appShellNav.ts) y pintado por `AppNavLinks` (sidebar de escritorio y `MobileNavDrawer`).

- **Cuatro grupos colapsables** (`CollapsibleSection`): **Operación** (Inicio, Ventas, Mi caja, Compras, Inventario, Productos, Contactos), **Dinero** (Cajas, Baúl, Pagos, Nómina, Mis recibos), **Análisis** (Reportes, Asistente) y **Configuración** (Configuración; Tiendas y Usuarios de plataforma). Cada entrada se filtra solo por su permiso (`buildAppNavGroups`); un grupo sin entradas visibles no se pinta.
- **Orden y apertura por rol** (`appNavRoleLayouts`): vendedor → Ventas y Mi caja primero, Operación abierta; almacén → Inventario y Compras primero, Operación abierta; contador → grupos en orden Dinero, Análisis, Operación, Configuración, con Dinero y Análisis abiertos; admin → Operación y Dinero abiertos; superadmin → todos abiertos.
- **Estado recordado:** lo que el usuario pliega o despliega se guarda en `localStorage` (`bodega-hub:nav-group:<grupo>`). El grupo de la ruta activa (`findActiveNavGroupId`, también en subrutas como un detalle) se muestra abierto al llegar aunque estuviera guardado como plegado.
- **Riel colapsado:** sin títulos de grupo, solo iconos separados por una línea; cada icono muestra su nombre en un tooltip (`SidebarTooltip`) con `position: fixed`, a la derecha del icono, para que el riel con scroll no lo recorte.

### Búsqueda global

`GlobalSearch` en el header + `useGlobalSearch` → `GET /api/search?q=` (módulo `src/modules/search/`, con `search.server.ts` y `search.mock-server.ts`).

- **Qué busca:** productos (código de barras, SKU, nombre), ventas y compras (número, contacto) y contactos; hasta 5 resultados por tipo (`GLOBAL_SEARCH_LIMIT`). Respuesta `{ products, sales, purchases, contacts }`.
- **Permisos por tipo:** la ruta exige sesión de tienda con al menos uno de `products.view`, `sales.view`, `purchases.view`, `contacts.view` y devuelve cada tipo solo si el usuario tiene el suyo; el vendedor solo recibe contactos de tipo `cliente`. La tienda sale de la sesión. Sin ninguno de esos permisos el buscador no se muestra.
- **Límites:** `q` se normaliza (sin caracteres de control, espacios simples). Con menos de 2 caracteres o solo comodines responde los grupos vacíos sin consultar; más de 80 → 400.
- **UI:** consulta con 250 ms de espera y cancela la petición anterior; flechas y Enter eligen, `Esc` cierra. Enter sin opción resaltada va al único producto con ese código de barras o a la única coincidencia exacta. Navega con `guardedNavigate`: respeta el guardia de un proceso a medias (p. ej. el carrito del POS).
- **Atajo `/`:** enfoca el buscador desde cualquier pantalla, salvo con el foco en un campo de texto (incluido el buscador del POS), con un modal abierto o cuando la tecla forma parte de una ráfaga del lector de códigos.
- **Móvil (< `sm`):** el header muestra solo la lupa («Abrir búsqueda»); al pulsarla el campo ocupa el header a todo el ancho.

### Sesión caducada y login

- **BFF:** una sesión rota (sin cookie, access token caducado con refresh token inválido, revocado o ya usado, JWT manipulado; por cookies o Bearer) responde siempre **401 `UNAUTHORIZED`** con el mensaje único del BFF, nunca 500. Cualquier rechazo 4xx del servidor de auth al leer la sesión cuenta como sesión caducada, salvo 429 y 409 (límite de peticiones y refrescos simultáneos de una sesión que sigue siendo válida), que siguen siendo error de servidor (`sessionErrors.ts`). Barrido de todas las rutas: `src/lib/supabase/auth/sessionExpired.routes.test.ts`.
- **Cliente:** `apiFetch` redirige con una navegación de documento a `/login?next=<ruta + query>` ante cualquier 401 que no sea el del login. `next` solo acepta rutas internas seguras (`isSafeInternalPath`) distintas de `/login`; tras entrar se vuelve ahí y, si no es válido, al inicio del rol. La navegación dispara `beforeunload`, así que `useProcessGuard` guarda el borrador del proceso en curso.
- **Páginas:** [`src/proxy.ts`](../src/proxy.ts) redirige a `/login?next=` toda página privada sin sesión válida: `/dashboard`, `/products`, `/sales`, `/purchases`, `/inventory`, `/contacts`, `/payments`, `/reports`, `/settings`, `/platform`, `/vault`, `/cash`, `/payroll`, `/assistant`. Una carpeta de página nueva entra en esa lista o en las públicas de `proxy.test.ts`.
- **Login (`POST /api/auth/login`):** credenciales inválidas → 401; usuario **inactivo**, sin perfil o **bloqueado** en Supabase Auth → **403** y sin sesión (el BFF cierra la que `signInWithPassword` acaba de crear; si no puede cerrarla responde 503 en vez de dejar la cookie puesta); demasiados intentos → 429; Supabase caído → 503. Nunca se devuelve el texto de GoTrue. El formulario envía un solo POST por intento.

### Pendiente

- MFA, registro, recuperación de contraseña.

---

## Dashboard

| Ruta | Permiso |
|------|---------|
| `/dashboard` | `dashboard.view` |

**UI:** tarjetas resumen, métricas por rango, tablas ventas recientes y stock bajo con paginación. Filtros de fecha = **día operativo America/Caracas** (`from`/`to` → UTC `[T04:00Z, siguiente T04:00Z)`). KPIs: Hoy / Ayer / rango / Desde el inicio, con comparación al periodo anterior equivalente (segunda llamada a metrics).

| Hook | Endpoint | Query / notas |
|------|----------|---------------|
| `useDashboardSummary` | GET `/api/dashboard/summary` | — |
| `useDashboardMetrics` | GET `/api/dashboard/metrics` | `from`, `to`, `fromStart` (`fromStart=1` omite cota inferior; `to` = hoy) |
| `useDashboardRecentSales` | GET `/api/dashboard/recent-sales` | `skip`, `limit` |
| `useDashboardLowStock` | GET `/api/dashboard/low-stock` | `skip`, `limit` |
| — | GET `/api/dashboard/daily-close` | Cierre del día: ventas + mix pagos + FX + caja/baúl |
| `useDashboardRecentSales` | GET `/api/dashboard/recent-sales` | `skip`, `limit` |
| `useDashboardLowStock` | GET `/api/dashboard/low-stock` | `skip`, `limit` |
| `useCurrentExchangeRate` | GET `/api/exchange-rates/current` | Tasa en header del shell |

**Tablas/vistas:** `daily_sales_summary`, `low_stock_products`, agregados sobre `sales`.

**Pendiente:** enlaces desde filas a detalle.

---

## Productos

### Rutas

| Ruta | Permiso | Pantalla |
|------|---------|----------|
| `/products` | `products.view` | Listado, filtros, crear, importar, desactivar, enlace a categorías. Costo/PVP en una columna: **REF** (principal) + Bs (secundario) con `useCurrentExchangeRate`. Costo se muestra **con impuesto** de la categoría (`currentCostRef × (1 + taxRate/100)`); en DB el costo sigue siendo neto |
| `/products/categories` | `products.view` | CRUD categorías (escritura: `products.manage`) |
| `/products/[id]` | `products.view` | Resumen, stock, historial precios, historial de ventas del SKU, proveedores (tabla + cards + M10–M14), editar |
| `/products/import` | `products.manage` | Wizard importación Excel |

### Hooks y endpoints

| Hook | Endpoint |
|------|----------|
| `useProducts` | GET `/api/products` — `search`, `categoryId`, `isActive`, `skip`, `limit` |
| `useProduct` | GET `/api/products/[id]` |
| `useCreateProduct` | POST `/api/products` |
| `useUpdateProduct` | PATCH `/api/products/[id]` |
| `useUpdateProductPrice` | POST `/api/products/[id]/price` → RPC `update_product_price` |
| `useProductPriceHistory` | GET `/api/products/[id]/price-history` |
| `useProductSales` | GET `/api/products/[id]/sales` — `skip`, `limit`; datetime Caracas; totales `units`/`totalRef`/`totalVes` (excluye `cancelada`) |
| `useProductSuppliers` | GET `/api/products/[id]/suppliers` |
| `useCategories` | GET `/api/categories` — `search`, `skip`, `limit` |
| `useCreateCategory` | POST `/api/categories` |
| `useUpdateCategory` | PATCH `/api/categories/[id]` |
| `useDeleteCategory` | DELETE `/api/categories/[id]` (soft delete) |
| `useProductBulkImport` | GET template, POST por fila — ver [`frontend-product-bulk-import.md`](frontend-product-bulk-import.md) |

### Campos producto (API / formulario)

| Campo API | Formulario | Tabla `products` |
|-----------|------------|------------------|
| `sku` | sí | `sku` unique |
| `name` | sí | `name` |
| `categoryId` | sí | `category_id` |
| `salePriceRef` | sí | `sale_price_ref` |
| `currentCostRef` | sí | `current_cost_ref` |
| `currentStock` | solo al crear (stock inicial); en edición se muestra bloqueado | `current_stock` |
| `minStock` | sí | `min_stock` |
| `description` | textarea UI | `description` (no siempre enviado) |
| `imageUrl` | subida con recorte 4:3 | `image_url` |
| `isActive` | desactivar listado | `is_active` |

**El stock nunca se escribe por PATCH.** `PATCH /api/products/[id]` responde 400 si llega `currentStock`: el formulario de edición mandaba el valor cargado al abrir y pisaba las ventas hechas mientras tanto, sin dejar fila en `stock_movements`. Las existencias solo cambian por RPC con movimiento (`create_sale`, `receive_purchase`, `adjust_stock`, conversiones). Para corregir stock: Inventario → ajuste.

**Stock → Inventario (INV-06).** En `/products` la celda Stock enlaza a `/inventory?product=<id>&returnTo=<lista>` y los filtros de stock se sustituyen por el atajo "Ver stock en Inventario" (lleva búsqueda y categoría); ambos solo con `inventory.view`. **Receta de empaque (INV-09):** el BFF la guarda, reemplaza o desactiva solo por la RPC `save_pack_recipe` (parche `20261011c`: una transacción y regla de cadenas en la base); ver [`stock-integrity.md`](stock-integrity.md) §1. El detalle `/products/[id]` monta `ProductKardexCard` (ver Inventario).

### Imagen de producto

| Endpoint | Permiso | Descripcion |
|----------|---------|-------------|
| POST `/api/products/[id]/image-upload-url` | `products.manage` | URL firmada (`upsert`); `publicUrl` desde Storage `getPublicUrl` (host = `NEXT_PUBLIC_SUPABASE_URL`) |
| POST `/api/products/[id]/image` | `products.manage` | Confirma subida: verifica objeto en Storage, borra el otro formato, persiste `image_url` |
| DELETE `/api/products/[id]/image` | `products.manage` | Borra archivo Storage y limpia `image_url` |
| PATCH `/api/products/[id]` | `products.manage` | Si envía `imageUrl`, solo acepta cover pública de ese producto en `product-images` |

- Bucket: `product-images` (patch [`supabase/patches/20260707-product-images-storage.sql`](../supabase/patches/20260707-product-images-storage.sql)).
- Path: `{productId}/cover.webp` o `{productId}/cover.png` si se quita el fondo (PNG con transparencia).
- Recorte opcional con **quitar fondo** vía `@imgly/background-removal` (IA en el navegador, sin servidor).
- Crear producto: recorte en modal → POST producto → signed upload → HEAD pública → POST `/image` (confirm).
- Editar producto: misma confirmación o borrado inmediato desde el mismo modal.
- No se borran covers existentes antes del PUT (evita `NoSuchKey` si la subida falla).

### Categorías (API + UI)

| Endpoint | Permiso |
|----------|---------|
| GET/POST `/api/categories` | `products.view` / `products.manage` |
| GET/PATCH/DELETE `/api/categories/[id]` | soft delete |

UI: [`/products/categories`](../../src/modules/products/categories-list/page.tsx) — listado, búsqueda, modal crear/editar, desactivar. Diseño Stitch: [`docs/stitch-prompts/categories-list.md`](stitch-prompts/categories-list.md).

### Import Excel

Columnas plantilla: `sku`, `codigo_barras`, `nombre`, `categoria` (lista validada), `precio_ref`, `costo_ref`, `stock_inicial`, `stock_minimo`. Máx. 500 filas.

### Pendiente

- Import masivo server-side validate (`POST /api/products/import/validate`).

---

## Inventario

Vista **operativa de existencias** (no catálogo): stock actual, mínimo, alertas y movimientos. Precios, alta de productos e importación viven en **Productos**.

| Ruta | Permiso | Pantalla |
|------|---------|----------|
| `/inventory` | `inventory.view` | **Vista única de stock.** Columnas: Producto, Categoría, Stock, Mínimo, Entradas 30 d, Salidas 30 d, Último movimiento (fecha y tipo) y Estado. Badge "Descuadre ±N" solo para admin cuando `reconciliationDiff` ≠ 0. Cada fila se expande con el kardex inline (últimos 10 movimientos) |
| `/inventory/movements` | `inventory.view` | Libro de movimientos con filtros en servidor, documento de cada movimiento, exportación a Excel y los modales de ajuste y de conversión (`inventory.manage`) |

| Hook | Endpoint |
|------|----------|
| `useInventory` | GET `/api/inventory` — `search`, `productId`, `categoryId`, `stockStatus`, `lowStock`, `minPriceRef`, `maxPriceRef`, paginación. Lee la vista `inventory_overview` (parche `20261011a`) |
| `useInventoryMovements` | GET `/api/inventory/movements` — `type`, `from`, `to`, `productId`, `document`, `documentKind`, `saleId`, `purchaseId`, paginación |
| `useStockCard` | GET `/api/inventory/stock-card` — `productId`, `type`, `from`, `to` |
| `useProductKardex` | GET `/api/inventory/kardex` — `productId` |
| `useAdjustInventory` | POST `/api/inventory/adjustments` → RPC `adjust_stock` |
| `usePackConversions` | GET `/api/inventory/pack-conversions` |
| `useConvertPackToUnits` | POST `/api/inventory/conversions` → RPC `convert_pack_to_units` |

**`/inventory` (INV-01, INV-02).** Filtros, conteo y paginación se resuelven en la base; orden fijo por nombre; solo productos activos. Cada item suma `entries30d` y `exits30d` (ventana móvil de 30 × 24 h), `lastMovementAt` / `lastMovementType` (movimiento de mayor `seq`) y `stockStatus` (`ok` / `low` / `out`). `reconciliationDiff` (`stock_reconciliation.diff`) solo existe en la respuesta del rol admin. Un `skip` mayor que el total responde 200 con `items: []` y el total real.

- **Estado en la URL** (`useUrlListState`, esquema en `inventory-list/inventoryListParams.ts`): `search`, `category`, `status` (repetible), `lowStock`, `minPrice`, `maxPrice`, `page`, `limit`. Recargar o volver con atrás conserva la lista.
- **Parámetro `product`:** id del producto con los movimientos abiertos. No es un filtro (cambiar filtros o página lo conserva). Si el producto no está en la página visible se muestra fijado encima de la tabla ("Producto seleccionado"), aunque esté inactivo: la consulta por `productId` exacto es la única que no filtra por `is_active`. Es el enlace profundo que usa `/products`.
- **Fila expandible:** `DataTable.renderExpandedRow` + `InventoryProductMovementsPanel`. Carga bajo demanda los 10 últimos movimientos (tipo, cantidad, saldo `stockAfter`, documento y fecha), la línea de descuadre si la hay (admin) y "Ver kardex completo" → `/inventory/movements?productId=…&returnTo=…`.
- **`returnTo` encadenado** (`utils/chainedReturnTo.ts`): `withChainedReturnTo(href, urlActual)` conserva el `returnTo` con el que se llegó, de modo que la cadena `/products` → `/inventory` → `/inventory/movements` vuelve paso a paso con `PageBackButton`. Los detalles de venta y de compra aún descartan el `returnTo` anidado: desde un documento se vuelve a `/inventory`, no a `/products`.

**`/inventory/movements` (INV-04).** Todos los filtros van al servidor y viven en la URL (`inventoryMovementsParams.ts`): `type`, `from` / `to` (día de Caracas, inclusive), `productId` (`EntityAutocomplete`), `document` (texto parcial del número de venta o compra; se envía desde 3 caracteres y resuelve como máximo las 50 ventas y 50 compras más recientes que casan) y `documentKind` (`venta`, `compra`, `conversion`, `sin_documento`). Rango invertido: aviso en pantalla y no se consulta (el endpoint responde 400). Orden fijo: `seq` descendente.

- **Documento:** cada movimiento trae `documentKind` y `documentNumber`, con enlace a la venta o compra. Ambos `null` = movimiento sin documento → se muestra **"Ajuste manual"**. `/api/inventory/stock-card` no devuelve documento ni atiende `document` / `documentKind`.
- **Exportación:** el Excel usa los mismos filtros de la pantalla. `fetchExportRows` (`services/fetchExportRows.ts`) descarta filas repetidas por `id` y corta en **20.000 filas** (`EXPORT_MAX_ROWS`), devolviendo `truncated` cuando la lista es mayor. El mismo tope aplica al Excel de `/inventory`.

**Kardex de producto (INV-03).** `ProductKardexCard` (`src/modules/inventory/components/`, prop `productId`) es autónomo y está montado en `/products/[id]`: saldo actual, gráfico del saldo diario de 30 días y los 10 últimos movimientos con su saldo, más el enlace al kardex completo. Lee `GET /api/inventory/kardex?productId=` (`inventory.view`), que agrega en servidor: `series` (30 puntos por día de Caracas con `balance`, `entries`, `exits`), `openingBalance`, `entries30d`, `exits30d`, `lastMovements` y `truncated` (la ventana lee como máximo 5.000 movimientos; los días que quedan fuera van con `null`). La lista de movimientos (`ProductMovementList`) es la misma de la fila expandible.

**Modales de ajuste y conversión (INV-07, INV-08).** `InventoryAdjustmentModal` e `InventoryPackConversionModal` buscan el producto con `EntityAutocomplete` (búsqueda en servidor; el de conversión solo ofrece productos con receta activa); abiertos desde un producto llegan con él precargado.

- **`clientRequestId`:** obligatorio en el tipo de entrada de `useAdjustInventory` y `useConvertPackToUnits` (el esquema de los dos endpoints lo sigue aceptando como opcional). Lo da `useRequestAttempt({ renewOnContentChange: true })` (`utils/requestAttempt.ts`): doble clic = una petición; el reintento del mismo contenido tras un error de resultado incierto (red, 5xx, 409) viaja con la misma clave; si el contenido cambia se estrena clave; cerrar el modal llama a `discard()`. El error incierto se redacta con `describeStockRequestError`.
- **Sin red:** las dos mutaciones usan `networkMode: "always"` y `retry: false`: fallan al instante en vez de quedar en pausa y enviarse solas al volver la conexión.
- **Surtido:** al elegir un empaque surtido y la cantidad aparece el reparto editable (una fila por componente, precargada con receta × cantidad, suma en vivo y "Restablecer receta"); no se puede enviar si la suma no coincide o si el empaque quedaría en negativo. Antes de enviar, `ConfirmActionModal` muestra el efecto (−N empaques, +unidades y stock resultante por componente). El empaque 1 a 1 no lleva confirmación nueva (queda para CNF-08).
- **Efecto como función pura** (para CNF-08): `computePackOpeningEffect` (`inventory-movements/utils/packOpeningEffect.ts`) y `computeStockAdjustmentEffect` (`inventory-movements/utils/stockAdjustmentEffect.ts`).
- **Límites:** `reason` hasta 500 caracteres. Entrada libre a un producto inactivo → 409 (parche `20261011b`; las salidas se permiten).

**Reposición desde stock bajo (INV-05).** `src/modules/inventory/restock/`: `RestockPurchaseButton` (visible solo con `purchases.create`) abre `RestockSelection`, que lista los productos con stock bajo agrupados por proveedor (el preferido; si no, el último) con cantidad sugerida `max(mínimo × 2 − stock, 1)` editable. Montado en `DashboardLowStockCard` y en la cabecera de `/inventory?lowStock=true`. La selección de un proveedor se guarda en `sessionStorage` (una viva por pestaña, 30 min, firmada con tienda y usuario, máx. 200 líneas) y se navega a `/purchases/create?restock=<id>`. **Receptor pendiente en Compras:** `/purchases/create` aún no lee `restock`; debe hacerlo con `readRestockDraft` / `clearRestockDraft` de `@/modules/inventory/restock`. La precarga no decide costo, moneda, IVA, empaque ni pago.

**Campos ajuste:** `productId`, `quantityDelta`, `reason`, `type` (`ajuste_entrada`, `ajuste_salida`, etc.); `saleId` / `purchaseId` opcionales (parche `20261006c`). Los tipos `devolucion_cliente` / `devolucion_proveedor` exigen el documento (400 sin él, parche `20261006g`) y el modal de ajuste no los ofrece.

**Conversión empaque→unidad (dual SKU o surtido):** receta en `product_pack_conversions` + `product_pack_components`; una `conversion_salida` y una `conversion_entrada` por componente con unidades, todas con el mismo `conversion_id`. Con `components` en el cuerpo se registra el reparto real de la apertura. UI en detalle de producto e Inventario/movimientos.

**Tabla:** `stock_movements` es el libro mayor y la fuente de verdad; `products.current_stock` es un derivado que solo escribe el trigger `stock_movements_apply` al insertar un movimiento (no se actualiza a mano ni desde una RPC). `stock_movements` es solo-append. Detalle, causas y despliegue: [`stock-integrity.md`](stock-integrity.md).

### Vistas de integridad

Nueve vistas en `public` (parches `20261005` y `20261006d`), con `store_id`, una fila por descuadre, y el oráculo `stock_integrity_report(p_store_id)`. Se consultan con `npm run stock-lab:reconcile`. Cómo leer cada fila: [`stock-integrity.md`](stock-integrity.md) §4.

| Vista | Detecta |
|-------|---------|
| `stock_reconciliation` | `current_stock` ≠ Σ `quantity_delta` |
| `stock_chain_breaks` | `stock_after` que no encadena con el movimiento anterior (orden por `seq`) |
| `sales_without_movements` | Línea de venta viva sin movimiento o con delta distinto |
| `purchases_without_movements` | Línea de compra recibida sin movimiento o con delta distinto |
| `movements_without_document` | Movimiento de venta/compra sin documento, sin línea o con estado incoherente |
| `reversal_mismatches` | Reversiones que no suman el opuesto, o reversión sobre un documento vivo |
| `conversion_mismatches` | Par de conversión empaque→unidad incompleto o con razón inválida |
| `negative_stock` | Stock o `stock_after` negativo |
| `cross_store_movements` | Movimiento, producto y documento de tiendas distintas |

### RPC modificadas por el plan de integridad

Versión vigente = último parche de la columna. Ninguna escribe `products.current_stock`: insertan el movimiento con `stock_after` NULL.

| RPC / objeto | Vigente en | Cambio |
|--------------|-----------|--------|
| `stock_movements_apply()` (trigger), `products_stock_guard()` | `20261006e` (creados en `20261006a`) | Único escritor de `current_stock`; guard por GUC `app.stock_writer` |
| `stock_movements_append_only` | `20261006g` | update/delete/truncate del libro → `PT409` |
| `assert_store_context` | `20261006a` | Rechaza perfiles inactivos o inexistentes |
| `create_sale`, `create_sale_with_payments` | `20261006h` | `p_client_request_id` + huella del contenido, numeración por secuencia, bloqueo ordenado, precio y descuento del vendedor, guarda de finitud |
| `cancel_sale` | `20261006g` | Repone vendido − ya devuelto; rechaza `borrador` |
| `return_sale`, `cancel_payment` | `20261006b` | Estados `pagada`/`pendiente_pago`; anula los pagos activos en la misma transacción |
| `cancel_payment_apply` | `20261006h` | Interna; bloquea la sesión de caja abierta |
| `register_payment` | `20261006h` | Rechaza documentos en estado terminal y `borrador`; guarda de finitud |
| `create_purchase` | `20261006h` | `p_client_request_id`, `units_per_pack` validado contra el par, numeración por secuencia, guarda de finitud |
| `receive_purchase` | `20261006c` | Solo `pedido` (`PT409`) |
| `cancel_purchase`, `return_purchase` | `20261006f` | `return_purchase` exige `recibido`; ambas exigen anular antes los pagos |
| `adjust_stock` | `20261011b` | Firma `(p_product_id, p_quantity_delta, p_reason, p_type, p_client_request_id, p_sale_id, p_purchase_id)`; devoluciones solo ligadas a documento y con tope; entrada libre a producto inactivo → `PT409` |
| `save_pack_recipe` | `20261011c`, `20261012a` | Nueva. Guarda, reemplaza o desactiva la receta de un empaque en una transacción; no mueve stock. Desde `20261012a` (INT-02) tiene un sexto argumento `p_always_disassemble_on_receive` (default `null` = no cambia) y es el único camino de escritura de la preferencia «Desarmar siempre al recibir compras» |
| `convert_pack_to_units` | `20261006c` | `p_client_request_id`; par y productos bloqueados en orden |
| `update_product_price`, `register_supplier_product_price`, `deactivate_supplier_product` | `20261006h` | Filtro de tienda, `PT403`, guarda de finitud |
| `record_cash_close_difference` | `20261006f` | Ya no ejecutable por cualquier usuario autenticado |

Errores de negocio: SQLSTATE `PT400` / `PT403` / `PT404` / `PT409` (PostgREST responde con ese HTTP).

**Receptor de la reposición (INT-02).** `/purchases/create?restock=<id>` lee la precarga con `readRestockDraft` (`purchase-create/hooks/usePurchaseRestockSource.ts`) y arma las líneas con `buildRestockPurchaseLines`: en el orden del payload, por unidad, con la cantidad sugerida y el costo e IVA del catálogo (nunca los del payload). Con proveedor activo lo elige; sin proveedor (o con uno inactivo o borrado, que además avisa) muestra «Elige el proveedor para cargar N productos de la reposición» y las líneas entran al elegirlo. Los productos inactivos o inexistentes se omiten con un aviso. Si hay una compra en curso (líneas, proveedor elegido o un borrador de COM-09 sin decidir) pregunta con «Tienes una compra en curso»: «Reemplazar por la reposición» descarta la compra y su borrador; «Conservar la compra actual» (o cerrar) no toca nada. La precarga se borra (`clearRestockDraft` + `restock` fuera de la URL) cuando las líneas entran en la compra —desde ahí las guarda el borrador de COM-09— o cuando el usuario decide no usarla. Una precarga caducada, de otra sesión o ya usada avisa y deja la compra vacía. El botón también está en la cabecera del reporte de stock bajo de la tienda (`ReportsResultPanel`; no en los reportes de plataforma).

**Pendiente:** anular movimiento.

---

## Contactos

| Ruta | Permiso |
|------|---------|
| `/contacts` | `contacts.view` |
| `/contacts/[id]` | `contacts.view` |

| Hook | Endpoint |
|------|----------|
| `useContacts` | GET `/api/contacts` — `type`, `search` |
| `useContact` | GET `/api/contacts/[id]` |
| `useCreateContact` | POST `/api/contacts` — requiere `contacts.manage` |
| `useUpdateContact` | PATCH `/api/contacts/[id]` |
| `useContactActivity` | GET `/api/contacts/[id]/activity` |
| `useContactSales` | GET `/api/contacts/[id]/sales` |
| `useContactPurchases` | GET `/api/contacts/[id]/purchases` |
| `useContactPayments` | GET `/api/contacts/[id]/payments` |
| `useSupplierProducts` | GET `/api/suppliers/[id]/products` — `isActive`, paginación |
| `useCreateSupplierProduct` | POST `/api/supplier-products` |
| `useUpdateSupplierProductMetadata` | PATCH `/api/supplier-products/[id]` |
| `useRegisterSupplierPrice` | POST `/api/supplier-products/[id]/prices` |
| `useSupplierProductPriceHistory` | GET `/api/supplier-products/[id]/price-history` |
| `useDeactivateSupplierProduct` | PATCH `/api/supplier-products/[id]/deactivate` |

**Campos:** `name`, `type` (`cliente`|`proveedor`|`ambos`), `taxId`, `email`, `phone`, `address`, `notes`, `isActive`.

**Acceso por rol:** el `vendedor` solo ve contactos con `type = cliente` (no `proveedor` ni `ambos`). Se aplica en listado/detalle/subrecursos de `/api/contacts`, y en catálogo proveedor-producto (`/api/supplier-products`, `/api/products/[id]/suppliers`, etc.).

**Tabla:** `contacts`. Sin `DELETE` API (desactivar vía `PATCH isActive: false`).

**UI proveedor/ambos:** tab **Productos** (`ContactSupplierProductsTab`) — vincular (M10 con autocomplete producto/proveedor según contexto), cotizar, historial, editar metadatos, desvincular (modales M10–M14 en `contacts/components/supplier-products/`). Permisos `products.view` / `products.manage`.

**Tab Saldos (`ContactBalancesTab`, PAG-04b):** documentos del contacto con saldo (`useOpenDocuments` con `contactId`), total REF/Bs, enlace a cada documento con `returnTo`, **Abonar** (`ContactSettlementModal`) y **Cobrar**/**Pagar** por documento (`RegisterPaymentModal`). Cliente = "Por cobrar", proveedor = "Por pagar", `ambos` = las dos secciones. Qué secciones se pintan lo decide `getContactBalanceSections` (misma regla que el servidor); sin ninguna, la pestaña no aparece. Con un abono por confirmar guardado y el modal cerrado, la sección avisa ("Hay un abono por confirmar…") con **Revisar abono**, que abre el modal en ese abono. Detalle en [Pagos](#pagos).

**Por cobrar / Por pagar de la cabecera (PAG-F8):** salen de la misma consulta que la pestaña Saldos (`useOpenDocuments({ contactId, type, limit })` → `totals.pendingRef`; misma clave, se refrescan juntas), no de la primera página de ventas/compras/pagos del contacto, que con más de 10 pagos dejaba el saldo mal. Misma regla de permisos que la pestaña: sin una sección (`getContactBalanceSections`), y mientras la lista carga, esa métrica conserva el cálculo con las filas recibidas (`computeContactDetailMetrics`). Las demás métricas no cambian.

**Pendiente:** `Can` en botón crear; enlaces desde tablas de actividad a detalle venta/compra.

---

## Ventas

| Ruta | Permiso |
|------|---------|
| `/sales` | `sales.view` |
| `/sales/create` | `sales.create` |
| `/sales/[id]` | `sales.view` |

| Hook | Endpoint |
|------|----------|
| `useSales` | GET `/api/sales` — `status`, `customerId`, `from`, `to` (día operativo Caracas) |
| `useSale` | GET `/api/sales/[id]` |
| `useCreateSale` | POST `/api/sales` → RPC `create_sale_with_payments` (con `payments[]` / `clientRequestId`) o `create_sale` |
| `useCancelSale` | PATCH `/api/sales/[id]/cancel` |
| `useReturnSale` | POST `/api/sales/[id]/return` |
| `useSaleReceipt` | GET `/api/sales/[id]/receipt` |

**Crear venta:** `customerId`, `items[]` (`productId`, `quantity`), `discountRef`, `taxRef`, `refRateVes`, `notes`.

**UI POS (`/sales/create`):** exige caja abierta (`PosCashSessionGate`). Preselecciona el cliente sistema **Consumidor final** (`isPosDefault` / `contacts.is_pos_default`) para venta rápida; el vendedor puede cambiarlo. Grid de productos (`PosProductGrid` / `PosProductCard`) y carrito (`PosCartPanel` / `PosCartLine`) muestran precios en REF y equivalente VES por línea usando `useCurrentExchangeRate` → `rateVes` y `refToVes` (`src/shared/utils/currency.ts`). Cada línea del carrito: precio unitario REF + VES, total línea REF + VES; panel de totales incluye total VES cuando hay tasa vigente. Catálogo ordenado con stock (`currentStock > 0`) primero y sin stock al final; dentro de cada grupo, por nombre.

**Estados:** `borrador`, `pendiente_pago`, `pagada`, `cancelada`, `devuelta`.

**Venta y cobro en una sola transacción (patch `20260909-create-sale-with-payments.sql`):** el POS web manda los cobros dentro de `POST /api/sales` (`payments[]`, mismas reglas por método que `POST /api/payments`, esquema compartido en `src/modules/payments/services/paymentSchemas.ts`). El servidor llama al RPC `create_sale_with_payments`, que ejecuta `create_sale` y luego `register_payment` por línea dentro de la misma transacción: si un cobro falla (saldo, vuelto, caja cerrada…) Postgres revierte también la venta y el descuento de stock. Sin `payments` ni `clientRequestId` se sigue usando `create_sale` tal cual (app móvil y scripts cobran aparte). `clientRequestId` (uuid) es la clave de idempotencia por intento de cobro: se guarda en `sales.client_request_id` con índice único por tienda, y repetir la petición con la misma clave devuelve la venta ya creada. El POS la deriva del carrito al procesar (ver «Clave de cobro derivada del carrito», abajo), la conserva mientras el carrito siga cargado y la descarta al vaciarlo. Un candado síncrono (`submitLockRef`) bloquea además el doble clic mientras viaja la petición. Al vender, cancelar o devolver se invalida también la caché de `products` (el catálogo del POS se cachea 5 min; antes el cajero seguía viendo el stock previo y el carrito le dejaba pedir unidades que ya no había). Antecedente: 29-ago-2026, cinco ventas idénticas sin pago creadas en seis minutos por reintentos del cajero cuando venta y cobro eran dos peticiones. **Antes de desplegar la app hay que aplicar el patch en la base**; `verify-patches.sql` lo comprueba.

**Modal «Cobrar» (`PosCheckoutModal`, POS-01):** se abre desde «Cobrar con billetes y vuelto» / «Editar cobro» del carrito. Abre **compacto**: total, método y monto (el efectivo arranca vacío y con el foco en el monto; los métodos bancarios, con el total). Los billetes y el vuelto solo aparecen con efectivo y diferencia entre lo recibido y el total. Los datos que el método exige (banco, teléfono, referencia) se piden al pulsar «Cobrar»: la primera pulsación los despliega y enfoca sin validar; la segunda envía. **Expandir** / **Compactar** alterna con la vista completa (pago mixto, billetes); un cobro guardado con varios pagos o billetes contados abre ya expandido. No añade peticiones al camino de cobro; el chip de método + «Procesar venta» sigue igual.

**Clave de cobro derivada del carrito (POS-H6):** [`sale-create/utils/saleRequestId.ts`](../src/modules/sales/sale-create/utils/saleRequestId.ts) → `deriveSaleRequestId(cartId, { customerId, items })` devuelve un UUID determinista a partir de la identidad del carrito (`chargeIdentity()` de `usePosCartDraft`), el cliente y las líneas (producto y cantidad, sin importar el orden). Dos pestañas con una copia del mismo carrito envían la **misma** `clientRequestId` aunque cobren a la vez: el servidor registra una sola venta, y con otro método de pago en la segunda responde 409. No entran en la clave ni el cobro ni el precio. Una venta nueva estrena identidad, así que dos ventas seguidas con los mismos productos no se fusionan. Si la clave quedó gastada en una venta anulada, el POS guarda una aleatoria para el siguiente cobro. Test de laboratorio: `scripts/stock-lab/regression/pos-two-tabs-same-cart.test.ts`.

**Categorías del POS (POS-H4):** el filtro usa `useAllCategories` (todas las páginas de `/api/categories`, por nombre) en lugar de `useCategories`, que solo traía la primera página.

**Cajón tras vender (POS-F6 / POS-F8):** confirmada la venta, el POS vuelve a pedir la sesión de caja (`cashKeys.session`) en segundo plano: contra ese efectivo se valida el vuelto del siguiente cobro. El resto de la caché de caja solo se marca obsoleta (`refetchType: "none"`), sin peticiones en el camino de cobro; «Mi caja» la relee al entrar. Devolver una venta también invalida la caché de caja.

**Descuento (`discountRef`, POS-05):** regla única en [`utils/saleDiscountPolicy.ts`](../src/modules/sales/utils/saleDiscountPolicy.ts), aplicada en `POST /api/sales` antes del RPC: el vendedor no envía descuento > 0 (403); negativo, no finito o con más de 2 decimales → 400; con descuento > 0 todas las líneas traen `unitPriceRef` y el descuento es menor que el subtotal del cuerpo (si no, 400). Ver P4-2 en [`stock-integrity.md`](stock-integrity.md).

**Cobrar saldo (`/sales/[id]`, PAG-02):** acción primaria de la cabecera que abre `RegisterPaymentModal` con `saleId` sin salir del detalle. Visible solo con saldo (`roundMoney(totalVes - paidVes) > 0`), venta `pendiente_pago` o `pagada`, y `payments.manage` o `sales.create`. Al cobrar se refrescan el saldo y la tabla de pagos. Las ventas en `pendiente_pago` con 7 días o más se avisan en `/payments` (ver [Pagos](#pagos)).

**Tablas:** `sales`, `sale_items`, `payments`, `stock_movements`.

**Pendiente:** PDF recibo (detalle ya exporta factura PDF); venta borrador; confirmación antes de anular (parcial vía menú).

---

## Compras

| Ruta | Permiso |
|------|---------|
| `/purchases` | `purchases.view` |
| `/purchases/create` | `purchases.view` (acción API `purchases.create`) |
| `/purchases/[id]` | `purchases.view` |

| Hook | Endpoint |
|------|----------|
| `usePurchases` | GET `/api/purchases` |
| `usePurchase` | GET `/api/purchases/[id]` |
| `useCreatePurchase` | POST `/api/purchases` → RPC `create_purchase` |
| `useReceivePurchase` | PATCH `/api/purchases/[id]/receive` → RPC `receive_purchase` |
| `useCancelPurchase` | PATCH `/api/purchases/[id]/cancel` |
| `useReturnPurchase` | POST `/api/purchases/[id]/return` |
| `useSupplierProducts` | GET `/api/suppliers/[id]/products` |
| `fetchPurchaseSupplierOptions` / `usePurchaseSupplier(id)` (`hooks/usePurchaseSuppliers.ts`) | GET `/api/purchases/suppliers?search=&limit=&skip=` / `?id=` — proveedor de `/purchases/create` (`PurchaseSupplierCard`); permiso `purchases.create`, solo `id`, `name`, `taxId`, `isActive`. No usar `/api/contacts` en compras: almacén no tiene `contacts.view` (COM-F9). |
| `fetchPurchaseLastCosts` / `withLastPurchaseCost` (`purchase-create/services/purchaseLastCosts.ts`) | GET `/api/purchases/last-costs?supplierId=&productIds=a,b` (máx. 50; permiso `purchases.create`) — costo unitario SIN IVA de la última línea de compra `recibido` de cada producto (`source`: `supplier` o `any`). Es el costo sugerido de una línea nueva (buscador, escaneo, duplicar); solo si el producto nunca se compró se usa `netCostRef(costo con IVA, alícuota de la categoría)`. No derivar el costo de la línea de `current_cost_ref` / `last_cost_ref`: llevan el IVA de la línea que los fijó, no el de la categoría (COM-F11). |

**Lista (`/purchases`, COM-08):** columnas Pagado y Saldo (REF) y badge de pago (Pagada / Parcial / Pendiente; una compra `cancelado` o `devuelto` no lleva ni badge ni saldo). El estado vive en la URL con `useUrlListState` (`purchases-list/utils/purchasesListState.ts`): `search`, `status`, `pendingBalance=1`, `from`/`to`, `page`, `limit`; «Ver detalle» lleva `returnTo`. `GET /api/purchases` filtra en servidor: `from`/`to` (día operativo Caracas; fecha inválida o rango invertido → 400) y `pendingBalance=1` = compras `pedido`/`recibido` con `totalRef − paidRef ≥ 0.01` (regla en `purchases-list/utils/purchaseBalance.ts`, la misma de "cuentas por pagar" de `store_capital_summary`), y entonces la respuesta trae `pendingBalanceRef` (suma del saldo de todo el filtro). Lo pagado del listado sale siempre de la cabecera (`purchases.paid_ref`/`paid_ves`), nunca de filas de `payments`. El Excel respeta los filtros y añade Pagado y Saldo.

**Crear:** `supplierId`, `status` (`pedido`|`recibido`), `items[]` con `entryMode` `unit` o `pack`, `discountRef`, `taxRef`, `refRateVes`, pago inicial opcional. Modo **empaque:** `packLabel`, `packCount`, `unitsPerPack`, `packCostRef` (RPC normaliza a unidades y costo unitario). Modo **unidad:** `quantity`, `unitCostRef`.

**UI `/purchases/create`:** toggle Unidad/Empaque por línea; presets desde catálogo `supplier_product_pack_units`; autocompletado si hay empaque predeterminado al agregar producto.

**Relaciones proveedor-producto:** GET/POST `/api/supplier-products`, PATCH metadatos `/api/supplier-products/[id]`, POST precios `/api/supplier-products/[id]/prices`, GET historial `/api/supplier-products/[id]/price-history`, PATCH baja `/api/supplier-products/[id]/deactivate`, **empaques** GET/POST `/api/supplier-products/[id]/pack-units`, PATCH/DELETE `/api/supplier-products/[id]/pack-units/[packId]`. Modal M15 `ManageSupplierProductPackUnitsModal` en tab Productos (contacto) y tabla Proveedores (producto).

**Pagar (`/purchases/[id]`, PAG-01b):** acción primaria de la cabecera que abre `RegisterPaymentModal` con `purchaseId` sin navegar. Visible solo con saldo en Bs (`roundMoney(totalVes - paidVes) > 0`), compra ni `cancelado` ni `devuelto`, `payments.manage` y un rol que vea pagos de compra (`canViewPurchasePayments`: no el vendedor). Tras registrar se refrescan saldo y tabla de pagos.

**Pagar ahora (`/purchases/create`, COM-06):** sección opcional y colapsada (`PurchasePaymentSection` sobre `PaymentFormFields`: mismos métodos y validaciones que el modal de pago; el saldo es el total de la compra en curso). Solo con `payments.manage` + `payments.view`; vale para `pedido` y `recibido` (`register_payment` solo rechaza `cancelado`/`devuelto`). Abierta e incompleta, confirmar no envía nada. `POST /api/purchases` acepta `initialPayment` (cuerpo de `POST /api/payments` sin documento, con su propio `clientRequestId` obligatorio): valida y autoriza todo antes de crear (pago inválido → 400, sin `payments.manage` → 403, sin crear nada) y luego ejecuta `create_purchase` y `register_payment` en secuencia, sin RPC nueva. Responde la compra + `initialPayment: { status: "registered", paymentId } | { status: "failed", message }`; con `failed` la compra existe y queda pendiente: la UI navega al detalle con un aviso y allí se paga. Las dos claves salen del mismo intento (`useRequestAttempt` + `InitialPaymentKey`): reintentar no duplica ni la compra ni el pago.

**Borrador local (`/purchases/create`, COM-09):** la compra en curso se guarda en `localStorage`, clave `bodegahub:compras:borrador:v1:<tienda>:<usuario>`, con `usePurchaseDraftStorage()` (`purchase-create/hooks/`) → `{ pending, pendingNew, ownsNew, sync(content), adopt(), keepNew(), clear() }`. `sync` se llama en cada cambio y solo escribe si hay algo que perder (≥ 1 línea, o proveedor + notas); `pending` es el borrador que dejó otra visita (aviso «Tienes una compra sin terminar» con Restaurar → `adopt()` y Descartar → `clear()`); confirmar la compra llama a `clear()`. **Dos ranuras (COM-F10):** con un `pending` sin decidir, `sync` no lo pisa: guarda la compra nueva en `…:borrador:v1:<tienda>:<usuario>:nuevo` (mismo esquema zod; queda en `pendingNew`, con `ownsNew` = la escribió esta visita) y el aviso pasa a «Empezaste una compra nueva: al seguir se reemplaza el borrador guardado (…)» con «Restaurar el guardado» → `adopt()` (borra la nueva) y «Seguir con esta» → `keepNew()` (la nueva pasa a la ranura principal y se borra la guardada). Al recargar sin decidir se ofrecen las dos («Tienes dos compras sin terminar»: restaurar una descarta la otra, o «Descartar las dos»); mientras haya dos sin decidir una tercera no se guarda. `clear()` borra ambas ranuras. Lo guardado es `StoredPurchaseDraft` (`purchase-create/utils/purchaseDraftStorage.ts`, esquema zod): `version`, `storeId`, `userId`, `savedAt`, `supplierId`, `supplierName?`, `status`, `notes`, `discountRef`, `costCurrency`, `rateVes`, `lines` (`PurchaseLinesState` sin `focus`) y `lineMeta`; nunca el pago inicial ni la clave de idempotencia. Corrupto, de otra versión o de otra tienda/usuario se descarta en silencio; sin `localStorage` la pantalla funciona igual. `restorePurchaseDraft` re-sincroniza los costos con la tasa vigente dejando fijo el monto en la moneda de captura (avisa si cambió) y quita, avisando, las líneas de productos inactivos o inexistentes (`services/resolvePurchaseProducts.ts`). Para ampliarlo (CNF-16: clave de idempotencia, debounce) se añaden campos **opcionales** al esquema; un cambio incompatible sube `PURCHASE_DRAFT_VERSION`. Con ≥ 1 línea o un proveedor elegido, el guardia de proceso («Compra a X · N líneas · REF T») pregunta al salir, guarda el borrador en el acto con «Salir» (el guardado automático espera 500 ms tras cada cambio) y se apaga antes de navegar al detalle tras confirmar; ver «Procesos protegidos (ProcessGuard)».

**Duplicar compra (COM-09):** «Duplicar compra» en el menú del detalle (`purchases.create`, cualquier estado) → `/purchases/create?duplicate=<id>` (`usePurchaseDuplicateSource`; el parámetro se quita de la URL al cargar). Copia proveedor y líneas (producto, unidad/empaque, cantidades) con el costo al último conocido (`last_cost_ref` del vínculo actual llevado a base sin IVA; sin vínculo, el de la línea de origen) y la alícuota de la categoría actual; no copia notas, descuento, estado ni pagos. Proveedor inactivo o que ya no es proveedor: no se preselecciona, se avisa y las líneas entran al elegir otro; productos inactivos o inexistentes se omiten con aviso. Con un borrador local pendiente manda lo duplicado, que se guarda aparte como compra nueva (segunda ranura), y el borrador sigue ofreciéndose («Restaurar el guardado» lo sustituye).

**Desarmar al recibir (COM-14, parche `20261010d`):** la línea de un producto que es el EMPAQUE de una receta de apertura activa (par o surtido de PRO-12) ofrece en `/purchases/create` el chip «Desarmar al recibir» (`PurchaseLineRow`; estado web `PurchaseLinesState.disassemble`, persistido como campo opcional del borrador; qué productos tienen receta sale de UNA consulta a `GET /api/inventory/pack-conversions`). Marcada, la línea viaja con `disassembleOnReceive: true` (`purchaseItem.schema.ts`; la clave solo va cuando es `true`) y `create_purchase` la guarda en `purchase_items.disassemble_on_receive`. Al recibir —compra que nace recibida o `PATCH /api/purchases/{id}/receive`— los empaques de la línea se abren en los componentes de la receta **en la misma transacción** (`receive_purchase_and_disassemble` encadena `receive_purchase` + `convert_pack_to_units`; si una apertura falla no se recibe nada: no hay estado "pendiente de desarmar"). El detalle (`GET /api/purchases/{id}`) añade a cada línea `id`, `disassembleOnReceive`, `disassembled` y, en un pedido, `packRecipe` (componentes con su stock); la tabla dice «Se desarmará al recibir» / «Desarmado al recibir».

**Preferencia «Desarmar siempre al recibir compras» (COM-14, parche `20261010e`):** casilla del formulario de la receta (`ProductPackConversionFields`, cualquier modo). Viaja en `packConversion.alwaysDisassembleOnReceive` de `POST /api/products` / `PATCH /api/products/{id}` (opcional: ausente = no cambia; el formulario solo la envía si el usuario tocó la casilla) y se guarda en la cabecera de la receta (`product_pack_conversions.always_disassemble_on_receive`; desde INT-02 se escribe por la RPC `save_pack_recipe`, parche `20261012a`, como el resto de la receta, porque `20261011d` cierra la escritura por tabla; el BFF solo envía el argumento cuando la petición trae la preferencia y una receta reemplazada hereda en la base la de la anterior). La devuelven `packConversion` del producto y `GET /api/inventory/pack-conversions` **solo cuando es `true`** (ausente = no). En `/purchases/create` la línea de ese empaque nace con el chip marcado (`readPurchasePackRecipes` + `withPurchaseLineDisassemble`, misma consulta de recetas); lo que el usuario elige en el chip manda y se guarda en el borrador como `true` / `false` (`PurchaseLinesState.disassemble`). Una compra duplicada no copia marcas: aplica la preferencia actual. `create_purchase` no cambia: la marca sigue viajando por línea.

**Reparto ajustable del surtido al recibir (COM-14):** en la previsualización de recepción (`PurchaseReceivePreviewModal`), la línea que se desarma y cuyo empaque es un SURTIDO (receta de varios componentes) ofrece «Ajustar reparto», que despliega `PackDistributionFields` (`src/modules/inventory/inventory-movements/components/`: control controlado y exportable, una fila por componente con `NumberInput`, suma contra `unidades por empaque × empaques`, «Restablecer receta»; reglas puras en `inventory-movements/utils/packDistribution.ts`: `buildDefaultPackDistribution`, `parsePackDistribution`, `checkPackDistribution`, `toPackDistributionList`). Abre con la receta × empaques de la línea; el reparto se comprueba contra el TOTAL de la línea (regla de `convert_pack_to_units`), no empaque a empaque. Lo tecleado alimenta `buildReceivePreview(purchase, { disassemble, distribution })` (`parseReceiveDistribution` pasa el texto a unidades): cada componente sube lo repartido y el stock después se recalcula en vivo; la línea expone `disassemble.canAdjustDistribution`, `disassemble.distribution` (solo si es válido y distinto de la receta) y `disassemble.distributionError`. `buildReceiveDisassembleRequest` envía ese `distribution` por línea y `findReceiveDistributionError` da el motivo que bloquea «Recibir mercancía» (nada se envía; el motivo es el mensaje del control). Receta de un componente: sin ajuste. Todo queda en las funciones puras para CNF-04.
La confirmación de recepción sale de la función pura `buildReceivePreview(purchase, { disassemble })` (`purchase-details/utils/`): por línea, lo que entra y, si se desarma, `disassemble: { packsOut, components[] }` con el stock antes → después de cada componente (el empaque queda neto 0); `canDisassemble` y `disassembleUnavailable` (marcada pero su receta ya no está activa) deciden el interruptor y el aviso. `buildReceiveDisassembleRequest(lines)` da la lista `disassemble` del cuerpo. **CNF-04 debe consumir estas dos funciones tal cual** (ambos efectos ya están calculados). El cuerpo del `PATCH` es opcional: `{ clientRequestId?, disassemble?: [{ purchaseItemId, distribution? }] }`; la lista sustituye las marcas del pedido (`[]` = ninguna) y `distribution` es el reparto real de un surtido (el BFF y la base lo aceptan; la pantalla aún abre con la receta fija). Contrato y tipos: `services/purchaseDisassemble.ts`. Mock en paridad (`purchases.mock-server.ts` usa `createStockAdjustment` + `convertPackToUnits` del mock de inventario).

**Tablas:** `purchases`, `purchase_items` (metadata `entry_mode`, `pack_*`), `supplier_products`, `supplier_product_price_history`, `supplier_product_pack_units`.

**Migración Supabase remota:** aplicar en SQL Editor los cambios de §3.8–3.8.1 en [`supabase/supabase-schema.sql`](../supabase/supabase-schema.sql) (`notes`, `is_active`, tabla historial, RPCs `register_supplier_product_price` / `deactivate_supplier_product`, append en `create_purchase`/`receive_purchase`). No hay auto-deploy; ver [`supabase-setup.md`](supabase-setup.md).

---

## Pagos

| Ruta | Permiso |
|------|---------|
| `/payments` | `payments.view` |
| `/payments/[id]` | `payments.view` |

| Hook | Endpoint |
|------|----------|
| `usePayments` | GET `/api/payments` — `direction`, `method`, `from`, `to` (día operativo Caracas), `saleId`, `purchaseId`, `contactId` |
| `usePayment` | GET `/api/payments/[id]` |
| `useCreatePayment` | POST `/api/payments` → RPC `register_payment` (`payments.manage` o `sales.create` para ventas); acepta `clientRequestId` |
| `useOpenDocuments` | GET `/api/payments/open-documents` — `type`, `search`, `contactId`, `from`, `to`, `olderThanDays` (`payments.manage` o `sales.create`) |

**Métodos:** `efectivo_ves`, `efectivo_usd`, `pago_movil`, `punto_venta`, `transferencia`. Validación por método en API.

**Acceso por rol:** el `vendedor` ve/opera pagos de ventas (`purchase_id` nulo) y puede **crear** cobros de venta en POS/API con `sales.create` (sin necesitar `payments.manage`). Se aplica en `GET/POST /api/payments`, detalle, `GET /api/contacts/[id]/payments` y actividad del contacto. Anular pagos y pagar compras siguen reservados a `payments.manage`. En UI se ocultan filtros de compra/salida.

### Lista `/payments`

- **Estado en la URL** (`useUrlListState` + `paymentsListSchema`, PAG-05): `from`, `to`, `method`, `direction`, `page`, `limit` y los enlaces profundos `saleId`, `purchaseId`, `contactId`. Sobrevive a recarga y a "atrás"; una página fuera de rango se ajusta a la última.
- **Filtros visibles:** Desde / Hasta, Método y Tipo (Entrada/Salida). El vendedor queda fijo en "Entrada". `saleId`/`purchaseId`/`contactId` nunca son campos: llegan en el enlace de otra pantalla y se muestran como chips quitables. **Ningún input pide un ID.**
- **Columna Documento** (`PaymentsDocumentCell`): número de la venta o compra enlazado a su detalle con `returnTo` = URL exacta de la lista, para que "Volver" regrese con los mismos filtros. Los detalles de venta, compra y pago respetan `returnTo`.
- **Export:** respeta los filtros activos y no incluye ids internos.
- **Registrar pago** (PAG-03b): abre `PaymentDocumentPicker` y, al elegir, `RegisterPaymentModal` con el documento fijo. El modo de teclear el ID del documento se eliminó.
- **Aviso de ventas pendientes** (`StalePendingSalesNotice`, PAG-07): aviso en `/payments` de ventas en `pendiente_pago` con 7 días o más, con **Cobrar** y enlace al detalle para **Anular**; no cambia ninguna RPC.

`GET /api/payments` valida `method` (uno de los cinco métodos), `from` y `to` (`YYYY-MM-DD`, día operativo Caracas, ambos inclusive): un valor inválido o `from` posterior a `to` responde 400; un parámetro vacío equivale a no enviarlo.

### `RegisterPaymentModal`

[`src/modules/payments/components/RegisterPaymentModal.tsx`](../src/modules/payments/components/RegisterPaymentModal.tsx). Modal para pagar una compra o cobrar una venta sin salir de la pantalla. El documento lo fija quien lo usa con `purchaseId` o `saleId` (exactamente uno); el usuario nunca lo elige ni lo teclea aquí. Lo usan el detalle de compra (**Pagar**), el detalle de venta (**Cobrar saldo**), `/payments` y la pestaña Saldos del contacto.

| Prop | Tipo | Contrato (JSDoc del código) |
|------|------|-----------------------------|
| `purchaseId` | `string?` | Compra a pagar (salida de dinero). No combinar con `saleId`. Puede ir `undefined` mientras el modal está cerrado (apertura por código); abierto sin documento no registra nada. |
| `saleId` | `string?` | Venta a cobrar (entrada de dinero). No combinar con `purchaseId`. Puede ir `undefined` mientras el modal está cerrado; abierto sin documento no registra nada. |
| `open` | `boolean?` | Apertura controlada: con un booleano el modal se abre y se cierra por código y no pinta botón propio. Sin esta prop se abre con `trigger`. |
| `onOpenChange` | `(open: boolean) => void` (opcional) | Se llama al abrirse y al cerrarse el modal por una acción del usuario. Con el pago en vuelo el cierre se ignora y no se llama. Con un intento por confirmar sí se puede cerrar: al reabrir sigue ahí. Necesaria si se pasa `open`. |
| `onRegistered` | `(payment: PaymentDetail) => void` (opcional) | Se llama una vez por pago registrado con éxito (también si se confirma al reintentar un intento incierto), con el pago que devolvió el servidor (`pendingBalanceVes` trae el saldo que queda). El modal no se cierra solo: muestra el saldo restante y permite otro abono; quien quiera cerrarlo lo hace aquí. |
| `trigger` | `ReactNode?` | Elemento que abre el modal al hacer clic. Sin `trigger` ni `open` se pinta un botón con el título. |
| `title` | `string?` | Título del modal. Por defecto "Pagar compra" o "Cobrar saldo" (venta). |
| `submitLabel` | `string?` | Texto del botón de envío. Por defecto "Registrar pago" (compra) o "Registrar cobro" (venta). |

Comportamiento:

- **Saldo:** cada apertura vuelve a pedir el documento y muestra "Saldo pendiente actual" (Bs). Mientras el saldo carga no se envía; un documento ya saldado no admite otro pago. La venta convierte con su propia tasa; la compra, con la tasa del día de la tienda (igual que `register_payment`), y un pago en USD que supere el saldo de la compra se bloquea antes de enviar.
- **Completar saldo:** rellena el monto con el saldo pendiente en la moneda del método (REF/Bs).
- **Clave de idempotencia:** cada envío nuevo lleva un `clientRequestId` propio. Cada apertura estrena formulario y clave **salvo que haya un intento por confirmar**.
- **Intento por confirmar (PAG-F6):** tras un error de resultado incierto (red, tiempo límite, 5xx, 408, 409) el pago pudo quedar registrado. El modal vuelve a pedir documento y pagos, bloquea los campos con lo enviado, avisa "No pudimos confirmar si el pago se registró. Reintenta: si ya entró, no se duplicará." y su acción principal pasa a ser **Reintentar**, que reenvía exactamente lo mismo con la misma clave. El intento es del documento y vive en la instancia del modal: sobrevive a cerrar y reabrir y a que el consumidor cambie de documento y vuelva (`/payments`, Saldos), pero no a desmontar el modal ni a recargar la página. Se resuelve con el éxito del reintento (flujo normal, `onRegistered`) o con un rechazo 4xx (409 incluido en el reintento): se muestra el mensaje, se refresca el saldo y se vuelve a editar con clave nueva.
- **Descartar intento (PAG-F8):** si un reintento vuelve a quedar sin confirmar aparece **Descartar intento** (no antes). Pide confirmación con `ConfirmActionModal` (documento, monto y aviso de revisar los pagos para no duplicar); al confirmar suelta el intento, refresca documento y pagos y deja el formulario limpio, con clave nueva en el siguiente envío.
- **Doble clic (PAG-F8):** tras terminar un envío (éxito, rechazo o por confirmar) la acción principal y **Descartar intento** quedan deshabilitadas ~700 ms y un envío con Enter en ese lapso se ignora: el segundo clic no cae en el botón que ocupa el sitio del anterior. **Cancelar** no espera.
- **Tiempo límite:** `useCreatePayment` aborta el POST a los 30 s (`CREATE_PAYMENT_TIMEOUT_MS`); el modal lo trata como resultado incierto (por confirmar), no queda bloqueado.
- **Guardia al salir:** con el modal abierto y un pago en vuelo o por confirmar, `ProcessGuard` ("Cobro en curso" / "Pago en curso") pregunta antes de seguir un enlace o ir ATRÁS; con el formulario limpio y tras el éxito no hay guardia. **Datos tecleados (CNF-15):** con el método cambiado o un monto, banco, teléfono, referencia o nota tecleados, cerrar el modal (Esc, clic fuera, Cancelar, la X) o salir de la pantalla pregunta nombrando el pago («Cobro de Bs X a Cliente sin registrar»); el monto de «Completar saldo» o de un atajo de porcentaje no cuenta hasta que se edita, y con el pago en vuelo o por confirmar este guardia está inactivo. Requiere el App Router (`useRouter`): todo test que monte el modal debe simular `next/navigation`. Ver «Procesos protegidos (ProcessGuard)».
- **Tras cualquier rechazo** (p. ej. 400 de sobrepago) el modal vuelve a pedir el documento para mostrar el saldo real. Un 400 de validación añade al mensaje el primer motivo de `issues` con texto propio del servidor.
- **Métodos habilitados:** si no se pueden cargar, se ofrecen todos con un aviso visible.
- **No cierra con el pago en vuelo:** Esc, X, clic fuera y Cancelar se ignoran mientras viaja la petición, y `onOpenChange` no se llama. Con un intento por confirmar sí se puede cerrar.
- **No se cierra solo:** tras registrar muestra el saldo restante y deja hacer otro abono. El consumidor decide en `onRegistered` (cerrar, navegar o nada).
- **Cambio de documento:** si `purchaseId`/`saleId` cambian, el modal se vuelve a montar por dentro (formulario limpio y clave nueva, salvo que ese documento tenga un intento por confirmar); no hace falta pasar `key`. Con `trigger`, ese cambio además lo cierra.
- **Errores:** los de negocio muestran el `error.message` del servidor tal cual; los de red, "No se pudo conectar con el servidor.".
- **Refresco:** `useCreatePayment` invalida `payments` (incluye documentos con saldo), `sales`, `purchases`, `contacts`, `dashboard`, `reports`, caja y baúl.

Ejemplo **"Pagar ahora" tras crear la compra** (COM-06; apertura por código, sin `trigger`):

```tsx
const [payingPurchaseId, setPayingPurchaseId] = useState<string>();

// Tras crear la compra: setPayingPurchaseId(purchase.id)

<RegisterPaymentModal
  onOpenChange={(open) => {
    if (!open) setPayingPurchaseId(undefined);
  }}
  onRegistered={(payment) => router.push(`/purchases/${payment.purchaseId}`)}
  open={payingPurchaseId !== undefined}
  purchaseId={payingPurchaseId}
/>
```

Montarlo solo para quien puede pagar compras: `can("payments.manage") && canViewPurchasePayments(role)` (`@/shared/auth/paymentAccess`). El modal no comprueba el rol; a un vendedor el servidor le responde 403.

### `PaymentDocumentPicker`

[`src/modules/payments/components/PaymentDocumentPicker.tsx`](../src/modules/payments/components/PaymentDocumentPicker.tsx). Buscador de ventas por cobrar y compras por pagar: el paso previo a `RegisterPaymentModal` cuando la pantalla no sabe todavía qué documento se paga. Solo elige; no registra nada. Busca en servidor (`GET /api/payments/open-documents`) por número de documento o nombre/RIF del contacto, con rango de fechas opcional; con el foco en el buscador, las flechas recorren los resultados y Enter elige el resaltado. Cada apertura empieza sin filtros.

Props: `open`, `onOpenChange(open)` (se llama con `false` al cerrar), `onSelect(document: OpenDocument)` (el buscador no se cierra solo: quien lo usa decide qué abrir después) y `canPayPurchases` (`payments.manage` y un rol que ve pagos de compra; con `false` solo se listan ventas y no se pinta el selector de tipo; el servidor aplica la misma regla).

### `ContactSettlementModal` y `allocatePayment`

[`src/modules/payments/components/ContactSettlementModal.tsx`](../src/modules/payments/components/ContactSettlementModal.tsx) — modal **Abonar** (PAG-04a): un abono de un contacto repartido entre sus documentos con saldo, del más antiguo al más nuevo.

1. El usuario indica método y monto (y banco, teléfono y referencia si el método los pide: valen para todos los pagos del abono).
2. Antes de confirmar ve el reparto: cuánto recibe cada documento y cuánto le queda.
3. Al confirmar se registra **un pago por documento, uno tras otro**, cada uno con su propia `clientRequestId`. Si uno falla el abono se detiene: los ya registrados quedan, la UI dice qué quedó pendiente y **Reintentar pendientes** continúa desde el que falló sin reenviar los anteriores ni duplicar.

Nunca paga de más ni da vuelto: un monto mayor que lo abonable no se confirma. Sin documentos pendientes no deja abonar. Props: `contactId`, `contactName`, `type` (`"sale"` cobra ventas del cliente; `"purchase"` paga compras del proveedor), `open`/`onOpenChange`/`trigger` (igual que `RegisterPaymentModal`) y `onSettled(payments)` (una sola vez, cuando **todos** los pagos quedaron registrados; no se llama si el abono queda a medias). Con `type="purchase"` montarlo solo si `canViewPurchasePayments(role)`.

**Abono por confirmar (PAG-F7).** Un pago que falla sin que se sepa si se registró (red, 5xx, 408, 409) deja el abono *por confirmar*: el modal no deja editar ni empezar otro abono, solo **Reintentar pendientes** (misma clave por documento) hasta que cada pago quede registrado o rechazado con 4xx (PAG-F8: un 409 al **reintentar** una fila ya enviada también es rechazo definitivo, como en `RegisterPaymentModal`). Ese abono sobrevive a cerrar el modal y, guardado en `sessionStorage` por tienda, usuario, contacto y tipo ([`pendingSettlementStore`](../src/modules/payments/utils/pendingSettlementStore.ts): claves, documento, monto, método y campos enviados; se borra al resolverse o descartarse), a recargar y navegar: al abrir **Abonar** de nuevo se muestra directamente. Otro usuario u otra tienda en la misma pestaña no lo ven ni lo reenvían; sin sesión conocida (`usePendingSettlementSession()` devuelve `null`) no se guarda ni se lee nada, y una entrada que no guardó la sesión actual se descarta al leerla. **Quien monte el modal de forma condicional debe mantenerlo montado mientras `useHasPendingSettlement({ contactId, session, type })` sea `true`** (así lo hace `ContactBalancesTab`). **Descartar abono por confirmar (PAG-F8):** si un reintento vuelve a quedar sin confirmar (5xx, red, tiempo límite) aparece esa salida (no antes, y sigue tras recargar); pide confirmación con `ConfirmActionModal` (documento, monto y aviso de revisar los pagos del contacto para no duplicar) y, al confirmar, borra lo guardado, refresca saldos, pagos y contacto y vuelve al formulario. Tras terminar un envío las acciones del pie quedan deshabilitadas ~700 ms (doble clic). Tras un rechazo definitivo (4xx) se puede reintentar, **Continuar con los demás** (envía los no enviados y deja el rechazado) o **Volver a editar** (reparte lo no registrado con saldos recién pedidos). Al abrir y tras cada fallo se vuelven a pedir los documentos con saldo (y se invalidan pagos, contacto y ventas/compras); el reparto no se ve ni se confirma hasta que llega la lista fresca. Si el modal se desmonta a mitad de la secuencia, el pago en vuelo termina y los siguientes no se envían (quedan guardados). Con pagos en vuelo o un abono por confirmar, un `ProcessGuard` ("Abono en curso") pregunta antes de salir de la pantalla; solo se monta en esos dos estados. **Datos tecleados (CNF-15):** en el formulario y en el reparto, con el método cambiado o un monto, banco, teléfono, referencia o nota tecleados, cerrar el modal o salir pregunta nombrando el abono («Pago de Bs X a Proveedor sin registrar»); el monto de «Completar total pendiente» y el que deja «Volver a editar» no cuentan hasta que se editan. Todo test que monte el modal debe simular `next/navigation`.

El reparto es la función pura [`allocatePayment`](../src/modules/payments/utils/allocatePayment.ts): recibe `amount`, `currency` (la del método), `documents` (del más antiguo al más nuevo, con `pendingVes` y `rateVes`) y `minPayableVes`; devuelve `allocations` (por documento: `amount`, `appliedVes`, `equivalent`, `remainingVes`), `appliedAmount`, `appliedVes` y `leftover` (`amount = appliedAmount + leftover`). Calcula con enteros para reproducir el `round(…, 2)` de Postgres y respeta el menor saldo que `register_payment` todavía deja pagar (`MIN_PAYABLE_VES_BY_DOCUMENT`: Bs 0,02 en ventas, Bs 0,01 en compras). Con método en USD, un monto cabe en un documento mientras su valor en Bs sin redondear no pase del saldo en más de medio céntimo (INT-03): una compra de ref 10,00 a 875,6505 guarda Bs 8.756,50 y el servidor convierte 10 USD en Bs 8.756,51, dentro de su holgura de Bs 0,01; el abono le asigna los 10 USD y la deja saldada (`appliedVes` puede superar el saldo en Bs 0,01 y `remainingVes` queda en 0), igual que «Completar saldo» desde su detalle. Antes abonaba 9,99 y dejaba un resto de Bs 8,75 que ningún monto en USD podía pagar.

### `GET /api/payments/open-documents`

Ventas por cobrar y compras por pagar de la tienda, con el mismo criterio que acepta `register_payment`: venta `pendiente_pago`/`pagada` o compra `pedido`/`recibido`, con `roundMoney(totalVes - paidVes) > 0`. Solo lectura; más antiguo primero. Ruta: [`src/app/api/payments/open-documents/route.ts`](../src/app/api/payments/open-documents/route.ts); servicios `openDocuments.server.ts` / `openDocuments.mock-server.ts` con el remate común `finalizeOpenDocuments`.

| Parámetro | Regla |
|-----------|-------|
| `type` | `sale` o `purchase`. Sin valor: ventas y, si el rol puede, también compras |
| `search` | Número de venta/compra (crudo o como se muestra) o nombre/RIF del contacto; máx. 120 |
| `contactId` | Cliente de la venta o proveedor de la compra; máx. 120 |
| `from`, `to` | Fecha Caracas del documento `YYYY-MM-DD`, inclusive; `from` posterior a `to` → 400 |
| `olderThanDays` | Entero 1–3650: documentos con N días o más (fecha Caracas ≤ hoy − N). Con `to` manda el límite más antiguo |
| `skip`, `limit` | Paginación estándar (`limit` máx. 100) |

Un parámetro vacío equivale a no enviarlo. `store_id` sale de la sesión.

**Permisos:** `payments.manage` o `sales.create` (misma regla que `POST /api/payments`). Las compras exigen además `payments.manage` y un rol que vea pagos de compra: el vendedor recibe 403 con `type=purchase` y solo ventas si no envía `type`.

**Respuesta** (`data`): `items[]`, `total`, `skip`, `limit` y `totals` del conjunto filtrado completo (no solo de la página): `count`, `pendingVes`, `pendingRef` (si algún documento lo tiene) y `truncated`. Cada `OpenDocument`: `type`, `id`, `number` (`invoice_number` o `purchase_number`), `status`, `createdAt`, `contact?` (`id`, `name`, `taxId?`), `totalVes`, `paidVes`, `pendingVes`, `totalRef`, `refRateVes`, `paidRef?` (solo compras) y `pendingRef?` (compras: `totalRef - paidRef`; ventas: `pendingVes / refRateVes`). Con Supabase el saldo se remata en servidor sobre un tope de filas leídas (3000 ventas `pendiente_pago`, 5000 compras abiertas); si se alcanza, `totals.truncated = true` (el mock nunca trunca).

### Idempotencia de `POST /api/payments`

`clientRequestId` (uuid, opcional) es la clave de idempotencia por intento, única por tienda:

- Misma clave + mismo contenido + mismo usuario → **201 con el pago original**, sin segundo pago ni segundo movimiento de caja, baúl o saldo del documento. El cliente no distingue el replay del alta.
- Misma clave con otra huella (otro contenido), otro usuario o un pago ya anulado → **409 `CONFLICT`**.
- Sin clave → comportamiento anterior (app móvil y scripts).

Paridad en `payments.mock-server.ts` (el mock compara contenido y pago anulado; no distingue usuario). Test de laboratorio: `scripts/stock-lab/regression/payments-idempotency.test.ts` (P4-3 en [`stock-integrity.md`](stock-integrity.md)).

**Parche [`supabase/patches/20261008a-register-payment-idempotency.sql`](../supabase/patches/20261008a-register-payment-idempotency.sql):** añade `payments.client_request_id` y `client_request_hash` con índice único por tienda, la función interna `payment_idempotent_replay` y el parámetro `p_client_request_id` en `register_payment` (firma de 13 argumentos; elimina la de 12 para no dejar dos sobrecargas). Dos peticiones simultáneas con la misma clave se serializan con un advisory lock por (tienda, clave). **No cambia la semántica monetaria** de `register_payment` ni toca `create_sale_with_payments`; no migra filas.

- **NO está aplicado en producción.** Hay que aplicarlo **antes de desplegar** el BFF que envía la clave; `verify-patches.sql` lo comprueba.
- Si falta (PostgREST responde `PGRST202`), el BFF **degrada**: registra el pago una vez **sin idempotencia**, nunca un 500. Es decir, sin el parche la protección contra duplicados no existe aunque la UI envíe la clave.
- **Reaplicar `20261006b`, `c`, `f`, `g` o `h` reinstala la firma de 12 argumentos: hay que volver a aplicar `20261008a` después.**

**Pendiente:** revisión UX confirmación al anular (endpoint y UI ya existen).

---

## Nómina

Comisión quincenal de los cajeros. **Sin sueldo fijo:** el cajero cobra un porcentaje de las ventas que él generó y que ya están cobradas. El admin es el dueño, no cobra nómina; sus retiros siguen siendo retiros del baúl.

| Ruta | Permiso |
|------|---------|
| `/payroll` | `payroll.manage` |
| `/payroll/[periodId]` | `payroll.manage` (o dueño del recibo) |
| `/payroll/settings` | `payroll.manage` |
| `/payroll/mine` | `payroll.view_own` |

| Hook | Endpoint |
|------|----------|
| `usePayrollSettings` | GET/PATCH `/api/payroll/settings` → RPC `upsert_payroll_settings` |
| `useUpdatePayrollEmployee` | PUT `/api/payroll/employees/[profileId]` → RPC `upsert_payroll_employee` |
| `usePayrollPeriods` | GET `/api/payroll/periods` |
| `useComputePayrollPeriod` | POST `/api/payroll/periods` → RPC `compute_payroll_period` |
| `usePayrollPeriod` | GET `/api/payroll/periods/[id]` |
| `useRecomputePayrollPeriod` | POST `/api/payroll/periods/[id]/recompute` (solo `borrador`) |
| `useApprovePayrollPeriod` | POST `/api/payroll/periods/[id]/approve` → RPC `approve_payroll_period` |
| `usePayPayrollItem` | POST `/api/payroll/items/[id]/pay` → RPC `pay_payroll_item` |
| `useCancelPayrollPayment` | POST `/api/payroll/items/[id]/cancel-payment` → RPC `cancel_payroll_payment` |
| `usePayrollCurrent` | GET `/api/payroll/current` — quincena en curso (estimación) y anterior |
| `useMyPayroll` | GET `/api/payroll/mine`, `/api/payroll/mine/current` |

**Quincenas:** Q1 = día 1–15, Q2 = día 16–último día del mes, en día operativo Caracas (`[T04:00Z, siguiente T04:00Z)`). Clave `YYYY-MM-Q1` / `YYYY-MM-Q2` ([`quincena.ts`](../src/modules/payroll/utils/quincena.ts)).

**Base comisionable:** ventas con `user_id` del cajero, `status = 'pagada'`, medidas en `total_ref`, **posteriores a `payroll_settings.commission_since`** (por defecto, el día en que se configura la nómina: sin esa frontera la primera quincena arrastraría toda la historia de la tienda). Cada venta comisiona **una sola vez en toda la historia** — lo garantiza el índice único de `payroll_commission_sales`. Una venta `pendiente_pago` no comisiona; cuando se cobra entra en la siguiente quincena que se calcule, marcada *cobrada tarde*. Si una venta ya comisionada se cancela o devuelve, la siguiente quincena resta esa comisión como reverso; el total de un cajero nunca baja de 0 y la diferencia no se arrastra.

**Ciclo:** `borrador` (recalculable) → `aprobado` (se consumen las ventas, `commission_pct` congelado) → `pagado` (todos los ítems pagados). Las filas de `payroll_commission_sales` se escriben al **aprobar**, no al calcular, para que recalcular no gaste ventas.

**Pago:** sale del baúl con `vault_movements.type = 'payroll_out'` (cubeta `efectivo` en Bs o USD, `cuenta` para pago móvil y transferencia) y snapshot de tasa. Un ítem de total 0 se marca pagado sin movimiento. Anular restituye el saldo, escribe el asiento contrario (`adjustment`, nunca borra el original — lección de [`cuadre-baul.md`](cuadre-baul.md) §3) y devuelve el periodo a `aprobado`; exige una nota. El monto entregado tiene que ser el del recibo: no hay abonos parciales.

**Moneda del monto (`PayrollPayModal`, PAG-08):** si los métodos habilitados de la tienda llegan después de teclear el monto y el método elegido se sustituye por uno de otra moneda, el monto tecleado se descarta y el campo vuelve al total sugerido (antes Bs 500 se enviaba como USD 500); dentro de la misma moneda se conserva.

**Semáforo:** `comisiones / ganancia bruta` de la quincena. Verde < 25 %, ámbar 25–40 %, rojo > 40 % (umbral configurable). Solo informa, **nunca bloquea el pago**. Sin ganancia bruta muestra "sin datos" en vez de dividir por cero.

**Fuera de alcance:** sueldo mínimo, utilidades, prestaciones y vacaciones. Un esquema 100 % variable debe validarlo un contador.

Patch: [`supabase/patches/20260907-payroll.sql`](../supabase/patches/20260907-payroll.sql) — incluye la reescritura de `vault_balance_check` para que `payroll_out` cuente como salida y no aparezca como descuadre ([`cuadre-baul.md`](cuadre-baul.md)).

---

## Reportes

| Ruta | Permiso |
|------|---------|
| `/reports` | `reports.view` |

| Hook | Endpoint | Vista / fuente |
|------|----------|----------------|
| `useDailySalesReport` | GET `/api/reports/daily-sales` | `daily_sales_summary` |
| `useGrossProfitReport` | GET `/api/reports/gross-profit` | `gross_profit_summary` |
| `useProductProfitabilityReport` | GET `/api/reports/product-profitability` | `product_profitability` |
| `useLowStockReport` | GET `/api/reports/low-stock` | `low_stock_products` |
| `useCustomerPurchasesReport` | GET `/api/reports/customer-purchases` | `customer_purchase_summary` |
| `useSupplierPurchasesReport` | GET `/api/reports/supplier-purchases` | `supplier_purchase_summary` |
| `useStockCardReport` | GET `/api/reports/stock-card` | `stock_card` |
| `useTopProductsReport` | GET `/api/reports/top-products` | agregado `sale_items` |
| `useTopCustomersReport` | GET `/api/reports/top-customers` | agregado ventas |
| `usePurchasesReport` | GET `/api/reports/purchases` | tabla `purchases`; `supplierId`, `status` (ver "Criterio de estados") |
| `useFxDepreciationReport` | GET `/api/reports/fx-depreciation` | pagos de venta + tasa vigente (`exchange_rates`) |
| `usePaymentMethodsReport` | GET `/api/reports/payment-methods` | pagos de venta activos (`status=activo`, `sale_id` not null) por método |
| `useDailyCloseReport` | GET `/api/reports/daily-close` | composición: ventas Caracas + mix pagos + FX + snapshot caja/baúl |

Rangos `from`/`to` en reportes de fecha usan **día operativo America/Caracas**.

### Reportes de dinero (parche `20261013a`, hooks en `useMoneyReports.ts`)

Además de `reports.view`, cada ruta aplica `assertMoneyReportAccess` (`services/moneyReports.ts`). Nada por vendedor.

| Hook | Endpoint | Parámetros | Permiso extra | Vista |
|------|----------|------------|---------------|-------|
| `useSalesByHourReport` | GET `/api/reports/sales-by-hour` | `from`, `to` (obligatorios) | — | `report_sales_by_hour` |
| `useSalesByCategoryReport` | GET `/api/reports/sales-by-category` | `from`, `to` (obligatorios) | — | `report_sales_by_category` |
| `useReceivablesAgingReport` | GET `/api/reports/receivables-aging` | `bucket` (`0-7` \| `8-30` \| `30+`), `contactId`, `skip`, `limit` | `payments.manage` o `sales.create` | `report_open_documents_aging` + `_summary` |
| `usePayablesAgingReport` | GET `/api/reports/payables-aging` | igual | `payments.manage` y rol que ve pagos de compra | las mismas |
| `useCashCloseDifferencesReport` | GET `/api/reports/cash-close-differences` | `from`, `to`, `currency`, `skip`, `limit` | `cash.view` | `report_cash_close_differences` (solo lectura) |

La antigüedad de un documento abierto se cuenta en días de calendario Caracas **desde la fecha del documento** (no existe fecha de vencimiento): "vencido" = tramo `30+`. El resumen por tramo (`summary.buckets`) no depende de la página ni de `bucket`. La tarjeta "Cuentas por cobrar vencidas" del dashboard (`DashboardOverdueReceivablesCard`) lee solo ese resumen y enlaza a `/reports?report=receivables-aging&bucket=30%2B`; no se monta ni pide nada para un rol que recibiría 403.

### Reportes de inventario (parche `20261013b`, hooks en `useInventoryReports.ts`)

Exigen `reports.view` **y** `inventory.view` (`assertInventoryReportAccess`): con los roles por defecto, solo admin. Leen el libro `stock_movements` en su orden real (`seq`), nunca `stock_after`.

| Hook | Endpoint | Parámetros | Vista |
|------|----------|------------|-------|
| `useDeadStockReport` | GET `/api/reports/dead-stock` | `days` (1–3650, 30 por defecto), `categoryId`, `skip`, `limit` | `report_product_last_movement` |
| `useStockTurnoverReport` | GET `/api/reports/stock-turnover` | `from`, `to` (obligatorios), `groupBy` (`product` \| `category`), `skip`, `limit` | `report_stock_daily_flow` |
| `useStockAdjustmentsReport` | GET `/api/reports/stock-adjustments` | `from`, `to` (obligatorios), `groupBy` (`day` \| `week` \| `month` \| `auto`), `skip`, `limit` | `report_stock_adjustments` |

### Series: `groupBy` y `compare`

`daily-sales`, `gross-profit` y `purchases` devuelven, además de la tabla paginada, un bloque `series` cuando llegan `from` + `to` y (`groupBy` o `compare`); sin ellos responden como antes. Lógica pura en `services/reportSeries.ts`.

- `groupBy` = `day` \| `week` (lunes a domingo) \| `month` \| `auto` (≤ 62 días → día; ≤ 370 → semana; más → mes). La respuesta trae el `groupBy` efectivo. Los periodos sin datos van en 0.
- `compare=1` añade el periodo anterior (mismo nº de días justo antes de `from`), alineado por posición, con totales y `deltaPct` (`null` si el anterior es 0). `payment-methods` acepta `compare=1` y devuelve `comparison`.
- Fechas mal formadas, `from > to`, `groupBy` desconocido o un rango de más de 10 años → 400 en español.
- La tabla y la serie salen de las mismas filas: el total del gráfico es la suma de la tabla del rango.
- En la URL de `/reports` el estado vive en `report`, `from`, `to`, `preset`, `groupBy`, `compare` (`useUrlListState`).

### Día operativo de las vistas diarias (cambio de `20261013a`)

- Desde `20261013a`, `daily_sales_summary` y `gross_profit_summary` agrupan por **día operativo America/Caracas** (`(created_at at time zone 'America/Caracas')::date`). Antes agrupaban por día UTC: una venta de 20:00–23:59 de Caracas caía en el día siguiente. Los totales de un rango no cambian; cambia el reparto por día, así que una fila diaria anterior al parche no es comparable con una posterior.
- **Orden de parches:** `20260716b-multi-store-views.sql` recrea esas dos vistas con el día UTC. Si se reaplica `20260716b`, hay que volver a aplicar `20261013a` después (`verify-patches.sql` lo detecta).
- "Cierre del día" (`dailyCloseSummary.server.ts`) y "Depreciación FX" (`fxDepreciationReport.server.ts`) **no leen esas vistas** (leen `sales`, `sale_items`, `payments` y `exchange_rates` con el rango ya en día Caracas): sus cifras son idénticas antes y después del parche. Evidencia en la base lab: `.notes/ux-mejoras/reportes/lab/no-rompe/` (diff vacío).

### Criterio de estados

- **Ventas (todas las vistas y reportes de ventas, existentes y nuevos):** se excluyen solo `cancelada` y `devuelta`. Una venta en `borrador` **cuenta**. Es un hallazgo abierto: no se cambia en el plan ux-mejoras, y cambiarlo exige hacerlo a la vez en todas las vistas y en el mock. Top productos y top clientes aplican el mismo criterio en servidor y mock.
- **Inventario (`20261013b`):** no filtra por estado de venta; lee el libro `stock_movements`, donde una venta cancelada o devuelta aparece con su salida y su reversión. Para "qué venta cuenta" remite a la definición anterior.
- **Compras (`/api/reports/purchases`):** la tabla y la serie usan la misma regla. Por defecto se excluyen `cancelado` y `devuelto`; `status=all` las incluye y `status=pedido|recibido|cancelado|devuelto` deja solo ese estado (otro valor → 400). `total` y la paginación respetan el filtro. El exporte (`fetchReportsForExport.ts`) y la herramienta `compras_periodo` del asistente no envían `status`: usan el valor por defecto, así lo exportado cuadra con lo que se ve.

### Componentes compartidos de reportes

En `src/shared/components/`, con tokens del tema (claro / oscuro) y sin librerías nuevas (Recharts):

- `TimeSeriesChart`: serie temporal (ventas, ganancia bruta, compras, flujo del dashboard) con periodo anterior opcional. Único componente para series.
- `RankingBarChart`: barras horizontales para rankings (top productos, clientes, categorías).
- `HeatmapChart`: mapa de calor (ventas por hora y día de la semana).
- `DateRangeField`: único control de rango de fechas (presets + calendario propio, sin inputs nativos de fecha); su valor se lee y se escribe en la URL (`dateRangeUrl.ts`, `dateRangePresets.ts`).
  - Lo usan `/reports`, `/platform/reports`, los dashboards y los listados de ventas, compras, pagos y movimientos de inventario (parámetros `from` / `to` / `preset`), además de `PaymentDocumentPicker`, el buscador de documentos previo a `RegisterPaymentModal` (estado local). La consulta usa siempre el rango de `parseDateRangeParams`, nunca `state.from/to`: un `preset` relativo (`preset=last_month`) no trae fechas y se recalcula con el día operativo. Helpers de test: `DateRangeField/testing.ts`.
  - Fechas nativas que quedan (una sola fecha, no un rango): `PayrollSettingsForm` («Las comisiones cuentan desde»).
- Impresión: las reglas `@media print` de `globals.css` son solo del ticket de 80 mm y cuelgan de `:has(#sale-receipt-preview)`; el `@page` del ticket lo monta `SaleReceiptPrintPageStyle` junto al recibo. Cualquier otra pantalla se imprime con la hoja y los márgenes del navegador.
- `charts/chartTheme.ts`: colores, ejes y rejilla de los gráficos a partir de los tokens `--chart-1..5`; ningún gráfico define colores literales.

**Pendiente:** filtros fecha en todos los reportes. Vista previa modal + export PDF/Excel.

---

## Asistente IA de consultas

Chat en lenguaje natural sobre los datos del negocio. El modelo **no escribe SQL ni ve la base**: solo elige qué reporte llamar y con qué parámetros. Diseño y costos: [`chat-ia-analisis.md`](chat-ia-analisis.md).

| Ruta | Permiso |
|------|---------|
| `/assistant` | `assistant.use` (admin y superadmin; ningún otro rol) |

| Hook | Endpoint | Notas |
|------|----------|-------|
| `useAssistantChat` | POST `/api/chat` | Envuelve `useChat` del AI SDK con `DefaultChatTransport`; mapea 429/502 a mensajes en español |
| `useAssistantUsage` | GET `/api/assistant/usage` | `{ used, limit, resetsAt }` |

### Aislamiento (regla que no se negocia)

`store_id` **jamás** es argumento del modelo. `resolveAssistantContext` lo toma de la sesión:

- **admin** → `scope: "store"`, `storeIds = [auth.storeId]`, solo herramientas de tienda.
- **superadmin** → `scope: "platform"`, `storeIds` = tiendas activas, solo herramientas de plataforma. Los nombres de tienda que da el usuario los resuelve el servidor (`resolveStoreRefs`); si no coinciden, la herramienta devuelve `ok:false` con la lista de candidatos.

Los dos conjuntos de herramientas son **disjuntos**: un admin nunca ve `comparar_tiendas` y un superadmin nunca ve `ventas_periodo`.

> `requirePermission` bloquea al superadmin en cualquier permiso sin prefijo `platform.`, por eso el asistente resuelve su contexto en [`session.ts`](../src/modules/assistant/server/session.ts) en vez de reutilizar ese guard.

### Herramientas

Tienda (`scope: "store"`), todas envoltorios finos de servicios existentes:

| Tool | Servicio |
|------|----------|
| `ventas_periodo` | `getDashboardMetrics` (2 llamadas si se pide comparación) |
| `ganancia_bruta` | `getGrossProfitReport` + agrupación por día o mes |
| `top_productos` | `getTopProductsReport` (+ nombres vía `resolveProductNames`) |
| `top_clientes` | `getTopCustomersReport` |
| `rentabilidad_productos` | `getProductProfitabilityReport` |
| `compras_periodo` | `getPurchasesReport` / `getSupplierPurchasesReport` |
| `stock_bajo` | `getLowStockReport` |
| `cierre_dia` | `getDailyCloseSummary` |
| `metodos_pago` | `getPaymentMethodsReport` |
| `capital_actual` | `capital.server.ts` / `capital.mock-server.ts` (nuevo) |
| `nomina_quincena` | `getPayrollCurrent` / `listPayrollPeriods` — sin argumento devuelve la estimación de la quincena en curso |

Plataforma (`scope: "platform"`): `listar_tiendas` (`listStores`) y `comparar_tiendas` (ventas + ganancia + capital por tienda, con ranking).

Toda salida es `AssistantToolResult`: `{ ok, source, range?, data, note? }` o `{ ok:false, error, options? }`. Las listas se recortan a **20 filas** con `note: "Mostrando N de M"`. Una excepción dentro de una tool se convierte en `ok:false`, nunca en un 500.

### Capital actual (definición fija)

```
capital_ref = baúl.balance_ref
            + (baúl.balance_efectivo_ves + baúl.balance_ves) / tasa_del_día
            + inventario_a_costo_ref            (Σ current_stock × current_cost_ref, activos)
            + cuentas_por_cobrar_ref            (ventas `pendiente_pago`: total_ref − paid_ves/ref_rate_ves)
            − cuentas_por_pagar_ref             (compras `pedido`/`recibido`: total_ref − paid_ref)
```

La tool devuelve **cada componente por separado** además del total y su equivalente en Bs. Los componentes salen de la vista `store_capital_summary`; la conversión Bs→REF la hace el servicio con la tasa vigente. La respuesta siempre agrega la nota *"El saldo del baúl depende de que los cierres de caja estén transferidos"* (ver [`cuadre-baul.md`](cuadre-baul.md)).

### Fechas

`resolveRange({from,to,preset})` devuelve un rango ISO en **día operativo America/Caracas**. Presets: `hoy`, `ayer`, `desde_ayer`, `esta_semana`, `semana_pasada`, `este_mes`, `mes_pasado`, `ultimos_7_dias`, `ultimos_30_dias`, `ultimos_3_meses`, `este_anio`. Rangos invertidos se corrigen, fechas futuras se recortan a hoy y fechas inexistentes (`2026-02-30`) devuelven error controlado.

### Proveedor y límites

| Variable | Default | Uso |
|----------|---------|-----|
| `ASSISTANT_PROVIDER` | `google` | `google` \| `anthropic` \| `mock` |
| `ASSISTANT_MODEL` | — | Fija el modelo; si se omite: `gemini-2.5-flash` / `claude-haiku-4-5` |
| `GOOGLE_GENERATIVE_AI_API_KEY` | — | Sin key utilizable el proveedor cae a `mock` con un `console.warn` |
| `ANTHROPIC_API_KEY` | — | Alternativa de pago |
| `ASSISTANT_DAILY_LIMIT` | `100` | Consultas por usuario por día (día Caracas) |

`temperature: 0`, `stopWhen: stepCountIs(5)`, historial recortado a los **últimos 10 mensajes**, timeout de **45 s** al proveedor. El body solo acepta mensajes `user`/`assistant`: un `system` inyectado desde el cliente devuelve 400. Del historial solo sobrevive el **texto**: un `tool-*` fabricado en `parts` se descarta antes de llegar al modelo.

> El free tier de Gemini es de **20 peticiones/día por modelo** (medido sep 2026), asi que el modelo elegido no cambia la cuota. El default es `gemini-2.5-flash` por estabilidad: `gemini-flash-latest` apunta a un preview que ya devolvio "high demand". Ver [`chat-ia-analisis.md`](chat-ia-analisis.md) §9.

### Tablas y parches

| Objeto | Parche |
|--------|--------|
| Vista `store_capital_summary` | `supabase/patches/20260906-store-capital-summary.sql` + `20260906c-store-capital-summary-rls.sql` |
| Tabla `assistant_queries` | `supabase/patches/20260906b-assistant-queries.sql` |

`assistant_queries` guarda pregunta, herramientas usadas, tokens, duración y error. La escribe **solo el service role**; admin lee las de su tienda y superadmin todas. Con `API_DATA_SOURCE=mock` el registro y el contador viven en memoria del proceso.

### Anti-alucinación

- El system prompt prohíbe cifras que no vengan de una herramienta y obliga a decir explícitamente cuando un rango viene vacío.
- La UI muestra, por cada tool call, un bloque plegable **"Fuente: {tool} · {from} → {to}"** con el resultado crudo tabulado.
- El contenido de las herramientas se declara como **datos, no instrucciones**: nombres de productos o clientes con texto tipo orden se tratan como texto literal.
- `npm run assistant:eval` corre el banco de `scripts/assistant-eval/questions.json` contra `/api/chat` y marca cualquier número de la respuesta que no aparezca en algún tool result. Con `ASSISTANT_EVAL_DELAY_MS` se pacea para el free tier.

**Pendientes:** el nombre de la tienda no llega al system prompt (el perfil no lo expone); no hay caché de respuestas repetidas; el historial no se persiste entre sesiones.

---

## Settings, usuarios y tasas

| Ruta | Permiso |
|------|---------|
| `/settings` | `settings.view` (PATCH settings y usuarios: `users.manage`) |

| Hook | Endpoint |
|------|----------|
| `useSettings` | GET `/api/settings` |
| `useUpdateSettings` | PATCH `/api/settings` |
| `useUsers` | GET `/api/users` |
| `useCreateUser` | POST `/api/users` — roles de tienda: admin, vendedor, almacen, contador |
| `useUpdateUser` | PATCH `/api/users/[id]` |
| `useExchangeRates` | GET `/api/exchange-rates` |
| `useCurrentExchangeRate` | GET `/api/exchange-rates/current` — tasa oficial vía servidor ([DolarAPI](https://ve.dolarapi.com/v1/dolares/oficial), campo `promedio`) |
| `useCreateExchangeRate` | POST `/api/exchange-rates` — solo historial manual |
| _(sin hook aún)_ | GET/POST `/api/tax-rates`, PATCH `/api/tax-rates/[id]` — catálogo de alícuotas de IVA por tienda (globales + propias); lectura `products.view` / `purchases.view` / `settings.view`, escritura `users.manage`; el PATCH es atómico (RPC `override_tax_rate_for_store`) |
| `useAdminCanSell` / `useSetAdminCanSell` | GET / PUT `/api/settings/admin-can-sell` — `users.manage`; estado `{ enabled, admins: [{ id, name, canSell }] }`, cuerpo del PUT `{ enabled }` |

**UI:** tabs en `/settings` — General / sistema, Usuarios (crear + listar/editar), Tasas.

**«El administrador puede vender» (POS-02):** tarjeta «Ventas del administrador» (`AdminCanSellCard`) en General / sistema. Interruptor apagado por defecto que concede o retira `sales.create` y `cash.operate` a todos los administradores de la tienda (no hay ajuste ni SQL nuevo: el estado son sus `granted_permissions`). Confirma con `ConfirmActionModal` («Vender en el POS», «Operar caja», administradores afectados y, al apagar, los turnos de caja que tengan abiertos). Con el interruptor apagado y un turno propio abierto, la tarjeta ofrece «Cerrar mi caja». Reglas completas en [`auth-permissions.md`](auth-permissions.md#el-administrador-puede-vender).

**Tasa vigente (servidor):** [`src/lib/exchange-rates/dolarApi.ts`](../src/lib/exchange-rates/dolarApi.ts), cache [`officialRateCache.ts`](../src/lib/exchange-rates/officialRateCache.ts), persistencia en `exchange_rates` con `source = "DolarAPI oficial"` (admin client, 1x/día o al cambiar valor). Variables: `DOLAR_API_OFFICIAL_URL`, `DOLAR_API_CACHE_TTL_MS`, `DOLAR_API_FETCH_TIMEOUT_MS`.

**`app_settings`:** `businessName`, `invoicePrefix`, `defaultTaxRate`, `defaultTaxRateId` (solo lectura, alícuota del catálogo), `lowStockThreshold`, `enabledPaymentMethods`.

**`tax_rates`:** `code`, `label`, `pct`, `isActive`, `sortOrder`; `isGlobal` (semilla común: exento 0, reducida 8, general 16) e `isDefault`. Cambiar una global crea la fila propia de la tienda con el mismo `code`. Las categorías exponen `taxRateId` y las líneas de compra aceptan `taxRateCode`. Parches `20261007a` y `20261007b` (aplicarlos antes de desplegar el BFF).

**`profiles`:** `role`, `isActive`, `grantedPermissions`, `deniedPermissions`.

**Pendiente:** UI para editar granted/denied por usuario.

---

## RPC Supabase (escrituras críticas)

| RPC | Endpoint API |
|-----|----------------|
| `create_sale` | POST `/api/sales` |
| `create_purchase` | POST `/api/purchases` |
| `receive_purchase` | PATCH `/api/purchases/[id]/receive` |
| `register_payment` | POST `/api/payments` — desde `20260903` acepta vuelto (`p_change_method`, `p_change_amount`) y desglose de billetes; ver [`cobro-pos-billetes.md`](cobro-pos-billetes.md) |
| `adjust_stock` | POST `/api/inventory/adjustments` |
| `convert_pack_to_units` | POST `/api/inventory/conversions` |
| `update_product_price` | POST `/api/products/[id]/price` |
| `register_supplier_product_price` | POST `/api/supplier-products/[id]/prices` |
| `deactivate_supplier_product` | PATCH `/api/supplier-products/[id]/deactivate` |
| `cancel_sale` | PATCH `/api/sales/[id]/cancel` |
| `return_sale` | POST `/api/sales/[id]/return` |
| `cancel_purchase` | PATCH `/api/purchases/[id]/cancel` |
| `return_purchase` | POST `/api/purchases/[id]/return` |
| `open_cash_session`, `close_cash_session` | POST `/api/cash/session/open`, `/api/cash/session/close` |
| `auto_close_stale_cash_sessions` | GET/POST `/api/cron/cash-sessions/auto-close` (`CRON_SECRET`; cada 15 min en Vercel) |
| `transfer_cash_closures_to_vault` | POST `/api/vault/transfers-from-cash` (`sessionIds`) |
| `register_vault_deposit`, `register_vault_withdrawal` | POST `/api/vault/deposits`, `/api/vault/withdrawals` |
| `upsert_payroll_settings`, `upsert_payroll_employee` | PATCH `/api/payroll/settings`, PUT `/api/payroll/employees/[profileId]` |
| `preview_payroll_commissions` | GET `/api/payroll/current`, `/api/payroll/mine/current` (estimación, no escribe) |
| `compute_payroll_period` | POST `/api/payroll/periods`, `/api/payroll/periods/[id]/recompute` |
| `approve_payroll_period` | POST `/api/payroll/periods/[id]/approve` |
| `pay_payroll_item`, `cancel_payroll_payment` | POST `/api/payroll/items/[id]/pay`, `/api/payroll/items/[id]/cancel-payment` |

Schema: [`supabase/supabase-schema.sql`](../supabase/supabase-schema.sql).

---

## Huecos globales (documentados)

| Funcionalidad | API | UI |
|---------------|-----|-----|
| DELETE contacto | No existe | Desactivar vía PATCH |
| Venta borrador | No | `create_sale` → `pendiente_pago` |
| MFA / registro / reset password | No | — |
| Multitienda / superadmin | Sí (v1) | `/platform/dashboard`, `/platform/stores`, `/platform/users`, `/platform/reports` — ver [`multi-store-options.md`](multi-store-options.md) |
| `POST /api/products/import/validate` | Opcional futuro | — |
| Escaneo por cámara | No | Lector USB sí |
