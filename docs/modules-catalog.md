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
| Reportes | `/reports` | `reports.view` | vistas `daily_sales_summary`, etc. |
| Settings | `/settings` | `settings.view` / `users.manage` | `app_settings`, `profiles`, `exchange_rates` |

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

**UI:** tarjetas resumen, métricas por rango, tablas ventas recientes y stock bajo con paginación.

| Hook | Endpoint | Query / notas |
|------|----------|---------------|
| `useDashboardSummary` | GET `/api/dashboard/summary` | — |
| `useDashboardMetrics` | GET `/api/dashboard/metrics` | `from`, `to` (UI aún con fechas fijas en código) |
| `useDashboardRecentSales` | GET `/api/dashboard/recent-sales` | `skip`, `limit` |
| `useDashboardLowStock` | GET `/api/dashboard/low-stock` | `skip`, `limit` |
| `useCurrentExchangeRate` | GET `/api/exchange-rates/current` | Tasa en header del shell |

**Tablas/vistas:** `daily_sales_summary`, `low_stock_products`, agregados sobre `sales`.

**Pendiente:** selector de rango de fechas en UI; enlaces desde filas a detalle.

---

## Productos

### Rutas

| Ruta | Permiso | Pantalla |
|------|---------|----------|
| `/products` | `products.view` | Listado, filtros, crear, importar, desactivar, enlace a categorías |
| `/products/categories` | `products.view` | CRUD categorías (escritura: `products.manage`) |
| `/products/[id]` | `products.view` | Resumen, stock, historial precios, proveedores (tabla + cards + M10–M14), editar |
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
| `currentStock` | sí | `current_stock` |
| `minStock` | sí | `min_stock` |
| `description` | textarea UI | `description` (no siempre enviado) |
| `imageUrl` | subida con recorte 4:3 | `image_url` |
| `isActive` | desactivar listado | `is_active` |

### Imagen de producto

| Endpoint | Permiso | Descripcion |
|----------|---------|-------------|
| POST `/api/products/[id]/image-upload-url` | `products.manage` | URL firmada para subir `cover.webp` a Supabase Storage |
| DELETE `/api/products/[id]/image` | `products.manage` | Borra archivo Storage y limpia `image_url` |
| PATCH `/api/products/[id]` | `products.manage` | Persiste `imageUrl` tras subida |

- Bucket: `product-images` (patch [`supabase/patches/20260707-product-images-storage.sql`](../supabase/patches/20260707-product-images-storage.sql)).
- Path: `{productId}/cover.webp` o `{productId}/cover.png` si se quita el fondo (PNG con transparencia).
- Recorte opcional con **quitar fondo** vía `@imgly/background-removal` (IA en el navegador, sin servidor).
- Crear producto: recorte en modal → POST producto → subida post-id → PATCH `imageUrl`.
- Editar producto: subida o borrado inmediato desde el mismo modal.

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

**Campos ajuste:** `productId`, `quantityDelta`, `reason`, `type` (`ajuste_entrada`, `ajuste_salida`, etc.).

**Tabla:** `stock_movements`; stock actual en `products.current_stock`.

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

**Tabla:** `contacts`. Sin `DELETE` API (desactivar vía `PATCH isActive: false`).

**UI proveedor/ambos:** tab **Productos** (`ContactSupplierProductsTab`) — vincular (M10 con autocomplete producto/proveedor según contexto), cotizar, historial, editar metadatos, desvincular (modales M10–M14 en `contacts/components/supplier-products/`). Permisos `products.view` / `products.manage`.

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
| `useSales` | GET `/api/sales` — `status`, `customerId`, `from`, `to` |
| `useSale` | GET `/api/sales/[id]` |
| `useCreateSale` | POST `/api/sales` → RPC `create_sale` |
| `useCancelSale` | PATCH `/api/sales/[id]/cancel` |
| `useReturnSale` | POST `/api/sales/[id]/return` |
| `useSaleReceipt` | GET `/api/sales/[id]/receipt` |

**Crear venta:** `customerId`, `items[]` (`productId`, `quantity`), `discountRef`, `taxRef`, `refRateVes`, `notes`.

**UI POS (`/sales/create`):** grid de productos (`PosProductGrid` / `PosProductCard`) y carrito (`PosCartPanel` / `PosCartLine`) muestran precios en REF y equivalente VES por línea usando `useCurrentExchangeRate` → `rateVes` y `refToVes` (`src/shared/utils/currency.ts`). Cada línea del carrito: precio unitario REF + VES, total línea REF + VES; panel de totales incluye total VES cuando hay tasa vigente.

**Estados:** `borrador`, `pendiente_pago`, `pagada`, `cancelada`, `devuelta`.

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
| `usePayments` | GET `/api/payments` — `direction`, `saleId`, `purchaseId`, `contactId` |
| `usePayment` | GET `/api/payments/[id]` |
| `useCreatePayment` | POST `/api/payments` → RPC `register_payment` |

**Métodos:** `efectivo_ves`, `efectivo_usd`, `pago_movil`, `punto_venta`, `transferencia`. Validación por método en API.

**Pendiente:** revisión UX confirmación al anular (endpoint y UI ya existen).

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

**Pendiente:** filtros fecha en todos los reportes; gráficos. Export PDF/Excel ya disponible.

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
| `useUpdateUser` | PATCH `/api/users/[id]` |
| `useExchangeRates` | GET `/api/exchange-rates` |
| `useCurrentExchangeRate` | GET `/api/exchange-rates/current` — tasa oficial vía servidor ([DolarAPI](https://ve.dolarapi.com/v1/dolares/oficial), campo `promedio`) |
| `useCreateExchangeRate` | POST `/api/exchange-rates` — solo historial manual |

**Tasa vigente (servidor):** [`src/lib/exchange-rates/dolarApi.ts`](../src/lib/exchange-rates/dolarApi.ts), cache [`officialRateCache.ts`](../src/lib/exchange-rates/officialRateCache.ts), persistencia en `exchange_rates` con `source = "DolarAPI oficial"` (admin client, 1x/día o al cambiar valor). Variables: `DOLAR_API_OFFICIAL_URL`, `DOLAR_API_CACHE_TTL_MS`, `DOLAR_API_FETCH_TIMEOUT_MS`.

**`app_settings`:** `businessName`, `invoicePrefix`, `defaultTaxRate`, `lowStockThreshold`, `enabledPaymentMethods`.

**`profiles`:** `role`, `isActive`, `grantedPermissions`, `deniedPermissions`.

**Pendiente:** UI para editar granted/denied por usuario; crear usuarios desde app.

---

## RPC Supabase (escrituras críticas)

| RPC | Endpoint API |
|-----|----------------|
| `create_sale` | POST `/api/sales` |
| `create_purchase` | POST `/api/purchases` |
| `receive_purchase` | PATCH `/api/purchases/[id]/receive` |
| `register_payment` | POST `/api/payments` |
| `adjust_stock` | POST `/api/inventory/adjustments` |
| `update_product_price` | POST `/api/products/[id]/price` |
| `register_supplier_product_price` | POST `/api/supplier-products/[id]/prices` |
| `deactivate_supplier_product` | PATCH `/api/supplier-products/[id]/deactivate` |
| `cancel_sale` | PATCH `/api/sales/[id]/cancel` |
| `return_sale` | POST `/api/sales/[id]/return` |
| `cancel_purchase` | PATCH `/api/purchases/[id]/cancel` |
| `return_purchase` | POST `/api/purchases/[id]/return` |

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
