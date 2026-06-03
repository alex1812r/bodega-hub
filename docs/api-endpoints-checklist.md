# Checklist De Endpoints API

Este checklist compara el plan funcional del ERP contra los endpoints actuales en `src/app/api` (mayo 2026). Runtime usa Supabase por defecto; mock en tests (`API_DATA_SOURCE=mock`).

**Catálogo por módulo (pantallas, hooks, tablas):** [`modules-catalog.md`](modules-catalog.md)

## Leyenda

- `[x]`: endpoint existente y documentado.
- `[~]`: existe parcialmente, falta detalle funcional, filtros, validacion o conexion con flujo real.
- `[ ]`: pendiente.

## Estado General

- `[x]` Existe capa mock en `/api` con respuestas `{ data }` y errores `{ error }`.
- `[x]` Existe documentacion visual en `/api-docs`.
- `[x]` Existe contrato OpenAPI en `/openapi.yml`.
- `[x]` Existe header mock `x-demo-role` para permisos (dev/test con `ALLOW_DEMO_AUTH=true`).
- `[x]` Los endpoints operativos usan `resolveDataSource()` o factory de servicios (`getContactsService`) para alternar mock/Supabase.
- `[x]` Cliente Supabase server-side (`createRouteSupabaseClient`) en servicios `.server.ts`.
- `[x]` Servicios `.server.ts` reales en productos, categorias, inventario, contactos, ventas, compras, pagos, dashboard, reportes, settings y tasas.
- `[x]` Auth server-side: login/logout/me con Supabase Auth + perfil en `profiles`.
- `[~]` Los permisos soportan sesion real; `x-demo-role` sigue disponible en dev.
- `[x]` Hooks cliente TanStack Query consumen `/api` en todos los módulos operativos (ver [`modules-catalog.md`](modules-catalog.md)).

## Dashboard

- `[x]` `GET /api/dashboard/summary`: resumen mock con ventas, total ref/VES, stock bajo y ventas pendientes.
- `[x]` `GET /api/dashboard/summary`: Supabase via `daily_sales_summary`, `low_stock_products` y conteo de pendientes.
- `[x]` `GET /api/dashboard/metrics?from=&to=`: metricas por rango.
- `[x]` `GET /api/dashboard/metrics`: Supabase agrega ventas e items en rango.
- `[x]` `GET /api/dashboard/recent-sales`: ultimas ventas.
- `[x]` `GET /api/dashboard/recent-sales`: Supabase pagina tabla `sales`.
- `[x]` `GET /api/dashboard/low-stock`: resumen compacto de productos bajo minimo.
- `[x]` `GET /api/dashboard/low-stock`: Supabase lee vista `low_stock_products`.

## Productos

- `[x]` `GET /api/products`: listado paginado (mock + Supabase).
- `[x]` `GET /api/products?search=`: filtro por nombre o SKU.
- `[x]` `GET /api/products?isActive=true|false`: filtro por estado activo.
- `[x]` `GET /api/products?categoryId=`: filtro por categoria.
- `[x]` `POST /api/products`: creacion (mock + Supabase).
- `[x]` `GET /api/products/[id]`: detalle.
- `[x]` `PATCH /api/products/[id]`: actualizacion (mock + Supabase).
- `[x]` `DELETE /api/products/[id]`: borrado logico (`deleted=true` / `is_active=false`).
- `[x]` `POST /api/products/[id]/price`: cambio de precio via RPC `update_product_price` en Supabase.
- `[x]` `GET /api/products/[id]/price-history`: historial paginado de precios.
- `[x]` `GET /api/products/[id]/suppliers`: proveedores asociados al producto.
- `[x]` Validar SKU duplicado con `409`.
- `[x]` `GET /api/products/import/template`: plantilla Excel para importacion masiva (categorias desde BD/mock).
- `[ ]` Soporte real para imagen `image_url` o storage.

## Categorias

- `[x]` `GET /api/categories`: listado paginado (mock + Supabase).
- `[x]` `POST /api/categories`: crear categoria (mock + Supabase).
- `[x]` `GET /api/categories/[id]`: detalle.
- `[x]` `PATCH /api/categories/[id]`: actualizar categoria (mock + Supabase).
- `[x]` `DELETE /api/categories/[id]`: borrado logico (mock + Supabase).

## Inventario

- `[x]` `GET /api/inventory`: stock actual.
- `[x]` `GET /api/inventory?lowStock=true`: productos por debajo del minimo.
- `[x]` `GET /api/inventory/movements`: movimientos de stock.
- `[x]` `GET /api/inventory/movements?productId=`: movimientos por producto.
- `[x]` `POST /api/inventory/adjustments`: ajuste de stock (mock o Supabase).
- `[x]` `GET /api/inventory/stock-card?productId=`: kardex/tarjeta de stock.
- `[x]` Validar stock negativo en ajustes.
- `[x]` Conectar ajustes a RPC `adjust_stock`.
- `[x]` Soportar tipos de ajuste documentados: `ajuste_entrada`, `ajuste_salida`, `inventario_inicial`, devoluciones.
- `[x]` Servicio Supabase `inventory.server.ts` con `resolveDataSource`.

## Clientes Y Proveedores

- `[x]` `GET /api/contacts`: listado de contactos.
- `[x]` `GET /api/contacts?type=cliente|proveedor|ambos`: filtro por tipo.
- `[x]` `GET /api/contacts?search=`: busqueda.
- `[x]` `POST /api/contacts`: creacion simulada.
- `[x]` `GET /api/contacts/[id]`: detalle.
- `[x]` `PATCH /api/contacts/[id]`: actualizacion simulada.
- `[x]` `GET /api/contacts/[id]/activity`: actividad del contacto.
- `[x]` `GET /api/contacts/[id]/sales`: historial de ventas del cliente.
- `[x]` `GET /api/contacts/[id]/purchases`: historial de compras del proveedor.
- `[x]` `GET /api/contacts/[id]/payments`: pagos asociados.
- `[x]` Validar `tax_id` duplicado con `409`.
- `[x]` Agregar permiso separado `contacts.manage` para escrituras de contactos.
- `[x]` Servicios Supabase `contacts.server.ts` y `supplierProducts.server.ts`.
- `[x]` Handlers enrutan con `resolveDataSource()` (mock en tests, supabase en runtime).
- `[x]` Listados paginados (`skip`/`limit`) en contactos, anidados y relaciones proveedor-producto.
- `[x]` `POST/PATCH /api/supplier-products` valida proveedor con RPC `assert_contact_type`.

## Ventas

- `[x]` `GET /api/sales`: listado de ventas.
- `[x]` `GET /api/sales?status=`: filtro por estado.
- `[x]` `POST /api/sales`: creacion de venta.
- `[x]` `GET /api/sales/[id]`: detalle con items y pagos.
- `[x]` `PATCH /api/sales/[id]`: actualizar notas de venta.
- `[x]` Payload de creacion incluye cliente, items, descuento, impuesto y tasa.
- `[x]` `POST /api/sales` conectado a RPC `create_sale`.
- `[x]` Validar stock disponible antes de confirmar venta (RPC).
- `[x]` Copiar precio unitario y costo historico al momento de vender (RPC).
- `[x]` Reducir stock de forma atomica (RPC).
- `[x]` Crear movimientos `stock_movements` tipo `venta` (RPC).
- `[x]` `PATCH /api/sales/[id]/cancel`: cancelar venta.
- `[x]` `POST /api/sales/[id]/return`: devolucion de cliente.
- `[x]` `GET /api/sales/[id]/receipt`: datos para recibo/factura.
- `[x]` `GET /api/sales?from=&to=`: filtro por rango de fecha.
- `[x]` `GET /api/sales?customerId=`: filtro por cliente.
- `[x]` Servicio `sales.server.ts` con `resolveDataSource`.

## Proceso Completo De Venta

- `[x]` Listar productos para seleccion.
- `[x]` Filtrar productos por categoria y activo.
- `[x]` Listar clientes/contactos.
- `[x]` Consultar tasa actual en `/api/exchange-rates`.
- `[x]` Crear venta con RPC `create_sale` (Supabase) o mock.
- `[x]` Registrar pago con RPC `register_payment` (Supabase) o mock.
- `[~]` Soportar pagos combinados con multiples registros.
- `[~]` Actualizar estado automaticamente a `pagada` cuando `paid_ves >= total_ves` (RPC).
- `[x]` Mostrar saldo pendiente calculado en pagos/recibo.
- `[x]` Generar comprobante o payload de factura.

## Pagos

- `[x]` `GET /api/payments`: listado.
- `[x]` `GET /api/payments?direction=entrada|salida`: filtro por direccion.
- `[x]` `POST /api/payments`: creacion simulada.
- `[x]` `GET /api/payments/[id]`: detalle.
- `[x]` `PATCH /api/payments/[id]`: actualiza metadatos (notas, banco, telefono, referencia).
- `[~]` Payload valida que el pago pertenezca a venta o compra.
- `[x]` Conectar `POST /api/payments` a RPC `register_payment`.
- `[x]` Servicio `payments.server.ts` con listado, detalle, registro y patch.
- `[ ]` Validar requisitos por metodo:
  - `[x]` `pago_movil`: banco, telefono y referencia de 4 digitos.
  - `[x]` `transferencia`: banco y referencia.
  - `[x]` `efectivo_usd`: moneda USD y conversion a VES/ref.
  - `[x]` `punto_venta`: referencia opcional.
- `[x]` `GET /api/payments?saleId=`.
- `[x]` `GET /api/payments?purchaseId=`.
- `[x]` `GET /api/payments?contactId=`.
- `[x]` Calcular y devolver saldo pendiente por venta/compra.

## Compras

- `[x]` `GET /api/purchases`: listado.
- `[x]` `GET /api/purchases?status=`: filtro por estado.
- `[x]` `POST /api/purchases`: creacion con soporte mock y Supabase.
- `[x]` `GET /api/purchases/[id]`: detalle con items y pagos.
- `[x]` Payload de creacion incluye proveedor, items, costo, descuento, impuesto, tasa y `status`.
- `[x]` Conectar `POST /api/purchases` a RPC `create_purchase`.
- `[x]` Entrada de stock atomica al recibir mercancia (`receive_purchase`).
- `[x]` Actualizar costo actual del producto (via RPC).
- `[x]` Actualizar relacion proveedor-producto (via RPC).
- `[x]` `PATCH /api/purchases/[id]/receive`: recibir compra en pedido.
- `[x]` `PATCH /api/purchases/[id]/cancel`: cancelar compra.
- `[x]` `POST /api/purchases/[id]/return`: devolucion a proveedor.
- `[x]` `GET /api/purchases?from=&to=`: filtro por rango.
- `[x]` `GET /api/purchases?supplierId=`: filtro por proveedor.

## Proveedores Y Relacion Producto-Proveedor

- `[~]` Proveedores se manejan como `contacts` con `type=proveedor`.
- `[x]` `GET /api/supplier-products`: relaciones proveedor-producto.
- `[x]` `POST /api/supplier-products`: crear relacion (mock o Supabase `supplier_products`).
- `[x]` `PATCH /api/supplier-products/[id]`: actualizar ultimo costo/SKU proveedor.
- `[x]` `GET /api/suppliers/[id]/products`: productos por proveedor.
- `[x]` `GET /api/products/[id]/suppliers`: proveedores por producto.

## Tasa Ref/VES

- `[x]` `GET /api/exchange-rates`: listado mock.
- `[x]` `GET /api/exchange-rates`: listado Supabase (`exchange_rates` + paginacion).
- `[x]` `POST /api/exchange-rates`: crear tasa mock.
- `[x]` `POST /api/exchange-rates`: insert Supabase con `created_by` de sesion.
- `[x]` `GET /api/exchange-rates/current`: tasa vigente mock.
- `[x]` `GET /api/exchange-rates/current`: ultima tasa Supabase por `created_at`.
- `[x]` `GET /api/exchange-rates?from=&to=`: historial por rango.
- `[x]` Validar que la tasa sea mayor a cero.
- `[x]` Registrar usuario creador cuando exista auth real (`created_by` en Supabase).
- `[ ]` Bloquear modificacion de tasa en operaciones ya confirmadas.

## Reportes

- `[x]` `GET /api/reports/daily-sales`: ventas diarias mock.
- `[x]` `GET /api/reports/daily-sales`: Supabase vista `daily_sales_summary` con `from`/`to`.
- `[x]` `GET /api/reports/gross-profit`: ganancia bruta mock.
- `[x]` `GET /api/reports/gross-profit`: Supabase vista `gross_profit_summary` con `from`/`to`.
- `[x]` `GET /api/reports/product-profitability`: rentabilidad por producto mock.
- `[x]` `GET /api/reports/product-profitability`: Supabase vista `product_profitability`.
- `[x]` `GET /api/reports/low-stock`: productos con stock bajo.
- `[x]` `GET /api/reports/low-stock`: Supabase vista `low_stock_products`.
- `[x]` `GET /api/reports/customer-purchases`: resumen por cliente.
- `[x]` `GET /api/reports/customer-purchases`: Supabase vista `customer_purchase_summary`.
- `[x]` `GET /api/reports/supplier-purchases`: resumen por proveedor.
- `[x]` `GET /api/reports/supplier-purchases`: Supabase vista `supplier_purchase_summary`.
- `[x]` `GET /api/reports/stock-card?productId=`: kardex.
- `[x]` `GET /api/reports/stock-card`: Supabase vista `stock_card` con filtro `productId`.
- `[x]` `GET /api/reports/top-products?from=&to=`.
- `[x]` `GET /api/reports/top-products`: Supabase agrega `sale_items` por rango de ventas.
- `[x]` `GET /api/reports/top-customers?from=&to=`.
- `[x]` `GET /api/reports/top-customers`: Supabase agrega ventas por cliente en rango.
- `[x]` `GET /api/reports/purchases?from=&to=&supplierId=`.
- `[x]` `GET /api/reports/purchases`: Supabase lista `purchases` con filtros y paginacion.
- `[~]` Filtros globales `from`, `to`, `groupBy` (parcial: por endpoint, sin `groupBy`).
- `[ ]` Exportacion PDF/Excel en fase posterior.

## Configuracion Y Usuarios

- `[x]` `GET /api/users`: listar perfiles mock.
- `[x]` `GET /api/users`: listar `profiles` Supabase + emails Auth admin.
- `[x]` `PATCH /api/users/[id]`: actualizar rol/estado mock.
- `[x]` `PATCH /api/users/[id]`: actualizar `profiles` Supabase (rol, permisos jsonb).
- `[x]` `GET /api/settings`: configuracion general mock.
- `[x]` `GET /api/settings`: leer singleton `app_settings` Supabase.
- `[x]` `PATCH /api/settings`: actualizar configuracion mock.
- `[x]` `PATCH /api/settings`: actualizar `app_settings` Supabase (admin RLS).
- `[x]` `requirePermission` soporta sesion Supabase y fallback demo (`ALLOW_DEMO_AUTH`).
- `[x]` Cargar `profiles.role` y `profiles.is_active` desde Supabase en permisos API.

## Autenticacion

- `[x]` Login UI usa BFF `POST /api/auth/login` (`useLogin` → `loginWithPassword`).
- `[x]` `POST /api/auth/login`: login Supabase server-side con cookies de sesion.
- `[x]` `POST /api/auth/logout`: logout Supabase.
- `[x]` `GET /api/auth/me`: usuario actual y permisos desde sesion o demo headers.
- `[x]` Cookies/sesion para Route Handlers (`createRouteSupabaseClient`).
- `[x]` Proteccion de endpoints via `requirePermission` + RLS en Supabase.

## Documentacion Y Contrato

- `[x]` `GET /api/docs`: redirige a `/api-docs`.
- `[x]` `/api-docs`: Swagger UI.
- `[x]` `/openapi.yml`: contrato OpenAPI publico.
- `[x]` `docs/mock-api-endpoints.md`: documentacion humana de endpoints mock.
- `[x]` `docs/backend-api-agent-guide.md`: guia operativa para agentes/desarrolladores backend.
- `[x]` OpenAPI cubre endpoints actuales y `src/app/api/api-contract.test.ts` valida handlers contra contrato.
- `[x]` `GET /api/openapi`: sirve contrato YAML desde `public/openapi.yml`.
- `[~]` Agregar CI/check dedicado para validar OpenAPI en pipeline externo; por ahora existe guard Jest local.

## Testing

- `[x]` Tests unitarios para endpoints principales de productos, ventas, compras, contactos, pagos, inventario, reportes y dashboard.
- `[x]` `npm test -- api` disponible.
- `[x]` Tests para todos los endpoints existentes y guard para exigir `route.test.ts` junto a cada `route.ts`.
- `[x]` Tests de contratos OpenAPI contra handlers con `src/app/api/api-contract.test.ts`.
- `[x]` Guard de tests para hooks cliente que consuman `/api` con `src/shared/api/client-hooks-contract.test.ts`.
- `[x]` Script de smoke manual: `scripts/smoke-api.ts` (requiere dev server + credenciales opcionales).
- `[x]` Suite E2E backend manual: `npm run e2e:bodegon` (ver [`backend-e2e-bodegon.md`](backend-e2e-bodegon.md)).

## Prioridad Recomendada

1. `[x]` Crear endpoints de categorias.
2. `[x]` Crear `GET /api/exchange-rates/current`.
3. `[x]` Completar reportes faltantes: clientes, proveedores y kardex.
4. `[x]` Agregar filtros por fecha/cliente/proveedor en ventas y compras.
5. `[x]` Completar validaciones de pagos por metodo.
6. `[x]` Implementar relaciones proveedor-producto.
7. `[x]` Migrar servicios mock a Supabase server-side; todos los modulos operativos tienen `.server.ts`.
8. `[x]` Conectar RPC reales para venta, compra, pago y ajuste de stock.
