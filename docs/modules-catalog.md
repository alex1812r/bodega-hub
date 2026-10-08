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
- **401 global:** [`src/lib/query/query-client.ts`](../src/lib/query/query-client.ts) redirige a `/login`.
- **Demo dev:** `ALLOW_DEMO_AUTH=true` + headers `x-demo-role` desde `localStorage`.
- **Paginación:** `PaginatedList<T>` con `skip`, `limit`, `total`, `items`.
- **Plantilla Excel:** generación con **exceljs**; lectura de archivos subidos con **xlsx**.

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

| Ruta | Permiso |
|------|---------|
| `/inventory` | `inventory.view` |
| `/inventory/movements` | `inventory.view` |

| Hook | Endpoint |
|------|----------|
| `useInventory` | GET `/api/inventory` — `search`, `categoryId`, `stockStatus`, `lowStock`, paginación |
| `useInventoryMovements` | GET `/api/inventory/movements` — `productId` (+ filtros `type`/`date` solo en cliente) |
| `useStockCard` | GET `/api/inventory/stock-card` — `productId` |
| `useAdjustInventory` | POST `/api/inventory/adjustments` → RPC `adjust_stock` |
| `usePackConversions` | GET `/api/inventory/pack-conversions` |
| `useConvertPackToUnits` | POST `/api/inventory/conversions` → RPC `convert_pack_to_units` |

**Campos ajuste:** `productId`, `quantityDelta`, `reason`, `type` (`ajuste_entrada`, `ajuste_salida`, etc.).

**Conversion empaque→unidad (dual SKU):** vínculo en `product_pack_conversions`; movimiento emparejado `conversion_salida` + `conversion_entrada` con `conversion_id`. UI en detalle de producto e Inventario/movimientos.

**Campos opcionales (parche `20261006c`):** `clientRequestId` en ajustes y conversiones (misma clave por tienda → devuelve el resultado original sin mover nada); `saleId` / `purchaseId` en ajustes. Los tipos `devolucion_cliente` / `devolucion_proveedor` exigen el documento (400 sin él, parche `20261006g`) y el modal de ajuste ya no los ofrece.

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
| `adjust_stock` | `20261006g` | Firma `(p_product_id, p_quantity_delta, p_reason, p_type, p_client_request_id, p_sale_id, p_purchase_id)`; devoluciones solo ligadas a documento y con tope |
| `convert_pack_to_units` | `20261006c` | `p_client_request_id`; par y productos bloqueados en orden |
| `update_product_price`, `register_supplier_product_price`, `deactivate_supplier_product` | `20261006h` | Filtro de tienda, `PT403`, guarda de finitud |
| `record_cash_close_difference` | `20261006f` | Ya no ejecutable por cualquier usuario autenticado |

Errores de negocio: SQLSTATE `PT400` / `PT403` / `PT404` / `PT409` (PostgREST responde con ese HTTP).

**Pendiente:** anular movimiento (filtros de movimiento en API opcionales).

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

**Tab Saldos (`ContactBalancesTab`, PAG-04b):** documentos del contacto con saldo (`useOpenDocuments` con `contactId`), total REF/Bs, enlace a cada documento con `returnTo`, **Abonar** (`ContactSettlementModal`) y **Cobrar**/**Pagar** por documento (`RegisterPaymentModal`). Cliente = "Por cobrar", proveedor = "Por pagar", `ambos` = las dos secciones. Qué secciones se pintan lo decide `getContactBalanceSections` (misma regla que el servidor); sin ninguna, la pestaña no aparece. Detalle en [Pagos](#pagos).

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

**Venta y cobro en una sola transacción (patch `20260909-create-sale-with-payments.sql`):** el POS web manda los cobros dentro de `POST /api/sales` (`payments[]`, mismas reglas por método que `POST /api/payments`, esquema compartido en `src/modules/payments/services/paymentSchemas.ts`). El servidor llama al RPC `create_sale_with_payments`, que ejecuta `create_sale` y luego `register_payment` por línea dentro de la misma transacción: si un cobro falla (saldo, vuelto, caja cerrada…) Postgres revierte también la venta y el descuento de stock. Sin `payments` ni `clientRequestId` se sigue usando `create_sale` tal cual (app móvil y scripts cobran aparte). `clientRequestId` (uuid) es la clave de idempotencia por intento de cobro: se guarda en `sales.client_request_id` con índice único por tienda, y repetir la petición con la misma clave devuelve la venta ya creada. El POS la genera al procesar, la conserva mientras el carrito siga cargado y la descarta al vaciarlo. Un candado síncrono (`submitLockRef`) bloquea además el doble clic mientras viaja la petición. Al vender, cancelar o devolver se invalida también la caché de `products` (el catálogo del POS se cachea 5 min; antes el cajero seguía viendo el stock previo y el carrito le dejaba pedir unidades que ya no había). Antecedente: 29-ago-2026, cinco ventas idénticas sin pago creadas en seis minutos por reintentos del cajero cuando venta y cobro eran dos peticiones. **Antes de desplegar la app hay que aplicar el patch en la base**; `verify-patches.sql` lo comprueba.

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

**Crear:** `supplierId`, `status` (`pedido`|`recibido`), `items[]` con `entryMode` `unit` o `pack`, `discountRef`, `taxRef`, `refRateVes`, pago inicial opcional. Modo **empaque:** `packLabel`, `packCount`, `unitsPerPack`, `packCostRef` (RPC normaliza a unidades y costo unitario). Modo **unidad:** `quantity`, `unitCostRef`.

**UI `/purchases/create`:** toggle Unidad/Empaque por línea; presets desde catálogo `supplier_product_pack_units`; autocompletado si hay empaque predeterminado al agregar producto.

**Relaciones proveedor-producto:** GET/POST `/api/supplier-products`, PATCH metadatos `/api/supplier-products/[id]`, POST precios `/api/supplier-products/[id]/prices`, GET historial `/api/supplier-products/[id]/price-history`, PATCH baja `/api/supplier-products/[id]/deactivate`, **empaques** GET/POST `/api/supplier-products/[id]/pack-units`, PATCH/DELETE `/api/supplier-products/[id]/pack-units/[packId]`. Modal M15 `ManageSupplierProductPackUnitsModal` en tab Productos (contacto) y tabla Proveedores (producto).

**Pagar (`/purchases/[id]`, PAG-01b):** acción primaria de la cabecera que abre `RegisterPaymentModal` con `purchaseId` sin navegar. Visible solo con saldo en Bs (`roundMoney(totalVes - paidVes) > 0`), compra ni `cancelado` ni `devuelto`, `payments.manage` y un rol que vea pagos de compra (`canViewPurchasePayments`: no el vendedor). Tras registrar se refrescan saldo y tabla de pagos. Para "Pagar ahora" al crear la compra (COM-06) usar el mismo modal con apertura por código: contrato y ejemplo en [Pagos](#pagos).

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
| `onOpenChange` | `(open: boolean) => void` (opcional) | Se llama al abrirse y al cerrarse el modal por una acción del usuario. Con el pago en vuelo el cierre se ignora y no se llama. Necesaria si se pasa `open`. |
| `onRegistered` | `(payment: PaymentDetail) => void` (opcional) | Se llama una vez por pago registrado con éxito, con el pago que devolvió el servidor (`pendingBalanceVes` trae el saldo que queda). El modal no se cierra solo: muestra el saldo restante y permite otro abono; quien quiera cerrarlo lo hace aquí. |
| `trigger` | `ReactNode?` | Elemento que abre el modal al hacer clic. Sin `trigger` ni `open` se pinta un botón con el título. |
| `title` | `string?` | Título del modal. Por defecto "Pagar compra" o "Cobrar saldo" (venta). |
| `submitLabel` | `string?` | Texto del botón de envío. Por defecto "Registrar pago" (compra) o "Registrar cobro" (venta). |

Comportamiento:

- **Saldo:** cada apertura vuelve a pedir el documento y muestra "Saldo pendiente actual" (Bs). Mientras el saldo carga no se envía; un documento ya saldado no admite otro pago. La venta convierte con su propia tasa; la compra, con la tasa del día de la tienda (igual que `register_payment`), y un pago en USD que supere el saldo de la compra se bloquea antes de enviar.
- **Completar saldo:** rellena el monto con el saldo pendiente en la moneda del método (REF/Bs).
- **Clave de idempotencia por apertura:** cada envío lleva `clientRequestId`. Cada apertura estrena clave; con el modal abierto, reintentar sin cambios tras un error de resultado incierto (red, 5xx, 408, 409) conserva la clave y no duplica el pago, y el modal vuelve a pedir documento y pagos para que se vea si entró. Tras un éxito, o tras un 4xx con cambios en el formulario, la clave es nueva.
- **No cierra con el pago en vuelo:** Esc, X, clic fuera y Cancelar se ignoran mientras viaja la petición, y `onOpenChange` no se llama.
- **No se cierra solo:** tras registrar muestra el saldo restante y deja hacer otro abono. El consumidor decide en `onRegistered` (cerrar, navegar o nada).
- **Cambio de documento:** si `purchaseId`/`saleId` cambian, el modal se vuelve a montar por dentro (formulario limpio y clave nueva); no hace falta pasar `key`. Con `trigger`, ese cambio además lo cierra.
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

**Abono por confirmar (PAG-F7).** Un pago que falla sin que se sepa si se registró (red, 5xx, 408, 409) deja el abono *por confirmar*: el modal no deja editar ni empezar otro abono, solo **Reintentar pendientes** (misma clave por documento) hasta que cada pago quede registrado o rechazado con 4xx. Ese abono sobrevive a cerrar el modal y, guardado en `sessionStorage` por contacto y tipo ([`pendingSettlementStore`](../src/modules/payments/utils/pendingSettlementStore.ts): claves, documento, monto, método y campos enviados; se borra al resolverse o descartarse), a recargar y navegar: al abrir **Abonar** de nuevo se muestra directamente. **Quien monte el modal de forma condicional debe mantenerlo montado mientras `useHasPendingSettlement({ contactId, type })` sea `true`** (así lo hace `ContactBalancesTab`). Tras un rechazo definitivo (4xx) se puede reintentar, **Continuar con los demás** (envía los no enviados y deja el rechazado) o **Volver a editar** (reparte lo no registrado con saldos recién pedidos). Al abrir y tras cada fallo se vuelven a pedir los documentos con saldo (y se invalidan pagos, contacto y ventas/compras); el reparto no se ve ni se confirma hasta que llega la lista fresca. Si el modal se desmonta a mitad de la secuencia, el pago en vuelo termina y los siguientes no se envían (quedan guardados). Con pagos en vuelo o un abono por confirmar, un `ProcessGuard` ("Abono en curso") pregunta antes de salir de la pantalla; solo se monta en esos dos estados (un test que llegue a ellos debe simular `next/navigation`).

El reparto es la función pura [`allocatePayment`](../src/modules/payments/utils/allocatePayment.ts): recibe `amount`, `currency` (la del método), `documents` (del más antiguo al más nuevo, con `pendingVes` y `rateVes`) y `minPayableVes`; devuelve `allocations` (por documento: `amount`, `appliedVes`, `equivalent`, `remainingVes`), `appliedAmount`, `appliedVes` y `leftover` (`amount = appliedAmount + leftover`). Calcula con enteros para reproducir el `round(…, 2)` de Postgres y respeta el menor saldo que `register_payment` todavía deja pagar (`MIN_PAYABLE_VES_BY_DOCUMENT`: Bs 0,02 en ventas, Bs 0,01 en compras).

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
| `usePurchasesReport` | GET `/api/reports/purchases` | tabla `purchases` |
| `useFxDepreciationReport` | GET `/api/reports/fx-depreciation` | pagos de venta + tasa vigente (`exchange_rates`) |
| `usePaymentMethodsReport` | GET `/api/reports/payment-methods` | pagos de venta activos (`status=activo`, `sale_id` not null) por método |
| `useDailyCloseReport` | GET `/api/reports/daily-close` | composición: ventas Caracas + mix pagos + FX + snapshot caja/baúl |

Rangos `from`/`to` en reportes de fecha usan **día operativo America/Caracas**.

**Pendiente:** filtros fecha en todos los reportes; gráficos. Vista previa modal + export PDF/Excel.

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

**UI:** tabs en `/settings` — General / sistema, Usuarios (crear + listar/editar), Tasas.

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
