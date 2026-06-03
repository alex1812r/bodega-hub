# Endpoints BFF (Mock y Supabase)

Esta documentacion describe los endpoints internos en `src/app/api`. Los handlers enrutan a servicios mock o Supabase segun `API_DATA_SOURCE` (`mock` en tests; `supabase` en runtime por defecto).

**Catálogo completo por módulo:** [`modules-catalog.md`](modules-catalog.md)

Para trabajar, revisar o extender la capa backend: [`backend-api-agent-guide.md`](backend-api-agent-guide.md).

Para pantallas, hooks y flujos: [`frontend-api-guide.md`](frontend-api-guide.md).

## Convenciones

- Respuesta exitosa: `{ "data": ... }`.
- Respuesta de error: `{ "error": { "code": "...", "message": "..." } }`.
- Listados paginados: `{ "data": { "items": [], "skip": 0, "limit": 10, "total": 0 } }`.
- Query params de paginacion en listados: `skip` (default `0`) y `limit` (default `10`, minimo `10`, maximo `100`).
- Fuente de datos: `API_DATA_SOURCE=mock|supabase`. Si no se define, tests usan `mock` y runtime usa `supabase`.
- Rol demo: enviar header `x-demo-role` con `admin`, `vendedor`, `almacen` o `contador` cuando `ALLOW_DEMO_AUTH=true`.
- Si no se envia `x-demo-role`, el endpoint asume `admin`.
- Los `POST` y `PATCH` validan payload minimo con Zod.
- Los datos mock viven en `src/shared/mocks/erp-data.ts`.
- Los servicios mock viven como `*.mock-server.ts`; los servicios Supabase como `*.server.ts` dentro de cada modulo.

## Permisos Por Endpoint

| Endpoint | Metodos | Permiso | Descripcion |
| --- | --- | --- | --- |
| `/api/dashboard/summary` | `GET` | `dashboard.view` | Resumen (`daily_sales_summary` en Supabase) |
| `/api/dashboard/metrics` | `GET` | `dashboard.view` | Metricas por rango (`from`, `to`) |
| `/api/dashboard/recent-sales` | `GET` | `dashboard.view` | Ultimas ventas paginadas (`skip`, `limit`) |
| `/api/dashboard/low-stock` | `GET` | `dashboard.view` | Stock bajo compacto (`low_stock_products`) |
| `/api/categories` | `GET` | `products.view` | Lista categorias paginadas |
| `/api/categories` | `POST` | `products.manage` | Crea categoria |
| `/api/categories/[id]` | `GET` | `products.view` | Detalle de categoria |
| `/api/categories/[id]` | `PATCH` | `products.manage` | Actualiza categoria |
| `/api/categories/[id]` | `DELETE` | `products.manage` | Borrado logico de categoria |
| `/api/products` | `GET` | `products.view` | Lista productos paginados |
| `/api/products` | `POST` | `products.manage` | Crea producto (`409` si SKU duplicado) |
| `/api/products/import/template` | `GET` | `products.view` | Plantilla Excel importacion masiva (`.xlsx`) |
| `/api/products/[id]` | `GET` | `products.view` | Detalle de producto |
| `/api/products/[id]` | `PATCH` | `products.manage` | Actualiza producto (`409` si SKU duplicado) |
| `/api/products/[id]` | `DELETE` | `products.manage` | Borrado logico de producto |
| `/api/products/[id]/price` | `POST` | `products.manage` | Cambia precio (RPC `update_product_price` en Supabase) |
| `/api/products/[id]/price-history` | `GET` | `products.view` | Historial paginado de precios |
| `/api/products/[id]/suppliers` | `GET` | `products.view` | Proveedores asociados al producto |
| `/api/inventory` | `GET` | `inventory.view` | Stock actual (`products` / vista `low_stock_products`) |
| `/api/inventory/movements` | `GET` | `inventory.view` | Movimientos de stock (`stock_movements`) |
| `/api/inventory/stock-card` | `GET` | `inventory.view` | Kardex de inventario (vista `stock_card`) |
| `/api/inventory/adjustments` | `POST` | `inventory.manage` | Ajuste de stock (mock o RPC `adjust_stock`) |
| `/api/sales` | `GET` | `sales.view` | Lista ventas |
| `/api/sales` | `POST` | `sales.create` | Crea venta (`create_sale` RPC en Supabase) |
| `/api/sales/[id]` | `GET` | `sales.view` | Detalle de venta |
| `/api/sales/[id]` | `PATCH` | `sales.create` | Actualiza notas de venta |
| `/api/sales/[id]/cancel` | `PATCH` | `sales.create` | Cancela venta (`cancel_sale` RPC en Supabase) |
| `/api/sales/[id]/return` | `POST` | `sales.create` | Devolucion de cliente (`return_sale` RPC en Supabase) |
| `/api/sales/[id]/receipt` | `GET` | `sales.view` | Payload de recibo/factura |
| `/api/purchases` | `GET` | `purchases.view` | Lista compras |
| `/api/purchases` | `POST` | `purchases.create` | Crea compra (`pedido` o `recibido`) |
| `/api/purchases/[id]` | `GET` | `purchases.view` | Detalle de compra |
| `/api/purchases/[id]/receive` | `PATCH` | `purchases.create` | Recibe mercancia (`pedido` → `recibido`) |
| `/api/purchases/[id]/cancel` | `PATCH` | `purchases.create` | Cancela compra |
| `/api/purchases/[id]/return` | `POST` | `purchases.create` | Devolucion a proveedor |
| `/api/contacts` | `GET` | `contacts.view` | Lista contactos paginados (`contacts` en Supabase) |
| `/api/contacts` | `POST` | `contacts.manage` | Crea contacto (`contacts`; `tax_id` unico → `409`) |
| `/api/contacts/[id]` | `GET` | `contacts.view` | Detalle de contacto |
| `/api/contacts/[id]` | `PATCH` | `contacts.manage` | Actualiza contacto |
| `/api/contacts/[id]/activity` | `GET` | `contacts.view` | Actividad agregada (ventas/compras/pagos) paginada |
| `/api/contacts/[id]/sales` | `GET` | `contacts.view` | Ventas del cliente paginadas |
| `/api/contacts/[id]/purchases` | `GET` | `contacts.view` | Compras del proveedor paginadas |
| `/api/contacts/[id]/payments` | `GET` | `contacts.view` | Pagos del contacto paginados |
| `/api/payments` | `GET` | `payments.view` | Lista pagos paginada (`payments` + contacto) |
| `/api/payments` | `POST` | `payments.manage` | Registra pago (`register_payment` RPC en Supabase) |
| `/api/payments/[id]` | `GET` | `payments.view` | Detalle con saldo pendiente |
| `/api/payments/[id]` | `PATCH` | `payments.manage` | Actualiza notas y referencia bancaria |
| `/api/reports/daily-sales` | `GET` | `reports.view` | Vista `daily_sales_summary` (`from`, `to`, paginacion) |
| `/api/reports/gross-profit` | `GET` | `reports.view` | Vista `gross_profit_summary` (`from`, `to`, paginacion) |
| `/api/reports/product-profitability` | `GET` | `reports.view` | Vista `product_profitability` |
| `/api/reports/low-stock` | `GET` | `reports.view` | Vista `low_stock_products` |
| `/api/reports/customer-purchases` | `GET` | `reports.view` | Vista `customer_purchase_summary` |
| `/api/reports/supplier-purchases` | `GET` | `reports.view` | Vista `supplier_purchase_summary` |
| `/api/reports/stock-card` | `GET` | `reports.view` | Vista `stock_card` (`productId` opcional) |
| `/api/reports/top-products` | `GET` | `reports.view` | Agregado Supabase de `sale_items` por rango |
| `/api/reports/top-customers` | `GET` | `reports.view` | Agregado Supabase de ventas por cliente |
| `/api/reports/purchases` | `GET` | `reports.view` | Listado Supabase de compras con filtros |
| `/api/exchange-rates` | `GET` | `dashboard.view` | Lista tasas ref/VES (mock o `exchange_rates`) |
| `/api/exchange-rates/current` | `GET` | `dashboard.view` | Tasa vigente oficial: servidor consulta [DolarAPI](https://ve.dolarapi.com/v1/dolares/oficial) (`promedio` → `rateVes`), cache ~15 min, persistencia diaria en `exchange_rates`. No usa ultimo POST manual. Errores 502/503 si el proveedor falla. |
| `/api/exchange-rates` | `POST` | `payments.manage` | Registro manual solo historial (no redefine tasa vigente) |
| `/api/settings` | `GET` | `settings.view` | Configuracion general (`app_settings` id=1) |
| `/api/settings` | `PATCH` | `users.manage` | Actualiza singleton `app_settings` |
| `/api/users` | `GET` | `users.manage` | Lista `profiles` paginado + email via Auth admin |
| `/api/users/[id]` | `PATCH` | `users.manage` | Actualiza rol/estado/permisos en `profiles` |
| `/api/auth/me` | `GET` | ninguno (sesión o demo) | Perfil, rol y permisos efectivos desde Supabase `profiles` |
| `/api/auth/login` | `POST` | ninguno | Login Supabase Auth + cookies de sesión |
| `/api/auth/logout` | `POST` | ninguno | Cierra sesión Supabase y limpia cookies |
| `/api/openapi` | `GET` | ninguno | Contrato OpenAPI YAML |
| `/api/supplier-products` | `GET` | `products.view` | Relaciones proveedor-producto paginadas |
| `/api/supplier-products` | `POST` | `products.manage` | Crea relacion (`assert_contact_type` + `supplier_products`) |
| `/api/supplier-products/[id]` | `PATCH` | `products.manage` | Actualiza relacion proveedor-producto |
| `/api/suppliers/[id]/products` | `GET` | `products.view` | Productos por proveedor |

## Query Params Soportados

- `/api/products?search=taladro`: filtra por nombre o SKU.
- `/api/products?isActive=true`: filtra productos activos.
- `/api/products?categoryId=cat-electric`: filtra por categoria.
- `/api/products?isActive=true&categoryId=cat-electric`: combina filtros de activo y categoria.
- `/api/dashboard/metrics?from=2026-05-18&to=2026-05-18`: calcula metricas de dashboard por rango.
- `/api/supplier-products?supplierId=cont-supplier`: filtra relaciones por proveedor.
- `/api/supplier-products?productId=prod-cable`: filtra relaciones por producto.
- `/api/categories?search=herra`: filtra categorias por nombre.
- `/api/contacts?type=cliente&search=central`: filtra por tipo y busqueda.
- `/api/sales?status=pendiente_pago`: filtra ventas por estado.
- `/api/sales?customerId=cont-customer&from=2026-05-18&to=2026-05-18`: filtra ventas por cliente y rango.
- `/api/purchases?status=recibido`: filtra compras por estado.
- `/api/purchases?supplierId=cont-supplier&from=2026-05-17&to=2026-05-17`: filtra compras por proveedor y rango.
- `/api/inventory?lowStock=true`: devuelve solo productos bajo minimo.
- `/api/inventory/movements?productId=prod-cable`: filtra movimientos por producto.
- `/api/inventory/stock-card?productId=prod-cable`: filtra kardex de inventario por producto.
- `/api/exchange-rates?from=2026-05-18&to=2026-05-18`: filtra historial de tasas por rango.
- `/api/payments?direction=entrada`: filtra pagos por direccion.
- `/api/payments?saleId=sale-001`: filtra pagos por venta.
- `/api/payments?purchaseId=purchase-001`: filtra pagos por compra.
- `/api/payments?contactId=cont-customer`: filtra pagos por contacto.
- `/api/reports/stock-card?productId=prod-cable`: filtra kardex por producto.
- `/api/reports/top-products?from=2026-05-18&to=2026-05-18`: filtra productos mas vendidos por rango.
- `/api/reports/top-customers?from=2026-05-18&to=2026-05-18`: filtra clientes principales por rango.
- `/api/reports/purchases?supplierId=cont-supplier&from=2026-05-17&to=2026-05-17`: filtra reporte de compras.

## Payloads De Escritura

### Crear Producto

```json
{
  "name": "Martillo",
  "sku": "HER-MAR-001",
  "salePriceRef": 8,
  "currentCostRef": 4,
  "currentStock": 12,
  "minStock": 3,
  "categoryId": "cat-tools"
}
```

### Plantilla importacion masiva

`GET /api/products/import/template` devuelve `.xlsx` con columnas: `sku`, `nombre`, `categoria` (lista desplegable hacia hoja Categorias), `precio_ref`, `costo_ref`, `stock_inicial`, `stock_minimo`. Ver [`frontend-product-bulk-import.md`](frontend-product-bulk-import.md).

### Crear Categoria

```json
{
  "name": "Plomeria",
  "description": "Materiales de plomeria"
}
```

### Actualizar Producto

```json
{
  "salePriceRef": 9,
  "minStock": 4
}
```

### Crear Venta

```json
{
  "customerId": "cont-customer",
  "items": [
    {
      "productId": "prod-drill",
      "quantity": 1
    }
  ],
  "discountRef": 0,
  "taxRef": 0,
  "refRateVes": 510
}
```

### Crear Compra

```json
{
  "supplierId": "cont-supplier",
  "status": "recibido",
  "items": [
    {
      "productId": "prod-cable",
      "quantity": 2,
      "unitCostRef": 2
    }
  ],
  "discountRef": 0,
  "taxRef": 0,
  "refRateVes": 510,
  "notes": "Entrega programada"
}
```

Use `status: "pedido"` para registrar la compra sin mover stock. Luego confirma recepcion con `PATCH /api/purchases/[id]/receive`.

### Crear Contacto

```json
{
  "name": "Cliente Demo",
  "type": "cliente",
  "email": "cliente@example.com",
  "phone": "0412-0000000",
  "taxId": "J-00000000-0"
}
```

### Ajuste De Inventario

```json
{
  "productId": "prod-cable",
  "quantityDelta": 3,
  "reason": "Conteo fisico",
  "type": "ajuste_entrada"
}
```

### Crear Pago

```json
{
  "saleId": "sale-002",
  "method": "punto_venta",
  "amount": 1000,
  "referenceCode": "778899"
}
```

Validaciones mock por metodo:

- `pago_movil`: requiere `bankName`, `phone` y `referenceCode` de 4 digitos.
- `transferencia`: requiere `bankName` y `referenceCode`.
- `efectivo_usd`: acepta `currency: "USD"` y convierte a VES usando la tasa de la venta/compra.
- `punto_venta`: puede registrarse sin referencia.
- Todo pago debe estar asociado a una venta (`saleId`) o a una compra (`purchaseId`), pero no a ambos.
- La respuesta incluye `pendingBalanceVes` calculado contra el total de la venta/compra.

### Crear Tasa

```json
{
  "rateVes": 512,
  "source": "Manual"
}
```

## Ejemplos Curl

```bash
curl http://localhost:3000/api/products
```

```bash
curl -H "x-demo-role: vendedor" http://localhost:3000/api/sales
```

```bash
curl -X POST http://localhost:3000/api/sales \
  -H "content-type: application/json" \
  -H "x-demo-role: vendedor" \
  -d '{"customerId":"cont-customer","items":[{"productId":"prod-drill","quantity":1}]}'
```

```bash
curl -X POST http://localhost:3000/api/inventory/adjustments \
  -H "content-type: application/json" \
  -H "x-demo-role: almacen" \
  -d '{"productId":"prod-cable","quantityDelta":3,"reason":"Conteo fisico"}'
```

## Tests

Los tests de handlers importan `GET`, `POST` o `PATCH` directamente desde cada `route.ts` y usan entorno Node:

```ts
/**
 * @jest-environment node
 */
```

Comandos:

```bash
npm test -- api
npm run typecheck
npm run lint
```

Guards automatizados:

- `src/app/api/api-contract.test.ts` valida que cada handler tenga test y entrada en `public/openapi.yml`.
- `src/shared/api/client-hooks-contract.test.ts` valida que los hooks cliente `use*` que consuman `/api` tengan test adyacente.

## OpenAPI Y Swagger UI

El contrato inicial vive en `public/openapi.yml` y se puede abrir desde el navegador en `/openapi.yml`.

La documentacion visual esta disponible en `/api-docs`. Esa pagina usa Swagger UI y carga el contrato desde `/openapi.yml`. La ruta `/api/docs` redirige a `/api-docs` por compatibilidad.

Decision actual:

- Se mantiene OpenAPI como archivo estatico.
- `GET /api/openapi` sirve el contrato YAML para herramientas automatizadas.
- Swagger UI esta disponible en `/api-docs`, con redireccion desde `/api/docs`.
- Next lo sirve desde `public`, por eso la ruta publica es `/openapi.yml`.

Siguiente etapa recomendada:

1. Evaluar Scalar o Redoc si queremos una documentacion visual mas moderna o enfocada en lectura.
2. Agregar validacion automatica de OpenAPI en CI.
