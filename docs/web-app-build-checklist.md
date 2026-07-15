# Checklist de Creacion de la Aplicacion Web ERP

> **Estado julio 2026:** el MVP de este plan **ya está implementado** (App Router, módulos, BFF `/api`, Supabase, Storybook, tests). Use como referencia del plan original; para el estado **actual** del producto consulte [`modules-catalog.md`](modules-catalog.md) y [`frontend-integration-checklist.md`](frontend-integration-checklist.md).

Este archivo es el plan operativo histórico para construir la aplicacion web punto a punto. Debe usarse junto con:

*   [`plan-erp.md`](plan-erp.md)
*   [`database-design.md`](database-design.md)
*   [`supabase/supabase-schema.sql`](../supabase/supabase-schema.sql)
*   [`.cursor/skills/screaming-page-architecture/SKILL.md`](../.cursor/skills/screaming-page-architecture/SKILL.md)

La aplicacion usa Next.js, Supabase, Tailwind CSS, Shadcn/UI, TanStack Query y arquitectura screaming con carpetas de pagina dentro de cada modulo.

## 0. Reglas Base del Proyecto

*   [x] Usar arquitectura screaming por dominio: `sales`, `purchases`, `inventory`, `products`, `contacts`, `payments`, `reports`, `auth`, `settings`.
*   [x] No crear `modules/<module>/pages`.
*   [x] Crear cada pantalla como carpeta directa dentro del modulo: `sales/sales-list`, `sales/sale-create`, `sales/sale-details`.
*   [x] Mantener componentes y hooks privados dentro de la carpeta de su pagina.
*   [x] Mover codigo a nivel de modulo solo si se comparte entre paginas del mismo modulo.
*   [x] Mover codigo a `shared` solo si se comparte entre modulos.
*   [x] Usar `ref` como unidad base de precios.
*   [x] Guardar tasa historica `ref_rate_ves` en ventas y compras.
*   [x] Usar RPC para operaciones atomicas: ventas, compras, pagos y stock.
*   [x] No escribir directamente desde frontend en tablas transaccionales como `sale_items`, `purchase_items`, `stock_movements` o `payments`.
*   [x] Usar TanStack Query para consultas, cache, refetch y mutaciones.
*   [x] Separar funciones de consulta/mutacion en `services` para mantener componentes simples.
*   [ ] Usar hooks por pagina o modulo para conectar componentes con TanStack Query.
*   [ ] Usar moment para formateo, parseo y manejo de fechas.

## 1. Setup Inicial del Proyecto

### 1.1 Crear Proyecto Web

*   [ ] Crear app con Next.js App Router.
*   [ ] Configurar TypeScript.
*   [ ] Configurar Tailwind CSS.
*   [ ] Configurar Shadcn/UI.
*   [ ] Configurar alias de imports, por ejemplo `@/shared`, `@/modules`, `@/lib`.
*   [ ] Configurar ESLint.
*   [ ] Configurar Prettier si se decide usarlo.
*   [ ] Crear archivo `.env.local.example`.
*   [ ] Definir variables:
    *   [ ] `NEXT_PUBLIC_SUPABASE_URL`
    *   [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY`
    *   [ ] `SUPABASE_SERVICE_ROLE_KEY` solo para entornos seguros del servidor si llega a requerirse.

### 1.2 Instalar Dependencias Base

*   [ ] Instalar `@supabase/supabase-js`.
*   [ ] Instalar helpers de Supabase para Next.js si se decide usar SSR/auth helpers.
*   [ ] Instalar `zod`.
*   [ ] Instalar libreria de formularios, preferiblemente `react-hook-form`.
*   [ ] Instalar integracion `@hookform/resolvers`.
*   [ ] Instalar `@tanstack/react-query`.
*   [ ] Instalar `@tanstack/react-query-devtools` para desarrollo.
*   [ ] Instalar libreria de graficos: `recharts`, `tremor` u otra definida.
*   [ ] Instalar `moment` para manejo de fechas.
*   [ ] Instalar `@tanstack/react-table` si se requiere una tabla avanzada.
*   [ ] Instalar y configurar Storybook para probar componentes visualmente.
*   [ ] Instalar Jest.
*   [ ] Instalar React Testing Library.
*   [ ] Instalar `@testing-library/jest-dom`.
*   [ ] Instalar `@testing-library/user-event`.
*   [ ] Instalar MSW si se requiere simular Supabase/TanStack Query en pruebas y stories.

## 2. Setup de Supabase

### 2.1 Base de Datos

*   [ ] Crear proyecto en Supabase.
*   [x] Ejecutar `supabase/supabase-schema.sql` en SQL Editor.
*   [ ] Verificar que se creen enums, tablas, indices, funciones RPC, vistas y politicas RLS.
*   [ ] Crear usuario inicial desde Supabase Auth.
*   [ ] Promover usuario inicial a `admin` en `profiles`.
*   [ ] Insertar tasa inicial en `exchange_rates`.
*   [ ] Crear categorias iniciales si aplica.

### 2.2 Validacion de RPC

*   [ ] Probar `update_product_price`.
*   [ ] Probar `adjust_stock`.
*   [ ] Probar `create_sale`.
*   [ ] Probar `create_purchase`.
*   [ ] Probar `register_payment`.
*   [ ] Validar que una venta descuente stock.
*   [ ] Validar que una compra aumente stock.
*   [ ] Validar que pagos parciales acumulen `paid_ves`.
*   [ ] Validar que una venta cambie a `pagada` cuando `paid_ves >= total_ves`.

## 3. Estructura de Carpetas

Crear la estructura base:

```text
src/
  app/
  modules/
    auth/
    dashboard/
    sales/
    purchases/
    inventory/
    products/
    contacts/
    payments/
    reports/
    settings/
  shared/
    components/
    hooks/
    services/
    schemas/
    types/
    utils/
  lib/
    supabase/
    constants/
    query/
```

Checklist:

*   [ ] Crear `src/modules`.
*   [ ] Crear `src/shared`.
*   [ ] Crear `src/lib/supabase`.
*   [ ] Crear `src/lib/query`.
*   [ ] Crear cliente Supabase de navegador.
*   [ ] Crear cliente Supabase de servidor si se usa SSR.
*   [ ] Crear `QueryClient` de TanStack Query.
*   [ ] Crear provider global de TanStack Query.
*   [ ] Agregar React Query Devtools solo en desarrollo.
*   [ ] Crear helpers para manejo de errores de Supabase.
*   [ ] Crear helpers para formateo de moneda `ref` y VES.
*   [ ] Crear helpers para fechas usando moment.

## 4. Capa de Datos y Consultas

### 4.1 Regla General

*   [ ] No colocar consultas Supabase directamente dentro de componentes.
*   [ ] No colocar RPC directamente dentro de componentes.
*   [ ] Separar funciones de lectura y escritura en archivos `services`.
*   [ ] Usar hooks con TanStack Query para exponer datos a los componentes.
*   [ ] Mantener los componentes enfocados en render, eventos y composicion visual.
*   [ ] Mantener la transformacion de datos compleja fuera del JSX.

### 4.2 Estructura Recomendada por Pagina

Para codigo propio de una pagina:

```text
src/modules/sales/sales-list/
  page.tsx
  components/
  hooks/
    useSalesList.ts
  services/
    getSalesList.ts
  schemas/
  types.ts
```

Para codigo compartido dentro del modulo:

```text
src/modules/sales/
  hooks/
    useSaleDetails.ts
  services/
    getSaleDetails.ts
    registerSalePayment.ts
```

Para codigo compartido por varios modulos:

```text
src/shared/services/
src/shared/hooks/
```

### 4.3 Patron de Consultas

*   [ ] Crear una funcion pura de servicio para cada consulta.
*   [ ] Crear un hook que use `useQuery`.
*   [ ] Definir `queryKey` estable y descriptivo.
*   [ ] Pasar filtros y parametros dentro del `queryKey`.
*   [ ] Transformar datos en el servicio o en `select`, no dentro del componente.
*   [ ] Manejar loading, empty y error state desde componentes compartidos.

Ejemplo de patron:

```text
services/getSalesList.ts      -> llama Supabase y retorna datos
hooks/useSalesList.ts         -> usa useQuery y expone data/loading/error
components/SalesTable.tsx     -> solo renderiza
page.tsx                      -> compone filtros, tabla y estados
```

### 4.4 Patron de Mutaciones

*   [ ] Crear una funcion de servicio para cada mutacion o RPC.
*   [ ] Crear un hook que use `useMutation`.
*   [ ] Invalidar queries relacionadas despues de una mutacion exitosa.
*   [ ] Mostrar mensajes de exito/error desde la capa de UI.
*   [ ] No duplicar logica de negocio de RPC en el frontend.

Ejemplos:

```text
sales/services/createSale.ts
sales/services/registerSalePayment.ts
purchases/services/createPurchase.ts
inventory/services/adjustStock.ts
products/services/updateProductPrice.ts
```

### 4.5 Fechas con Moment

*   [ ] Usar moment para mostrar fechas en tablas, detalles y reportes.
*   [ ] Centralizar formatos de fecha en `shared/utils/date`.
*   [ ] Definir formatos base:
    *   [ ] Fecha corta: `DD/MM/YYYY`
    *   [ ] Fecha y hora: `DD/MM/YYYY HH:mm`
    *   [ ] Mes para reportes: `MMMM YYYY`
*   [ ] Evitar formatear fechas manualmente dentro de componentes.
*   [ ] Convertir rangos de fecha antes de llamar servicios de consulta.

## 5. Sistema de Diseno

### 4.1 Identidad Visual

*   [ ] Definir paleta de colores.
*   [ ] Definir color primario para acciones principales.
*   [ ] Definir color de exito para ventas pagadas.
*   [ ] Definir color de alerta para stock bajo.
*   [ ] Definir color de peligro para cancelaciones/devoluciones.
*   [ ] Definir tipografia base.
*   [ ] Definir espaciado y radios consistentes.
*   [ ] Definir modo claro y modo oscuro.

### 4.2 Layout Principal

*   [ ] Crear layout autenticado tipo dashboard.
*   [ ] Crear sidebar con modulos principales.
*   [ ] Crear topbar con usuario, rol y tasa `ref` actual.
*   [ ] Mostrar acceso rapido para actualizar tasa `ref`.
*   [ ] Crear breadcrumb si se requiere.
*   [x] Crear area de contenido responsive.
*   [ ] Crear estado de carga global.
*   [ ] Crear pantalla de error global.

### 4.3 Componentes Compartidos

Crear en `src/shared/components` solo si realmente se usan entre modulos:

*   [ ] `AppShell`
*   [ ] `Sidebar`
*   [ ] `Topbar`
*   [ ] `PageHeader`
*   [ ] `DataTable`
*   [ ] `EmptyState`
*   [ ] `LoadingState`
*   [ ] `ErrorState`
*   [ ] `ConfirmDialog`
*   [ ] `CurrencyValue`
*   [ ] `RefValue`
*   [ ] `StatusBadge`
*   [ ] `DateRangeFilter`
*   [ ] `SearchInput`
*   [ ] `FormSection`
*   [ ] `MetricCard`

### 5.4 Storybook y Testing de Componentes

Storybook sera el laboratorio visual para validar componentes reutilizables antes de usarlos en modulos reales.

*   [ ] Configurar Storybook con soporte para Next.js, Tailwind CSS y Shadcn/UI.
*   [ ] Crear `.storybook/preview` con estilos globales.
*   [ ] Crear decorators globales si se requieren providers como Theme, QueryClient o contexto de auth simulado.
*   [ ] Crear stories para componentes en `src/shared/components`.
*   [ ] Crear stories para componentes reutilizables de modulo.
*   [ ] Crear stories para estados visuales: default, loading, error, empty, disabled, success, danger.
*   [ ] Crear stories de formularios con validaciones visibles.
*   [ ] Crear stories para `PaymentMethodFields` con cada metodo de pago.
*   [ ] Usar MSW en Storybook si un componente depende de datos remotos.
*   [ ] No conectar stories a Supabase real.

Reglas de stories:

*   [ ] Todo componente compartido nuevo debe tener `.stories.tsx` salvo que sea puramente interno y trivial.
*   [ ] Componentes de UI base como `Button`, `Input`, `Select`, `Modal`, `DataTable`, `StatusBadge`, `CurrencyValue` y `RefValue` deben tener stories.
*   [ ] Componentes criticos de negocio como `PaymentMethodFields`, `SaleTotals`, `SaleCart`, `SaleStatusBadge` y `StockMovementTimeline` deben tener stories.
*   [ ] Las stories deben cubrir variantes, tamanos, estados y casos vacios.

Reglas de Jest y React Testing Library:

*   [ ] Crear tests para componentes con interaccion.
*   [ ] Crear tests para formularios con validaciones.
*   [ ] Crear tests para componentes criticos de pago.
*   [ ] Crear tests para helpers de moneda `ref`/VES.
*   [ ] Crear tests para helpers de fechas con moment.
*   [ ] Crear tests para servicios puros cuando tengan transformacion de datos.
*   [ ] Evitar probar detalles internos; probar comportamiento visible para el usuario.

Estructura recomendada:

```text
src/shared/components/Button/
  Button.tsx
  Button.stories.tsx
  Button.test.tsx

src/shared/components/DataTable/
  DataTable.tsx
  DataTable.stories.tsx
  DataTable.test.tsx

src/modules/sales/sale-create/components/PaymentMethodFields/
  PaymentMethodFields.tsx
  PaymentMethodFields.stories.tsx
  PaymentMethodFields.test.tsx
```

## 6. Modulo Auth

Estructura sugerida:

```text
src/modules/auth/
  login/
    page.tsx
    components/
    hooks/
    schemas/
  components/
  services/
```

Checklist:

*   [ ] Crear pantalla `auth/login`.
*   [ ] Crear formulario de login.
*   [ ] Validar email/password con Zod.
*   [ ] Integrar login con Supabase Auth.
*   [ ] Crear logout.
*   [ ] Proteger rutas privadas.
*   [ ] Redirigir usuarios no autenticados a login.
*   [ ] Cargar perfil desde `profiles`.
*   [ ] Exponer rol actual del usuario.
*   [ ] Bloquear navegacion segun rol cuando aplique.

## 7. Modulo Dashboard

Estructura sugerida:

```text
src/modules/dashboard/
  dashboard-home/
    page.tsx
    components/
    hooks/
    services/
```

Checklist:

*   [ ] Crear pantalla principal del dashboard.
*   [ ] Mostrar ventas del dia.
*   [ ] Mostrar compras del dia.
*   [ ] Mostrar ganancia bruta del periodo.
*   [ ] Mostrar productos con stock bajo.
*   [ ] Mostrar tasa `ref` actual.
*   [ ] Agregar filtro por fecha.
*   [ ] Crear graficos de ventas por dia/semana/mes.
*   [ ] Crear ranking de productos mas vendidos.
*   [ ] Crear ranking de clientes por monto comprado.

## 8. Modulo Settings

Estructura sugerida:

```text
src/modules/settings/
  exchange-rates/
    page.tsx
    components/
    hooks/
    schemas/
  users/
    page.tsx
    components/
    hooks/
```

Checklist:

*   [ ] Crear pantalla `settings/exchange-rates`.
*   [ ] Registrar tasa VES/ref.
*   [ ] Listar historial de tasas.
*   [ ] Mostrar tasa actual en topbar.
*   [ ] Crear pantalla de usuarios si se requiere.
*   [ ] Permitir cambio de rol solo a `admin`.
*   [ ] Permitir activar/desactivar usuarios.

## 9. Modulo Products

Estructura sugerida:

```text
src/modules/products/
  products-list/
    page.tsx
    components/
    hooks/
  product-create/
    page.tsx
    components/
    hooks/
    schemas/
  product-edit/
    page.tsx
    components/
    hooks/
    schemas/
  product-details/
    page.tsx
    components/
    hooks/
  components/
    ProductStatusBadge.tsx
  services/
  types.ts
```

Checklist:

*   [ ] Crear listado de productos.
*   [ ] Agregar filtros por categoria, estado y stock bajo.
*   [ ] Crear formulario de producto.
*   [ ] Crear validaciones: SKU, nombre, precio `ref`, stock minimo.
*   [ ] Crear carga de imagen si se usara Supabase Storage.
*   [ ] Mostrar precio actual en `ref` y equivalente VES.
*   [ ] Mostrar costo actual referencial.
*   [ ] Permitir cambio de precio usando `update_product_price`.
*   [ ] Mostrar historial de precios.
*   [ ] Mostrar stock actual.
*   [ ] Mostrar movimientos de stock relacionados.

## 10. Modulo Inventory

Estructura sugerida:

```text
src/modules/inventory/
  inventory-overview/
    page.tsx
    components/
    hooks/
  stock-adjustments/
    page.tsx
    components/
    hooks/
    schemas/
  stock-card/
    page.tsx
    components/
    hooks/
```

Checklist:

*   [ ] Crear vista general de inventario.
*   [ ] Mostrar productos con stock actual.
*   [ ] Mostrar alertas de stock bajo.
*   [ ] Crear ajuste de stock con RPC `adjust_stock`.
*   [ ] Validar motivo obligatorio en ajustes manuales.
*   [ ] Crear vista kardex por producto usando `stock_card`.
*   [ ] Filtrar movimientos por fecha, producto y tipo.
*   [ ] Evitar ajustes que dejen stock negativo.

## 11. Modulo Contacts

Estructura sugerida:

```text
src/modules/contacts/
  contacts-list/
    page.tsx
    components/
    hooks/
  contact-create/
    page.tsx
    components/
    hooks/
    schemas/
  contact-details/
    page.tsx
    components/
    hooks/
  components/
    ContactTypeBadge.tsx
  services/
  types.ts
```

Checklist:

*   [ ] Crear listado de contactos.
*   [ ] Filtrar por cliente, proveedor o ambos.
*   [ ] Crear formulario de contacto.
*   [ ] Validar nombre, telefono, direccion y documento fiscal si aplica.
*   [ ] Crear detalle de cliente.
*   [ ] Mostrar historial de ventas del cliente.
*   [ ] Mostrar total comprado y saldo pendiente.
*   [ ] Crear detalle de proveedor.
*   [ ] Mostrar historial de compras del proveedor.
*   [ ] Mostrar productos asociados al proveedor.
*   [ ] Mostrar ultimo costo por producto/proveedor.

## 12. Modulo Sales

Estructura sugerida:

```text
src/modules/sales/
  sales-list/
    page.tsx
    components/
    hooks/
  sale-create/
    page.tsx
    components/
    hooks/
    schemas/
    services/
  sale-details/
    page.tsx
    components/
    hooks/
  components/
    SaleStatusBadge.tsx
    SaleTotalSummary.tsx
  services/
    registerSalePayment.ts
  types.ts
```

### 12.1 Listado de Ventas

*   [ ] Crear pantalla `sales/sales-list`.
*   [ ] Mostrar numero de factura, cliente, fecha, total `ref`, total VES, pagado y estado.
*   [ ] Filtrar por fecha, cliente y estado.
*   [ ] Buscar por numero de factura.
*   [ ] Acceder a detalle de venta.

### 12.2 Crear Venta

*   [ ] Crear pantalla `sales/sale-create`.
*   [ ] Seleccionar cliente o crear cliente rapido.
*   [ ] Cargar tasa `ref` vigente.
*   [ ] Mostrar tasa actual en pantalla.
*   [ ] Buscar productos por nombre o SKU.
*   [ ] Mostrar stock disponible por producto.
*   [ ] Agregar productos al carrito.
*   [ ] Validar cantidad mayor a cero.
*   [ ] Validar stock suficiente.
*   [ ] Copiar precio actual `sale_price_ref`.
*   [ ] Calcular subtotal por linea en `ref` y VES.
*   [ ] Calcular total general en `ref` y VES.
*   [ ] Permitir descuento en `ref` si aplica.
*   [ ] Permitir impuesto en `ref` si aplica.
*   [ ] Confirmar venta con RPC `create_sale`.
*   [ ] Descontar stock de forma atomica.
*   [ ] Crear movimientos de stock tipo `venta`.

### 12.3 Pago Inicial en Venta

*   [ ] Permitir venta sin pago inicial.
*   [ ] Permitir pago completo al crear venta.
*   [ ] Permitir pago parcial al crear venta.
*   [ ] Permitir pagos combinados al crear venta.
*   [ ] Registrar cada pago usando RPC `register_payment`.
*   [ ] Validar metodo de pago antes de registrar.
*   [ ] Mostrar saldo pendiente en vivo.

### 12.4 Metodos de Pago en Venta

*   [ ] Efectivo BS (VES): monto obligatorio.
*   [ ] Efectivo USD: monto obligatorio, convertir con `ref_rate_ves`.
*   [ ] Pago Movil: monto, banco, telefono y referencia de 4 digitos.
*   [ ] Punto de Venta: monto obligatorio y referencia opcional.
*   [ ] Transferencia: monto, banco y numero de transferencia.
*   [ ] Guardar `amount`, `currency`, `amount_ves`, `amount_ref`, `method`, `bank_name`, `phone`, `reference_code`.

### 12.5 Detalle de Venta

*   [ ] Crear pantalla `sales/sale-details`.
*   [ ] Mostrar datos de factura.
*   [ ] Mostrar tasa historica usada.
*   [ ] Mostrar productos vendidos.
*   [ ] Mostrar pagos aplicados.
*   [ ] Mostrar saldo pendiente.
*   [ ] Mostrar movimientos de stock relacionados.
*   [ ] Imprimir o exportar recibo/factura.
*   [ ] Permitir registrar nuevo pago parcial si la venta esta pendiente.
*   [ ] Cambiar estado a `pagada` cuando `paid_ves >= total_ves`.

## 13. Modulo Purchases

Estructura sugerida:

```text
src/modules/purchases/
  purchases-list/
    page.tsx
    components/
    hooks/
  purchase-create/
    page.tsx
    components/
    hooks/
    schemas/
  purchase-details/
    page.tsx
    components/
    hooks/
  components/
    PurchaseStatusBadge.tsx
  services/
  types.ts
```

Checklist:

*   [ ] Crear listado de compras.
*   [ ] Crear pantalla de compra.
*   [ ] Seleccionar proveedor.
*   [ ] Cargar tasa `ref` vigente.
*   [ ] Agregar productos comprados.
*   [ ] Registrar cantidad y costo unitario en `ref`.
*   [ ] Calcular total en `ref` y VES.
*   [ ] Confirmar compra con RPC `create_purchase`.
*   [ ] Aumentar stock de forma atomica.
*   [ ] Actualizar costo actual del producto.
*   [ ] Actualizar ultimo costo por proveedor-producto.
*   [ ] Registrar pagos parciales a proveedor con `register_payment`.
*   [ ] Mostrar saldo pendiente de compra.

## 14. Modulo Payments

Estructura sugerida:

```text
src/modules/payments/
  payments-list/
    page.tsx
    components/
    hooks/
  payment-create/
    page.tsx
    components/
    hooks/
    schemas/
  components/
    PaymentMethodBadge.tsx
    PaymentMethodFields.tsx
  services/
  types.ts
```

Checklist:

*   [ ] Crear listado de pagos.
*   [ ] Filtrar por fecha, contacto, metodo y direccion.
*   [ ] Diferenciar pagos de entrada y salida.
*   [ ] Crear formulario reusable de metodo de pago.
*   [ ] Validar Pago Movil.
*   [ ] Validar Transferencia.
*   [ ] Convertir efectivo USD a VES/ref.
*   [ ] Mostrar comprobante o referencia.
*   [ ] Mostrar pago asociado a venta o compra.

## 15. Modulo Reports

Estructura sugerida:

```text
src/modules/reports/
  sales-report/
    page.tsx
    components/
    hooks/
  profit-report/
    page.tsx
    components/
    hooks/
  inventory-report/
    page.tsx
    components/
    hooks/
```

Checklist:

*   [ ] Crear reporte de ventas por periodo.
*   [ ] Crear reporte de compras por periodo.
*   [ ] Crear reporte de ganancia bruta.
*   [ ] Crear reporte de rentabilidad por producto.
*   [ ] Crear reporte de clientes con mayor compra.
*   [ ] Crear reporte de proveedores con mayor volumen.
*   [ ] Crear reporte de stock bajo.
*   [ ] Crear reporte kardex por producto.
*   [ ] Agregar filtros por rango de fecha.
*   [ ] Agregar exportacion a PDF/Excel en fase posterior.

## 16. QA por Modulo

### 16.1 Pruebas Funcionales

*   [ ] Login y logout funcionan.
*   [ ] Rutas privadas bloquean usuarios no autenticados.
*   [ ] Roles limitan acciones correctamente.
*   [ ] Productos se crean y editan correctamente.
*   [ ] Cambio de precio crea historial.
*   [ ] Ajuste de stock crea movimiento.
*   [ ] Venta descuenta stock.
*   [ ] Compra aumenta stock.
*   [ ] Pago parcial actualiza saldo.
*   [ ] Pago completo cambia estado a `pagada`.
*   [ ] Pago Movil exige datos requeridos.
*   [ ] Transferencia exige datos requeridos.
*   [ ] Efectivo USD convierte correctamente a VES.

### 16.2 Pruebas de UX

*   [ ] Todas las tablas tienen loading state.
*   [ ] Todas las tablas tienen empty state.
*   [ ] Todos los formularios muestran errores claros.
*   [ ] Las acciones destructivas piden confirmacion.
*   [ ] La tasa `ref` actual es visible en flujos de venta y compra.
*   [ ] Los totales `ref` y VES son visibles en venta y compra.
*   [ ] La app funciona en desktop.
*   [x] La app funciona en tablet.
*   [x] La app funciona en movil si aplica.

## 17. Checklist de Lanzamiento MVP

*   [ ] Variables de entorno configuradas.
*   [ ] Proyecto Supabase creado.
*   [ ] SQL ejecutado.
*   [ ] Usuario admin creado.
*   [ ] RLS probado por rol.
*   [ ] Auth funcionando.
*   [ ] Dashboard funcionando.
*   [ ] Productos funcionando.
*   [ ] Inventario funcionando.
*   [ ] Contactos funcionando.
*   [ ] Ventas funcionando.
*   [ ] Compras funcionando.
*   [ ] Pagos funcionando.
*   [ ] Reportes principales funcionando.
*   [ ] App desplegada en Vercel.
*   [ ] Backups de Supabase revisados.
*   [ ] Pruebas manuales completadas.
