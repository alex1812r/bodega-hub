# Checklist De Integracion Frontend

Este checklist lista el estado de conexión del frontend contra la capa BFF `/api` (Supabase vía route handlers en runtime). La integración de datos de negocio está **completa** en módulos operativos; pendientes globales: middleware Next.js, anular pago, exportar reportes, imágenes producto.

**Catálogo por módulo:** [`modules-catalog.md`](modules-catalog.md)  
**Guía hooks/endpoints:** [`frontend-api-guide.md`](frontend-api-guide.md)  
**Permisos:** [`auth-permissions.md`](auth-permissions.md)

## Leyenda

- `[x]`: existe y está integrado o suficientemente cubierto.
- `[~]`: existe visualmente o parcialmente; falta cierre (auth, paginación, acción puntual).
- `[ ]`: pendiente.

## Estado General

- `[x]` Estructura base con Next.js App Router.
- `[x]` Páginas visuales para dashboard, login y módulos principales.
- `[x]` Componentes compartidos: botones, tablas, filtros, modales, estados, layout, tema, formularios.
- `[x]` Storybook con cobertura amplia de componentes, páginas y page-local.
- `[x]` API BFF en `src/app/api` (mock en dev, Supabase en prod).
- `[x]` Contrato OpenAPI y checklist backend en `docs/api-endpoints-checklist.md`.
- `[x]` Módulos principales consumen `/api` mediante hooks TanStack Query.
- `[x]` Rutas dinámicas por `id`: productos, contactos, ventas, compras, pagos; rutas `/detail` demo como compatibilidad temporal.
- `[x]` Capa cliente `apiFetch` y helpers de respuesta/error.
- `[x]` Hooks TanStack Query por módulo.
- `[x]` Estados `isLoading`, `isFetching`, `error`, `emptyState` en páginas reales.
- `[x]` Filtros visuales conectados a query params.
- `[x]` Formularios principales con mutaciones `POST`/`PATCH`.
- `[x]` Invalidación de queries tras crear, editar, cancelar, ajustar o registrar pagos.
- `[x]` Listados tipados como `PaginatedList<T>` con `getPaginatedItems()`.
- `[x]` Entrada `/` redirige a `/dashboard` o `/login` vía `src/app/page.tsx` (server).
- `[x]` Paginación UI: listados envían `skip`/`limit` y renderizan `<Pagination />` (reset al cambiar filtros).
- `[~]` Acciones puntuales: desactivar producto/contacto integrado; anular pago sin endpoint; exportar reportes diferido.
- `[x]` Autenticación BFF: login/logout/me, `useCurrentUser`, handler 401 global, permisos en shell.
- `[ ]` Middleware Next.js para prefijos privados sin sesión (opcional; hoy guard por página + API).

## Convencion De Integracion Por Modulo

Antes de marcar un modulo como integrado:

- `[x]` Tiene archivo(s) cliente para llamadas API, separados de los componentes.
- `[x]` Tiene hooks `use...` para lecturas y mutaciones con TanStack Query.
- `[x]` La pagina de listado consume datos reales de `/api`.
- `[x]` Los filtros actualizan estado/query params y disparan refetch.
- `[x]` La tabla muestra loading, fetching, error y empty state.
- `[~]` Las acciones principales navegan, abren modal o ejecutan mutacion real; desactivar producto/contacto y anular pago quedan como fase posterior.
- `[x]` Listados usan `PaginatedList` con paginacion UI (`skip`/`limit`) conectada.
- `[x]` Los formularios principales usan valores controlados, validacion y feedback de error.
- `[x]` Las mutaciones invalidan las queries afectadas.
- `[x]` La pagina tiene Storybook estable para revisar visualmente sus estados.
- `[x]` Tiene pruebas unitarias o de integracion enfocadas en hooks/acciones criticas.

## Orden Recomendado (próximos bloques)

1. `[x]` **Auth:** `useCurrentUser`, `useLogout`, `useLogin` vía BFF y handler 401.
2. `[x]` **Paginación UI:** `skip`/`limit` en hooks + `<Pagination />` en listados y reportes.
3. `[x]` **Acciones secundarias:** desactivar producto/contacto, `useReceivePurchase`, pago inicial en create compra.
4. `[x]` **Tasa en header:** `useCurrentExchangeRate` en `AuthenticatedAppShell`.
5. `[~]` **Permisos en botones:** `usePermission` + `Can` en plantilla (ventas/compras/pagos/productos); extender por módulo.
6. `[x]` Rutas `/detail` redirigen a `[id]` equivalente.

Bloques ya integrados: dashboard, productos, inventario, contactos, ventas, compras, pagos, reportes, settings/usuarios/tasas.

## Base Compartida De Frontend API

- `[x]` Crear helper `apiFetch` o equivalente para:
  - `[x]` Parsear respuestas `{ data }` y `{ error }`.
  - `[x]` Lanzar errores tipados con `code` y `message`.
  - `[x]` Enviar headers comunes.
  - `[x]` Soportar `x-demo-role` mientras no exista auth real.
- `[x]` Crear convencion de keys TanStack Query por modulo.
- `[x]` Crear helpers para serializar filtros a query params.
- `[x]` Crear tests del helper API.
- `[x]` Definir donde viviran los hooks cliente: dentro de cada modulo, no dentro de componentes.

## Paginacion UI

- `[x]` Tipo `PaginatedList<T>` y helper `getPaginatedItems()` en `src/lib/api/pagination.ts`.
- `[x]` Hooks de listado tipan respuesta como `PaginatedList<T>` (no `T[]`).
- `[x]` Paginas de listado extraen filas con `getPaginatedItems(data)`.
- `[x]` Componente `<Pagination />` con Storybook y tests Jest.
- `[x]` Hooks envian `skip` y `limit` en query params.
- `[x]` Paginas listado renderizan `<Pagination />` y sincronizan estado local (`usePaginationState`).
- `[ ]` Storybook de listados con escenario multi-pagina.

Listados afectados: productos, contactos, inventario, movimientos, ventas, compras, pagos, usuarios, tasas, reportes tabulares.

## Auth Y Permisos

- `[x]` `/login` con `LoginForm`, Storybook y tests.
- `[x]` `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`.
- `[x]` `useLogin`, `useLogout`, `useCurrentUser` conectados al BFF.
- `[x]` `AuthenticatedAppShell` filtra menu con permisos de `/api/auth/me`.
- `[x]` Redirect global 401 en TanStack Query.
- `[x]` `Can` / `usePermission` en ventas, compras, pagos, productos (parcial en otros modulos).
- `[ ]` `src/middleware.ts` para rutas privadas sin sesion.
- `[~]` Usuario inactivo (`isActive: false`) — validar UX en shell.
- `[ ]` Tests E2E de permisos por rol en UI.

## Dashboard

### Rutas Y Pantallas

- `[x]` `/dashboard` existe visualmente.
- `[x]` Las tarjetas consumen metricas desde `/api`.

### Pendiente

- `[x]` Crear hooks:
  - `[x]` `useDashboardSummary`.
  - `[x]` `useDashboardMetrics`.
  - `[x]` `useDashboardRecentSales`.
  - `[x]` `useDashboardLowStock`.
- `[x]` Conectar `GET /api/dashboard/summary`.
- `[x]` Conectar `GET /api/dashboard/metrics?from=&to=`.
- `[x]` Conectar `GET /api/dashboard/recent-sales`.
- `[x]` Conectar `GET /api/dashboard/low-stock`.
- `[~]` Agregar filtros de rango de fecha.
- `[x]` Mostrar loading skeleton de tarjetas.
- `[x]` Mostrar error con opcion de reintentar.
- `[x]` Agregar tablas/listas compactas de ventas recientes y stock bajo.

## Productos Y Categorias

### Rutas Y Pantallas

- `[x]` `/products` existe como listado visual.
- `[x]` `/products/detail` existe como compatibilidad demo (preferir `/products/[id]`).
- `[x]` Modal para crear/editar producto.
- `[x]` Componentes de resumen, inventario e historial de precios.
- `[x]` Boton crear producto → `POST /api/products`.
- `[x]` Detalle en `/products/[id]`.
### Pendiente

- `[x]` Crear hooks:
  - `[x]` `useProducts`.
  - `[x]` `useProduct`.
  - `[x]` `useCreateProduct`.
  - `[x]` `useUpdateProduct`.
  - `[x]` `useUpdateProductPrice`.
  - `[x]` `useProductPriceHistory`.
  - `[x]` `useCategories`.
  - `[x]` `useProductSuppliers`.
- `[x]` Conectar `GET /api/products`.
- `[x]` Conectar filtros `search`, `isActive`, `categoryId`.
- `[x]` Conectar `POST /api/products`.
- `[x]` Conectar `GET /api/products/[id]`.
- `[x]` Conectar `PATCH /api/products/[id]`.
- `[x]` Conectar `POST /api/products/[id]/price`.
- `[x]` Conectar `GET /api/products/[id]/price-history`.
- `[x]` Conectar `GET /api/products/[id]/suppliers`.
- `[x]` Ruta dinamica `/products/[id]`.
- `[x]` Crear producto en modal dentro de `/products`.
- `[x]` Desactivar producto via `PATCH /api/products/[id]` (`isActive: false`).
- `[x]` Validacion de SKU duplicado.
- `[x]` Categorias en filtros y formulario.
- `[ ]` Imagen/storage como fase posterior.

### Importacion masiva Excel

- `[x]` Ruta `/products/import` con permiso `products.manage`.
- `[x]` Wizard 5 pasos: plantilla, archivo, preview, progreso, resumen.
- `[x]` Descarga plantilla via `GET /api/products/import/template` (fallback cliente).
- `[x]` Validacion por fila en navegador (Zod, categorias, SKU duplicado en archivo).
- `[x]` Importacion secuencial `POST /api/products` con progreso en tiempo real.
- `[x]` Toggle continuar vs detener en primer error; cancelacion con AbortController.
- `[x]` Entrada desde listado `/products` → «Importar Excel».
- `[x]` Documentacion: [`frontend-product-bulk-import.md`](frontend-product-bulk-import.md).

## Inventario

### Rutas Y Pantallas

- `[x]` `/inventory` existe como listado visual.
- `[x]` `/inventory/movements` existe como pantalla visual de movimientos.
- `[x]` Modal visual para ajuste de inventario.
- `[x]` Ajuste de inventario persiste via `POST /api/inventory/adjustments`.
- `[x]` Modal detalle de movimiento (`InventoryMovementDetailModal`).

### Pendiente

- `[x]` Crear hooks:
  - `[x]` `useInventory`.
  - `[x]` `useInventoryMovements`.
  - `[x]` `useAdjustInventory`.
  - `[x]` `useStockCard`.
- `[x]` Conectar `GET /api/inventory`.
- `[x]` Conectar filtro `lowStock=true`.
- `[x]` Conectar `GET /api/inventory/movements`.
- `[x]` Conectar filtro `productId`.
- `[x]` Conectar `POST /api/inventory/adjustments`.
- `[x]` Conectar `GET /api/inventory/stock-card?productId=`.
- `[x]` Agregar vista de kardex por producto.
- `[x]` Mostrar error de stock negativo cuando aplique.
- `[x]` Invalidar inventario y movimientos despues de ajustar stock.

## Contactos

### Rutas Y Pantallas

- `[x]` `/contacts` existe como listado visual.
- `[x]` `/contacts/detail` como compatibilidad demo (preferir `/contacts/[id]`).
- `[x]` Modal para crear/editar contacto.
- `[x]` Componentes de perfil y actividad.
- `[x]` Detalle en `/contacts/[id]`.
- `[x]` Desactivar contacto via `PATCH /api/contacts/[id]` (`isActive: false`; sin DELETE API).

### Pendiente

- `[x]` Crear hooks:
  - `[x]` `useContacts`.
  - `[x]` `useContact`.
  - `[x]` `useCreateContact`.
  - `[x]` `useUpdateContact`.
  - `[x]` `useContactActivity`.
  - `[x]` `useContactSales`.
  - `[x]` `useContactPurchases`.
  - `[x]` `useContactPayments`.
- `[x]` Conectar `GET /api/contacts`.
- `[x]` Conectar filtros `type` y `search`.
- `[x]` Conectar `POST /api/contacts`.
- `[x]` Conectar `GET /api/contacts/[id]`.
- `[x]` Conectar `PATCH /api/contacts/[id]`.
- `[x]` Conectar `GET /api/contacts/[id]/activity`.
- `[x]` Conectar historiales de ventas, compras y pagos del contacto.
- `[x]` Crear o migrar ruta dinamica `/contacts/[id]`.
- `[x]` Mostrar validacion de `tax_id` duplicado.

## Ventas

### Rutas Y Pantallas

- `[x]` `/sales` listado integrado.
- `[x]` `/sales/[id]` detalle integrado.
- `[x]` `/sales/create` flujo de crear venta.
- `[x]` `/sales/detail` como compatibilidad demo.
- `[x]` Cancelar venta desde listado y detalle (`useCancelSale`).
- `[x]` Devolver venta (`useReturnSale`).
- `[x]` Comprobante (`useSaleReceipt`).
- `[x]` Registrar pago contextual desde detalle (`RegisterPaymentModal`).

### Integrado

- `[x]` Hooks: `useSales`, `useSale`, `useCreateSale`, `useCancelSale`, `useReturnSale`, `useSaleReceipt`.
- `[x]` `GET /api/sales` con filtros `status`, `customerId`, `from`, `to`.
- `[x]` `POST /api/sales`, `GET /api/sales/[id]`, `PATCH .../cancel`, `POST .../return`, `GET .../receipt`.
- `[x]` Seleccion de cliente y productos con stock/precio.
- `[x]` Totales ref/VES con tasa vigente en create.
- `[x]` Pagos parciales y saldo pendiente en detalle.
- `[~]` Extender `Can` a todas las acciones secundarias del modulo.

## Compras

### Rutas Y Pantallas

- `[x]` `/purchases` listado integrado.
- `[x]` `/purchases/create` registro integrado.
- `[x]` `/purchases/[id]` detalle integrado.
- `[x]` `/purchases/detail` como compatibilidad demo.
- `[x]` Cancelar compra (`useCancelPurchase`).
- `[x]` Devolver compra (`useReturnPurchase`).
- `[x]` Recibir compra (`useReceivePurchase` → `PATCH /api/purchases/[id]/receive`).
- `[x]` `status` pedido/recibido en formulario create.

### Integrado

- `[x]` Hooks: `usePurchases`, `usePurchase`, `useCreatePurchase`, `useCancelPurchase`, `useReturnPurchase`, `useReceivePurchase`, `useSupplierProducts`.
- `[x]` `GET /api/purchases` con filtros.
- `[x]` `POST /api/purchases`, `GET /api/purchases/[id]`, cancel/return.
- `[x]` Seleccion de proveedor y productos con costos.
- `[x]` Totales ref/VES y pago inicial opcional.
- `[x]` Invalidacion de inventario/productos tras crear.

## Pagos

### Rutas Y Pantallas

- `[x]` `/payments` listado integrado.
- `[x]` `/payments/[id]` detalle integrado.
- `[x]` `/payments/detail` como compatibilidad demo.
- `[x]` `RegisterPaymentModal` desde venta/compra.
- `[ ]` Anular pago (sin endpoint; hoy feedback temporal).

### Integrado

- `[x]` Hooks: `usePayments`, `usePayment`, `useCreatePayment`.
- `[x]` `GET /api/payments` con filtros `direction`, `saleId`, `purchaseId`, `contactId`.
- `[x]` `POST /api/payments`, `GET /api/payments/[id]`.
- `[x]` Metodos: efectivo VES/USD, pago movil, punto, transferencia.
- `[x]` Validacion de monto y asociacion a venta/compra.
- `[x]` Invalidacion de ventas/compras/pagos tras registrar.

## Reportes

### Rutas Y Pantallas

- `[x]` `/reports` panel integrado con reportes tabulares.
- `[ ]` Exportar reporte (PDF/Excel) — fase posterior.

### Integrado

- `[x]` Hooks en `useReports.ts`: daily sales, gross profit, product profitability, low stock, customer/supplier purchases, stock card, top products/customers, purchases report.
- `[x]` Filtros `from`, `to`, `groupBy` donde aplica.
- `[x]` Endpoints `GET /api/reports/*` conectados.
- `[x]` Metric cards y tablas por reporte.

## Configuracion Y Usuarios

### Rutas Y Pantallas

- `[x]` `/settings` con formulario de configuracion, tabla de usuarios y panel de tasas.
- `[x]` Selector de rol demo en settings (desarrollo).

### Integrado

- `[x]` Hooks: `useSettings`, `useUpdateSettings`, `useUsers`, `useUpdateUser`.
- `[x]` `GET /api/settings`, `PATCH /api/settings`.
- `[x]` `GET /api/users`, `PATCH /api/users/[id]`.
- `[x]` Formulario de configuracion y tabla de usuarios/perfiles.
- `[x]` Control de rol y estado activo en tabla usuarios.
- `[~]` Permisos granulares por usuario (UI demo; backend soporta granted/denied).

## Tasa Ref/VES

### Existente

- `[x]` Hook `useCurrentExchangeRate` y `GET /api/exchange-rates/current`.
- `[x]` Historial y registro de tasas en `/settings` (`useExchangeRates`, `useCreateExchangeRate`).
- `[x]` Ventas, compras y pagos envian `refRateVes` desde tasa vigente en formularios.
- `[x]` `AppShell` header muestra tasa via `useCurrentExchangeRate`.

## Rutas Demo (compatibilidad)

Rutas dinamicas ya existen. Estas rutas `/detail` quedan como alias/legacy:

- `[x]` `/products/[id]` — preferir sobre `/products/detail`.
- `[x]` `/contacts/[id]` — preferir sobre `/contacts/detail`.
- `[x]` `/sales/[id]` — preferir sobre `/sales/detail`.
- `[x]` `/payments/[id]` — preferir sobre `/payments/detail`.
- `[x]` `/purchases/[id]` creada.
- `[x]` `/sales/create` creada.
- `[ ]` Eliminar o redirigir rutas `/detail` cuando no queden enlaces.
- `[ ]` Evaluar `/inventory/movements/[id]` o modal de detalle de movimiento.

## Acciones pendientes (sin endpoint o fase posterior)

- `[ ]` Pagos: anular pago (UI disabled; sin API).
- `[ ]` Reportes: exportar PDF/Excel.
- `[ ]` Productos: imagen/storage; reactivar desde UI.
- `[ ]` Inventario: filtros `type`/`date` en API de movimientos.
- `[ ]` Dashboard: selector de rango de fechas en UI.

## Storybook Y Testing Pendiente Por Integracion

- `[x]` Storybook cubre los componentes visuales principales.
- `[x]` Storybook cubre listados, detalles y varios componentes page-local.
- `[x]` Tests de hooks API por modulo (Jest).
- `[~]` Stories de estados conectados: loading, empty, error, fetching (parcial).
- `[ ]` Tests de acciones de formularios y mutaciones adicionales.
- `[ ]` Pruebas de permisos en rutas/paginas (tras auth real).
- `[x]` `npm run lint`, `npm run typecheck`, `npm test` verdes (176 tests).

## Definicion De Done Por Bloque

Un bloque de modulo se considera listo cuando:

- `[x]` Las paginas consumen `/api` mediante hooks, no datos hardcodeados.
- `[x]` Las mutaciones principales funcionan contra la API.
- `[x]` Los estados de carga, vacio y error se ven correctamente.
- `[~]` Las acciones no quedan como `window.alert` salvo las marcadas como fase posterior arriba.
- `[x]` La navegacion usa rutas dinamicas o modales funcionales.
- `[x]` Storybook muestra los escenarios principales del modulo.
- `[x]` Tests y typecheck pasan.

Pendiente global: middleware Next.js, anular pago, export reportes, ampliar `Can` en todos los modulos.
