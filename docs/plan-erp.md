# Plan de Desarrollo: Aplicación Web ERP (Powered by Supabase)

Este documento detalla la **vision y requisitos funcionales** del ERP. Para implementacion actual (rutas, hooks, endpoints, tablas) use [`modules-catalog.md`](modules-catalog.md).

## 0. Estado de implementacion (mayo 2026)

| Area | Estado | Referencia |
|------|--------|------------|
| Auth BFF + permisos | Implementado | [`auth-permissions.md`](auth-permissions.md) |
| API BFF + Supabase | Implementado | [`api-endpoints-checklist.md`](api-endpoints-checklist.md) |
| UI modulos operativos | Implementado | [`frontend-integration-checklist.md`](frontend-integration-checklist.md) |
| Schema + RPC | Implementado | [`supabase/supabase-schema.sql`](../supabase/supabase-schema.sql) |
| Import Excel productos | Implementado | [`frontend-product-bulk-import.md`](frontend-product-bulk-import.md) |
| E2E manual bodegon | Implementado | [`backend-e2e-bodegon.md`](backend-e2e-bodegon.md) |
| Anular pago | No implementado | Sin endpoint |
| Export PDF/Excel reportes | No implementado | UI disabled |
| Imagen producto (storage) | Parcial (campo BD) | Sin UI |
| Middleware rutas privadas | No implementado | Guard por pagina |
| Venta borrador | No implementado | `create_sale` → `pendiente_pago` |

## 1. Vision General

La aplicacion sera una plataforma centralizada para controlar operaciones comerciales y de inventario. El precio base de los productos se manejara en `ref`, y cada factura calculara su equivalente en VES usando la tasa VES/ref vigente al momento de la operacion.

Ejemplo de facturacion:

```text
producto A = ref 15
producto B = ref 7
tasa actual = 510 VES por ref

total_ref = 15 + 7 = 22
total_ves = 22 * 510 = 11220 VES
```

La tasa usada debe quedar guardada en la venta o compra como snapshot historico. Asi, una factura antigua no cambia si manana cambia el valor del `ref`.

## 2. Objetivos Funcionales

### Gestion de Productos e Inventario

*   CRUD de productos, categorias, SKU, imagen, stock minimo y estado activo/inactivo.
*   Precio de venta actual en `ref`.
*   Costo actual referencial en `ref`.
*   Control de stock actual para consultas rapidas.
*   Historial auditable de movimientos de stock: ventas, compras, ajustes, devoluciones e inventario inicial.
*   Alertas de stock bajo y filtros por categoria, estado y disponibilidad.

### Gestion de Precios y Ref

*   Registro manual de la tasa VES/ref del dia o del momento de facturar.
*   Historial de tasas para auditoria.
*   Historial de cambios de precio de venta por producto.
*   Calculo automatico de totales en `ref` y VES.
*   Bloqueo de modificacion de tasa en operaciones confirmadas.

### Gestion de Ventas

*   Creacion de facturas o recibos con cliente, vendedor, tasa `ref`, productos, cantidades y forma de pago.
*   Copia del precio unitario en `ref` al momento de facturar.
*   Calculo de `subtotal_ref`, `total_ref` y `total_ves`.
*   Descuento e impuestos expresados en `ref`.
*   Registro de pagos parciales o totales, con soporte para multiples pagos sobre una misma venta.
*   Soporte para pagos combinados, por ejemplo una parte en efectivo USD y otra por Pago Movil.
*   Estados: borrador, pendiente de pago, pagada, cancelada y devuelta.
*   Reduccion atomica de stock al confirmar la venta.
*   Historial de pagos, saldo pendiente y cambio de estado automatico al completar el pago.

### Gestion de Compras y Proveedores

*   Registro de proveedores con datos basicos: nombre, RIF/cedula, telefono, direccion, email y notas.
*   Registro de compras por proveedor, producto, cantidad y costo.
*   Costos de compra en `ref` y VES.
*   Relacion proveedor-producto con ultimo costo conocido.
*   Entrada atomica de stock al recibir mercancia.
*   Historial de costos por proveedor y producto.
*   Estados: pedido, recibido, cancelado y devuelto.

### Gestion de Clientes

*   Registro de clientes con nombre, identificacion, direccion, telefono, email y notas.
*   Historial de compras por cliente.
*   Total comprado en `ref` y VES.
*   Ultima compra, cantidad de facturas y saldo pendiente.
*   Filtros por periodo, monto comprado y estado de deuda.

### Pagos y Cuentas

*   Pagos de entrada asociados a ventas.
*   Pagos de salida asociados a compras.
*   Soporte para pagos parciales: una venta o compra puede tener varios abonos.
*   Metodos de pago: Efectivo BS (VES), Efectivo USD, Pago Movil, Punto de Venta y Transferencia.
*   En todos los metodos se guarda el monto original pagado y su equivalente en VES/ref.
*   Pago Movil requiere referencia de 4 digitos, banco y telefono.
*   Transferencia requiere banco y numero de transferencia.
*   Punto de Venta puede guardar referencia opcional.
*   Calculo de saldo pendiente por venta, compra y contacto.

### Dashboard y Reportes

*   Ventas por dia, semana, mes y rango personalizado.
*   Compras por periodo y proveedor.
*   Ganancia bruta por periodo: ventas menos costo historico.
*   Rentabilidad por producto.
*   Productos mas vendidos.
*   Clientes con mayor compra acumulada.
*   Proveedores con mayor volumen comprado.
*   Kardex o tarjeta de stock por producto.
*   Exportacion de reportes a PDF/Excel en fases posteriores.

## 3. Stack Tecnologico Sugerido

*   **Frontend:** Next.js con App Router.
*   **Estilos:** Tailwind CSS + Shadcn/UI.
*   **Backend:** Supabase.
    *   **Auth:** usuarios, sesiones y roles.
    *   **Database:** PostgreSQL para datos relacionales.
    *   **RLS:** seguridad por rol y permisos.
    *   **RPC:** funciones transaccionales para ventas, compras, pagos y stock.
    *   **Storage:** imagenes de productos, facturas PDF y comprobantes.
    *   **Realtime:** actualizaciones de inventario, ventas recientes y alertas.
    *   **Edge Functions:** integraciones externas, generacion de documentos o tareas programadas.
*   **Cliente DB:** Supabase JS.
*   **Consultas y cache:** TanStack Query para consultas, mutaciones, cache, refetch e invalidacion.
*   **Validacion:** Zod o validador equivalente compartido entre formularios y acciones.
*   **Fechas:** moment para formateo, parseo y manejo de rangos de fecha.
*   **Graficos:** Recharts, Tremor o una libreria compatible con React.
*   **Laboratorio visual:** Storybook para probar componentes centralizados, variantes y estados visuales.
*   **Testing:** Jest + React Testing Library para comportamiento de componentes, formularios, helpers y servicios puros.
*   **Mocks:** MSW opcional para simular respuestas remotas en Storybook y tests sin tocar Supabase real.

## 4. Modulos de la Aplicacion

### 4.1 Autenticacion y Roles

*   Login con Supabase Auth.
*   Tabla `profiles` vinculada a `auth.users`.
*   Roles iniciales: admin, vendedor, almacen y contador.
*   Proteccion de rutas en frontend.
*   Politicas RLS en Supabase.

### 4.2 Inventario

*   Listado de productos con filtros del lado del servidor.
*   Formulario de producto: SKU, nombre, categoria, precio `ref`, costo referencial, stock minimo e imagen.
*   Vista de stock actual.
*   Historial de movimientos por producto.
*   Ajustes manuales de stock mediante RPC auditada.

### 4.3 Ref y Precios

*   Pantalla para registrar tasa VES/ref.
*   Historial de tasas.
*   Cambio de precio por producto con motivo.
*   Consulta de historial de precios.
*   Uso obligatorio de la ultima tasa o una tasa seleccionada al crear ventas/compras.

### 4.4 Clientes y Proveedores

*   CRUD de contactos.
*   Contactos marcados como cliente, proveedor o ambos.
*   Historial de ventas para clientes.
*   Historial de compras para proveedores.
*   Relacion proveedor-producto y ultimo costo conocido.

### 4.5 Ventas

*   Busqueda o creacion rapida de cliente.
*   Seleccion de tasa `ref` vigente antes de facturar.
*   Selector de productos con precio en `ref`, costo referencial y stock disponible.
*   Carrito de venta con cantidades, precio unitario, subtotal en `ref`, subtotal en VES y margen estimado.
*   Calculo en vivo de subtotal, descuento, impuesto, total `ref` y total VES.
*   Validacion de stock antes de confirmar.
*   Confirmacion de venta mediante RPC `create_sale`.
*   Reduccion atomica de stock y creacion de movimientos tipo `venta`.
*   Generacion de recibo/factura con tasa usada, total `ref`, total VES, pagos aplicados y saldo.
*   Registro de pagos parciales o totales mediante RPC `register_payment`.
*   Soporte para multiples pagos por venta y pagos combinados.
*   Cancelaciones y devoluciones controladas por rol.
*   Historial de pagos y movimientos asociados a cada factura.

### 4.6 Compras

*   Busqueda de proveedor.
*   Registro de productos comprados, cantidad y costo.
*   Calculo de costo total en `ref` y VES.
*   Confirmacion mediante RPC `create_purchase`.
*   Entrada de stock al recibir mercancia.
*   Actualizacion del ultimo costo por proveedor-producto.

### 4.7 Pagos

*   Registro de pago de cliente sobre una venta.
*   Registro de pago a proveedor sobre una compra.
*   Pagos parciales en ventas y compras.
*   Metodos: Efectivo BS (VES), Efectivo USD, Pago Movil, Punto de Venta y Transferencia.
*   Captura de datos obligatorios segun metodo de pago.
*   Conversion automatica de efectivo USD a VES usando la tasa `ref_rate_ves` de la operacion.
*   Acumulacion de pagos en `paid_ves`.
*   Cambio automatico del estado de venta a `pagada` cuando `paid_ves >= total_ves`.
*   Resumen de saldo pendiente por venta, compra y contacto.

### 4.8 Dashboard y Analitica

*   Filtros globales por rango de fecha.
*   Tarjetas: ventas del periodo, compras del periodo, ganancia bruta, ticket promedio y stock bajo.
*   Graficos por dia/semana/mes.
*   Ranking de productos, clientes y proveedores.
*   Vistas PostgreSQL para calculos pesados.

### 4.9 Capa de Consultas

*   Las consultas a Supabase y llamadas RPC deben vivir en archivos `services`, no dentro de componentes.
*   Los componentes deben consumir datos mediante hooks basados en TanStack Query.
*   Cada pagina puede tener sus propios `services` y `hooks` si son privados de esa pagina.
*   Si una consulta se comparte entre paginas del mismo modulo, debe moverse al nivel del modulo.
*   Si una consulta se comparte entre varios modulos, debe moverse a `shared/services` y `shared/hooks`.
*   Los `queryKey` deben ser descriptivos e incluir filtros, ids y rangos de fecha.
*   Las mutaciones deben invalidar las queries relacionadas despues de completarse correctamente.
*   Las fechas de filtros y reportes deben manejarse con moment antes de llamar a los servicios.

### 4.10 Storybook y Testing

*   Storybook debe usarse como interfaz de pruebas visuales para componentes reutilizables.
*   Todo componente compartido importante debe tener una story con sus variantes principales.
*   Componentes base como `Button`, `Input`, `Select`, `Modal`, `DataTable`, `StatusBadge`, `CurrencyValue` y `RefValue` deben probarse visualmente en Storybook.
*   Componentes de negocio criticos como campos de metodo de pago, totales de venta, carrito de venta y estados de venta deben tener stories.
*   Jest + React Testing Library deben validar comportamiento, interacciones y validaciones.
*   Las pruebas deben enfocarse en comportamiento visible para el usuario, no en detalles internos.
*   MSW puede usarse para simular Supabase/TanStack Query en stories y tests.
*   Las stories y tests no deben depender de una base Supabase real.

## 5. Proceso Completo de Venta

### 5.1 Inicio de Venta

*   El vendedor inicia una venta desde el modulo de ventas.
*   El sistema carga la tasa `ref` vigente desde `exchange_rates`.
*   El vendedor puede seleccionar un cliente existente o crear uno nuevo si el rol lo permite.
*   La venta puede iniciar como `borrador` en la interfaz, pero solo debe afectar stock al confirmarse.

### 5.2 Seleccion de Productos

*   El vendedor busca productos por nombre, SKU o categoria.
*   Cada producto debe mostrar precio actual en `ref`, equivalente en VES, stock disponible y alerta si esta bajo minimo.
*   Al agregar un producto, el sistema copia el precio actual `products.sale_price_ref` al item de venta.
*   El usuario define la cantidad y el sistema valida que no exceda el stock disponible.
*   El costo historico usado para margen se copia desde `products.current_cost_ref` hacia `sale_items.unit_cost_ref_snapshot`.

### 5.3 Calculo de Totales

*   Cada linea calcula `subtotal_ref = quantity * unit_price_ref`.
*   Cada linea calcula `subtotal_ves = subtotal_ref * ref_rate_ves`.
*   La cabecera calcula `subtotal_ref`, `discount_ref`, `tax_ref`, `total_ref` y `total_ves`.
*   La tasa `ref_rate_ves` queda guardada en la venta y no debe cambiar despues de confirmar.
*   La interfaz debe mostrar siempre ambos valores: total en `ref` y total en VES.

### 5.4 Confirmacion de Venta

*   Al confirmar, el frontend debe llamar la RPC `create_sale`.
*   `create_sale` debe validar stock disponible, crear `sales`, crear `sale_items`, calcular totales y descontar inventario.
*   Por cada producto vendido se crea un registro en `stock_movements` con tipo `venta`.
*   La venta queda inicialmente como `pendiente_pago` si no se registra pago completo.
*   Si la venta se confirma sin pago inmediato, queda una cuenta por cobrar asociada al cliente.

### 5.5 Registro de Pago de Venta

*   Los pagos se registran con la RPC `register_payment`.
*   Una venta puede tener un solo pago total o multiples pagos parciales.
*   Una venta puede pagarse con metodos combinados, registrando un pago por cada metodo.
*   Cada pago guarda `amount` como monto original, `currency`, `amount_ves`, `amount_ref`, `method`, datos bancarios si aplican y usuario que registro el pago.
*   El sistema suma cada pago a `sales.paid_ves`.
*   El saldo pendiente se calcula como `sales.total_ves - sales.paid_ves`.

### 5.6 Metodos de Pago en Ventas

*   **Efectivo BS (VES):** el monto se registra en bolivares; `currency = VES`; `amount_ves = amount`.
*   **Efectivo USD:** el monto se registra en dolares/ref; `currency = USD`; `amount_ves = amount * ref_rate_ves`; `amount_ref = amount`.
*   **Pago Movil:** requiere monto, banco, telefono y referencia de 4 digitos; `currency = VES`.
*   **Punto de Venta:** requiere monto; puede guardar referencia/comprobante opcional; `currency = VES`.
*   **Transferencia:** requiere monto, banco y numero de transferencia; `currency = VES`.

### 5.7 Estados de Venta

*   `borrador`: venta en preparacion en la interfaz; no afecta stock.
*   `pendiente_pago`: venta confirmada con saldo pendiente.
*   `pagada`: venta cuyo `paid_ves` es mayor o igual a `total_ves`.
*   `cancelada`: venta anulada por rol autorizado; debe revertir stock si ya fue confirmada.
*   `devuelta`: venta con devolucion parcial o total; debe generar movimientos inversos.

### 5.8 Factura o Recibo

*   El recibo debe mostrar cliente, vendedor, fecha, numero de factura, tasa `ref`, productos, cantidades, precio unitario en `ref`, subtotal en `ref`, total en VES y saldo.
*   Debe listar los pagos aplicados con metodo, monto, moneda, referencia y datos bancarios cuando correspondan.
*   La factura debe conservar los valores historicos aunque cambien precios o tasa despues.

### 5.9 Validaciones Criticas en Venta

*   No confirmar ventas sin tasa `ref_rate_ves` valida.
*   No confirmar ventas con productos inactivos.
*   No permitir cantidades menores o iguales a cero.
*   No permitir vender mas del stock disponible, salvo decision explicita del negocio.
*   No permitir pagos con monto menor o igual a cero.
*   No aceptar Pago Movil sin banco, telefono y referencia de 4 digitos.
*   No aceptar Transferencia sin banco y numero de transferencia.
*   No recalcular ventas historicas con tasas nuevas.

## 6. Fases de Implementacion

### Fase 1: Base Tecnica y Seguridad

*   Crear proyecto Supabase.
*   Configurar Next.js, Tailwind, Shadcn/UI y Supabase JS.
*   Crear tablas base: `profiles`, `categories`, `products`, `contacts`, `exchange_rates`.
*   Crear enums y migraciones SQL.
*   Configurar Auth y RLS inicial.
*   Implementar layout privado tipo dashboard.

### Fase 2: Modelo Comercial y Monetario

*   Implementar historial de tasas `exchange_rates`.
*   Implementar historial de precios `product_price_history`.
*   Crear funciones RPC para cambiar precio y registrar tasa.
*   Definir helpers de calculo `ref -> VES`.
*   Crear pruebas basicas de calculos monetarios.

### Fase 3: Inventario y Contactos

*   CRUD de productos y categorias.
*   CRUD de clientes/proveedores.
*   Crear `supplier_products`.
*   Crear `stock_movements`.
*   Implementar RPC `adjust_stock`.
*   Crear vista de stock bajo y kardex por producto.

### Fase 4: Ventas

*   Crear tablas `sales` y `sale_items`.
*   Implementar RPC `create_sale` para transaccion atomica.
*   Reducir stock al confirmar ventas.
*   Guardar snapshot de tasa y precio unitario.
*   Calcular ganancia bruta usando costo historico.
*   Crear pantalla de facturacion con carrito, totales en `ref`/VES y validacion de stock.
*   Integrar registro de pago inicial opcional despues de crear la venta.
*   Permitir que una venta quede pendiente si no se paga completa.
*   Mostrar saldo pendiente y pagos aplicados en el detalle de venta.
*   Crear recibo/factura imprimible con desglose de productos, tasa y pagos.

### Fase 5: Compras

*   Crear tablas `purchases` y `purchase_items`.
*   Implementar RPC `create_purchase`.
*   Aumentar stock al recibir mercancia.
*   Actualizar costo actual del producto y ultimo costo proveedor-producto.
*   Crear pantalla de orden/factura de compra.

### Fase 6: Pagos y Saldos

*   Crear tabla `payments`.
*   Implementar RPC `register_payment`.
*   Actualizar saldos pagados en ventas y compras.
*   Validar campos por metodo: pago movil, transferencia, efectivo y punto de venta.
*   Crear pantallas para pagos recibidos y pagos emitidos.
*   Crear resumen de deuda por cliente/proveedor.

### Fase 7: Dashboard y Reportes

*   Crear vistas: ventas diarias, ganancia bruta, rentabilidad por producto, resumen por cliente, resumen por proveedor y stock bajo.
*   Implementar filtros por rango de fecha.
*   Crear graficos interactivos.
*   Agregar exportacion PDF/Excel si es requerida.

### Fase 8: Pulido, Pruebas y Despliegue

*   Pruebas de RLS por rol.
*   Pruebas de funciones RPC con casos de stock insuficiente, cancelaciones y pagos parciales.
*   Optimizacion de indices.
*   Revision de UX responsive.
*   Despliegue en Vercel.
*   Configuracion de backups y monitoreo basico de Supabase.

## 7. Reglas Criticas del Negocio

*   Una venta confirmada debe guardar `ref_rate_ves`, `total_ref` y `total_ves`.
*   Una compra confirmada debe guardar `ref_rate_ves`, `total_ref` y `total_ves`.
*   No se debe recalcular una factura historica con una tasa nueva.
*   Los movimientos de stock deben generarse desde funciones controladas, no desde escrituras libres del frontend.
*   El stock no debe quedar negativo salvo que el negocio decida permitirlo explicitamente.
*   Los precios actuales del producto pueden cambiar, pero las lineas de venta deben conservar el precio usado al momento de facturar.
*   La ganancia debe calcularse con el costo historico de la venta, no solamente con el costo actual del producto.
*   Cancelaciones y devoluciones deben crear movimientos inversos y quedar auditadas.
*   Cada pago parcial debe quedar registrado individualmente en `payments`.
*   Una venta pasa a `pagada` solo cuando `paid_ves >= total_ves`.
*   El saldo pendiente de una venta se calcula desde los pagos registrados, no se introduce manualmente.
*   Los datos requeridos por metodo de pago deben validarse antes de registrar el pago.

## 8. Diseño Visual y UX

*   Interfaz tipo dashboard con barra lateral.
*   Modulos principales: Inicio, Ventas, Compras, Inventario, Productos, Contactos, Pagos, Reportes, Configuracion.
*   Tablas con paginacion, busqueda y filtros del lado del servidor.
*   Formularios con calculo en vivo de `ref` y VES.
*   Indicadores visibles para tasa actual, stock bajo y saldos pendientes.
*   En la pantalla de venta, mostrar resumen fijo con total `ref`, total VES, total pagado y saldo pendiente.
*   El formulario de pago debe cambiar sus campos segun el metodo seleccionado.
*   Vista responsive y modo claro/oscuro.

## 9. Orden Recomendado para el MVP

1.  Auth, roles y layout.
2.  Productos, categorias y tasa `ref`.
3.  Clientes/proveedores.
4.  Inventario y movimientos.
5.  Ventas con calculo `ref -> VES`.
6.  Compras con costos por proveedor.
7.  Pagos y saldos.
8.  Dashboard de ventas, ganancias y stock.
