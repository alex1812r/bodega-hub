# Auditoria Del Schema SQL

Estado de [`supabase/supabase-schema.sql`](../supabase/supabase-schema.sql) frente a la app (`/api`, permisos y flujos). Ultima revision: julio 2026.

**Catálogo módulos ↔ RPC:** [`modules-catalog.md`](modules-catalog.md)

## Veredicto

| Criterio | Estado |
| --- | --- |
| Listo para crear proyecto Supabase y ejecutar el SQL | **Si** |
| Listo para data real sin ajustes en la app | **Parcial** (UUID, auth, servicios `.server.ts`) |
| Alineacion enums/roles con la app | **Si** |
| Inventario transaccional documentado en SQL | **Si** (mejorado en esta revision) |
| Paridad total API mock vs SQL | **~85%** |

## Alineacion Con La App

### Enums y roles

| Dominio | App / API | SQL | Estado |
| --- | --- | --- | --- |
| Roles | `admin`, `vendedor`, `almacen`, `contador` | `user_role` | OK |
| Contactos | `cliente`, `proveedor`, `ambos` | `contact_type` | OK |
| Ventas | `borrador`, `pendiente_pago`, `pagada`, `cancelada`, `devuelta` | `sale_status` | OK |
| Compras | `pedido`, `recibido`, `cancelado`, `devuelto` | `purchase_status` | OK |
| Pagos | metodos y `entrada`/`salida` | `payment_method`, `payment_direction`, `payment_currency` | OK |
| Inventario | 7 tipos de movimiento | `stock_movement_type` | OK |

### Tablas

| Tabla | En app/API | En SQL | Notas |
| --- | --- | --- | --- |
| `profiles` | Si | Si | Ahora incluye `granted_permissions` / `denied_permissions` (jsonb) |
| `app_settings` | Si (`/api/settings`) | Si | **Agregada** (singleton `id = 1`) |
| `categories` | Si | Si | **Agregado** `is_active` + indice unico parcial por nombre activo |
| `products` | Si | Si | **Agregado** `check (current_stock >= 0)` |
| `exchange_rates` | Si | Si | OK |
| `product_price_history` | Si | Si | OK |
| `contacts` | Si | Si | OK |
| `supplier_products` | Si | Si | OK |
| `supplier_product_price_history` | Si | Si | OK (§3.8.1; historial cotizaciones/compras/vinculacion) |
| `sales` / `sale_items` | Si | Si | OK |
| `purchases` / `purchase_items` | Si | Si | OK |
| `payments` | Si | Si | OK |
| `stock_movements` | Si | Si | OK |

### RPC / funciones de negocio

| Operacion | API mock | SQL RPC | Estado |
| --- | --- | --- | --- |
| Cambiar precio | `POST .../price` | `update_product_price` | OK |
| Ajuste stock | `POST /api/inventory/adjustments` | `adjust_stock` (+ tipo opcional) | OK |
| Crear venta | `POST /api/sales` | `create_sale` | OK |
| Crear compra | `POST /api/purchases` | `create_purchase` (+ `p_status`) | OK |
| Recibir compra pedido | `PATCH /api/purchases/[id]/receive` | `receive_purchase` | OK |
| Registrar pago | `POST /api/payments` | `register_payment` | OK |
| Cancelar venta | `PATCH .../cancel` | `cancel_sale` | **Nuevo en SQL** |
| Devolver venta | `POST .../return` | `return_sale` | **Nuevo en SQL** |
| Cancelar compra | `PATCH .../cancel` | `cancel_purchase` | **Nuevo en SQL** |
| Devolver compra | `POST .../return` | `return_purchase` | **Nuevo en SQL** |
| Registrar precio proveedor-producto | `POST /api/supplier-products/[id]/prices` | `register_supplier_product_price` | OK |
| Desvincular proveedor-producto | `PATCH /api/supplier-products/[id]/deactivate` | `deactivate_supplier_product` | OK |

### Vistas de reportes

| Reporte API | Vista SQL |
| --- | --- |
| `daily-sales` | `daily_sales_summary` |
| `gross-profit` | `gross_profit_summary` |
| `product-profitability` | `product_profitability` |
| `customer-purchases` | `customer_purchase_summary` |
| `supplier-purchases` | `supplier_purchase_summary` |
| `low-stock` | `low_stock_products` |
| `stock-card` | `stock_card` |

Grants `SELECT` sobre vistas: **agregados** en esta revision.

## Inventario: reglas de negocio en SQL

```text
create_purchase (recibido)  -> stock + movimiento compra + costo + supplier_products
create_purchase (pedido)    -> solo documento; sin stock
receive_purchase            -> aplica stock pendiente de pedido
create_sale                 -> descuenta stock + movimiento venta
cancel_sale / return_sale   -> repone stock (con movimiento auditable)
cancel_purchase / return_purchase (si recibido) -> revierte stock
adjust_stock                -> ajustes manuales / inventario inicial / devoluciones sueltas
```

No se debe duplicar entrada de mercancia con ajuste manual si la compra ya fue `recibido`.

## Seguridad (RLS)

- RLS habilitado en tablas de negocio.
- Inserts criticos en `sales`, `purchases`, `payments`, `stock_movements` **sin politica INSERT** → el cliente anon/authenticated no inserta directo; solo RPC `security definer`.
- Lecturas amplias (`using (true)`) para usuarios autenticados en la mayoria de tablas; la restriccion fina por permiso (`sales.view`, etc.) queda en la capa `/api` con `profiles` + permisos efectivos.
- `app_settings`: lectura autenticados, escritura solo `admin`.

### Matriz rol SQL vs permisos app

Los RPC validan **rol** (`current_user_role`), no el string `contacts.manage`. La app puede conceder permisos extra via `granted_permissions`; en Supabase eso debe leerse en Route Handlers y/o evolucionar RLS con funcion `has_permission(text)`.

| Rol SQL | RPC principales |
| --- | --- |
| `admin` | Todas (via rol + RLS admin) |
| `vendedor` | `create_sale`, pagos de venta, cancel/return venta |
| `almacen` | `create_purchase`, `receive_purchase`, `adjust_stock`, precios, cancel/return compra |
| `contador` | `register_payment` compras, tasas, lectura amplia |

## Debilidades restantes (antes de data real)

1. **Permisos granulares en RLS**  
   `granted_permissions` / `denied_permissions` estan en `profiles`, pero RLS no los usa aun. La app debe seguir validando en `/api` hasta agregar `has_permission()`.

2. **Contactos: update**  
   RLS permite update a `admin` y `contador`; la app usa `contacts.manage` (solo admin por rol base). Alinear politica si vendedores con grant deben editar.

3. **Storage de imagenes**  
   `products.image_url` existe; falta bucket/politicas Storage (fase posterior).

4. **Seed de datos**  
   El SQL solo inserta fila base en `app_settings`. Productos, contactos y tasas requieren script de seed aparte.

5. **Migracion desde mock string IDs**  
   Los mocks usan ids tipo `prod-drill`; Supabase generara UUID. El seed debe ser nuevo, no copiar ids mock.

6. **API expone** `receive_purchase`, `cancel_sale`, `return_sale`, `cancel_purchase`, `return_purchase` vía handlers que llaman RPC en modo Supabase.

7. **`borrador` en ventas**  
   El enum existe; `create_sale` siempre crea `pendiente_pago`. Flujo borrador es fase posterior.

8. **Proyecto existente**  
   Si ya ejecutaste una version anterior del SQL, necesitas migracion incremental (columnas nuevas, no re-ejecutar `begin` completo sobre tablas con data).

## Puntos fuertes

- Schema transaccional coherente con el ERP (ref + VES, snapshots de costo, kardex).
- Checks de pagos por metodo en tabla y RPC.
- FKs e indices utiles para listados y reportes.
- Trigger `handle_new_user` para `profiles`.
- Vistas listas para reportes sin duplicar logica en Node.
- Compras `pedido` vs `recibido` soportadas en SQL.
- Cancelaciones/devoluciones con reverso de stock cuando aplica.

## Checklist de ejecucion en Supabase

1. Crear proyecto Supabase (dev/staging).
2. Ejecutar `supabase/supabase-schema.sql` completo en SQL Editor (proyecto vacio).
3. Crear usuario admin en Auth y ejecutar:

```sql
insert into public.profiles (id, full_name, role)
values ('USER_UUID', 'Administrador', 'admin');
```

4. Configurar `.env` con URL, anon key y service role (solo servidor).
5. Implementar `src/lib/supabase/server-client.ts`.
6. Conectar lecturas simples (`products`, `categories`, `exchange_rates`).
7. Conectar RPC en orden: `create_purchase` → `create_sale` → `register_payment` → `adjust_stock`.

## Cambios aplicados en esta revision

- Tabla `app_settings`.
- `profiles.granted_permissions` / `profiles.denied_permissions`.
- `categories.is_active` + indice unico parcial.
- `products.current_stock >= 0`.
- Indices `payments(sale_id)`, `payments(purchase_id)`.
- `assert_contact_type` helper.
- `create_purchase(p_status)` con stock condicional.
- `receive_purchase`, `cancel_sale`, `return_sale`, `cancel_purchase`, `return_purchase`.
- `adjust_stock` con tipo de movimiento opcional.
- Grants en vistas y nuevas RPC.
- RLS y seed de `app_settings`.
