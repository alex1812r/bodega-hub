# Inventario maestro de prompts Stitch

Prompts iniciales para generar/refinar todas las pantallas del ERP. Proyecto: **BodegaSync ERP Design System** (`12828444962089869126`).

Para prompts **extendidos** (más detalle) ver:

| Archivo | Pantalla | Notas |
|---------|----------|-------|
| [`10-inventory-movements-redesign.md`](10-inventory-movements-redesign.md) | Movimientos inventario | Supersede el prompt corto #10 de este doc |
| [`15-supplier-products-catalog.md`](15-supplier-products-catalog.md) | Catálogo proveedor-producto | Nuevo módulo M10–M14 |

Referencia pantallas generadas: [`../stitch-design-checklist.md`](../stitch-design-checklist.md)

---

## Contexto global (pegar al inicio de cada prompt)

```
Producto: Control Ventas ERP (marca BodegaSync). ERP retail Venezuela/LATAM.
Moneda: precios en REF; totales también en VES con tasa REF/VES del día (snapshot en facturas).
Design system Stitch existente: Inter, primary indigo #4F46E5, secondary emerald #10B981, warning amber #F59E0B, surface #F8F9FF, sidebar 288px desktop, bordes suaves 4px, densidad alta tipo SaaS ERP.
Layout autenticado: sidebar oscuro slate-900 (Inicio, Ventas, Compras, Inventario, Productos, Contactos, Pagos, Reportes, Configuración). Header sticky: tasa REF/VES, toggle tema, usuario, cerrar sesión. Móvil: hamburger + drawer navegación.
Componentes: tablas paginadas densas, FilterPanel colapsable, badges de estado, cards KPI, modales centrados (móvil tipo sheet), empty/error/loading states.
Idioma UI: español (Venezuela). Iconos estilo Lucide 20px.
Breakpoints: móvil <768 (1 col, drawer), tablet 768–1024, desktop >1024 (sidebar fijo 12 cols).
No inventar módulos fuera de esta lista.
```

---

## Inventario maestro (nada debe quedar fuera)

| # | Tipo | Nombre | Ruta | En Stitch |
|---|------|--------|------|-----------|
| 0 | Sistema | App Shell + Header + Drawer móvil | (todas las privadas) | Parcial (en otras pantallas) |
| 1 | Página | Login | `/login` | Sí |
| 2 | Página | Dashboard / Inicio | `/dashboard` | Sí |
| 3 | Página | Listado ventas | `/sales` | No |
| 4 | Página | Punto de venta (crear venta) | `/sales/create` | Sí (POS) |
| 5 | Página | Detalle venta + recibo | `/sales/[id]` | No |
| 6 | Página | Listado compras | `/purchases` | No |
| 7 | Página | Crear compra | `/purchases/create` | No |
| 8 | Página | Detalle compra | `/purchases/[id]` | No |
| 9 | Página | Inventario (stock actual) | `/inventory` | Sí |
| 10 | Página | Movimientos de inventario | `/inventory/movements` | No |
| 11 | Página | Listado productos | `/products` | No |
| 12 | Página | Detalle producto | `/products/[id]` | No |
| 13 | Wizard | Importar productos Excel | `/products/import` | No |
| 14 | Página | Listado contactos | `/contacts` | No |
| 15 | Página | Detalle contacto | `/contacts/[id]` | No |
| 16 | Página | Listado pagos | `/payments` | No |
| 17 | Página | Detalle pago | `/payments/[id]` | No |
| 18 | Página | Hub reportes + 10 vistas | `/reports` | No |
| 19 | Página | Configuración | `/settings` | No |
| 20 | Aux | API docs Swagger | `/api-docs` | No (opcional dev) |
| 21 | Aux | Dev welcome demo | `/dev/welcome` | No (opcional dev) |

**Modales / overlays (diseñar como pantallas o componentes aparte):**

| M | Modal | Dónde se usa |
|---|--------|----------------|
| M1 | Crear/editar contacto | `/contacts`, `/contacts/[id]` |
| M2 | Crear/editar producto | `/products`, `/products/[id]` |
| M3 | Registrar pago | `/payments`, detalle venta/compra/pago |
| M4 | Ajuste de inventario | `/inventory`, `/inventory/movements` |
| M5 | Detalle movimiento inventario | `/inventory/movements` |
| M6 | Drawer navegación móvil | App Shell |
| M7 | Confirmar anular venta | `/sales`, `/sales/[id]` (hoy sin modal; diseñar) |
| M8 | Confirmar anular/devolver compra | compras (diseñar) |
| M9 | Confirmar desactivar producto | `/products` (diseñar) |

**Procesos / flujos multi-paso:**

| P | Proceso | Pasos |
|---|---------|--------|
| F1 | Venta completa | POS → confirmar → pendiente/pagada → pagos → recibo → anular/devolver |
| F2 | Compra completa | crear → pedido/recibido → recibir mercancía → pagos → anular/devolver |
| F3 | Pago | elegir venta/compra → método → campos bancarios → saldo pendiente |
| F4 | Import Excel productos | plantilla → subir → preview → política errores → progreso → resumen |
| F5 | Ajuste stock | tipo movimiento → cantidad → motivo → auditoría |
| F6 | Export reportes | selector reporte → filtros → tabla → PDF/Excel (UI pendiente, diseñar igual) |
| F7 | Cambio precio producto | editar en modal → historial precios en detalle |

**Estados transversales (cada módulo):** loading skeleton, error con reintentar, empty state, tabla desktop + cards móvil, paginación.

---

## Ya en Stitch — prompts de refinamiento (opcional)

### 0 — App Shell (completar en todas las pantallas privadas)

```
[Contexto global]
Diseña el layout maestro autenticado BodegaSync: sidebar izquierdo 288px fondo slate-900, logo "BodegaSync", 9 ítems con icono+label (Inicio, Ventas, Compras, Inventario, Productos, Contactos, Pagos, Reportes, Configuración), ítem activo con barra indigo izquierda. Header blanco sticky: izquierda en móvil botón menú; bloque "Tasa oficial REF/VES" con número grande y badge "ref"; derecha toggle claro/oscuro, nombre usuario "María Admin", rol "Administrador", botón "Cerrar sesión". Área contenido max-width 1440px padding 24px. Variante móvil 375px: sidebar oculto, drawer slide-over al abrir menú. Desktop 1280px.
```

### 1 — Login (`/login`) — ya existe

```
[Contexto global]
Refina pantalla "Iniciar Sesión - BodegaSync" split layout: izquierda branding (logo, tagline ERP inventario+ventas Venezuela, bullets confianza); derecha card login email+password, botón "Ingresar", mensaje error bajo formulario, link futuro "¿Olvidaste tu contraseña?" deshabilitado. Sin sidebar. Centrado móvil. Fondo surface #F8F9FF.
```

### 2 — Dashboard (`/dashboard`) — ya existe

```
[Contexto global]
Refina "Dashboard - BodegaSync" con shell. Título "Inicio". 4 KPI cards: Ventas del día (count), Total VES, Pendientes por cobrar, Tasa ref/VES con fuente y fecha. Card métricas rango: unidades, pagado VES, pendiente VES, stock bajo count. Dos tablas lado a lado desktop: "Ventas recientes" (factura, fecha, estado badge, total ref) y "Stock bajo" (SKU, producto, stock, mínimo). Paginación bajo cada tabla. Incluir selector rango fechas (futuro) en header de métricas. Móvil: KPI 2 cols, tablas como cards apiladas.
```

### 4 — POS (`/sales/create`) — ya existe

```
[Contexto global]
Refina "Punto de Venta (POS) - BodegaSync": PageHeader "Nueva venta" con Volver + Confirmar venta. Columna izquierda: select cliente (solo clientes/ambos), fila agregar producto (select SKU, cantidad, stock disponible, precio ref), tabla carrito líneas, notas. Columna derecha sticky: resumen subtotal/descuento ref/impuesto ref/total ref y total VES con tasa visible. Barra inferior móvil sticky "Confirmar venta". Estados: carrito vacío, error stock, loading tasa.
```

### 9 — Inventario listado (`/inventory`) — ya existe

```
[Contexto global]
Refina "Inventario - BodegaSync": título Inventario, botón primario "Ajustar stock" (abre modal M4), FilterPanel búsqueda + solo bajo stock, tabla SKU/nombre/categoría/stock actual/mínimo/badge alerta, link "Ver movimientos". Cards en móvil. Paginación.
```

---

## Pantallas faltantes — prompts completos

### 3 — Listado de ventas (`/sales`)

```
[Contexto global]
Pantalla "Listado de Ventas" /sales. PageHeader implícito en EntityListPage: título Ventas, descripción, CTA "Nueva venta" → /sales/create. FilterPanel: búsqueda factura/cliente, estado (borrador, pendiente pago, pagada, cancelada, devuelta), rango desde/hasta, cliente. Tabla: N° factura, fecha, cliente, estado (badge color), total ref, total VES, pagado VES, acciones menú (Ver recibo, Anular, Devolver). Paginación responsive. Móvil cards con menú ⋮. Empty: "Aún no hay ventas". Incluir shell.
```

### 5 — Detalle de venta + recibo (`/sales/[id]`)

```
[Contexto global]
Pantalla detalle venta /sales/[id]. PageHeader: N° factura + badge estado + acciones: Volver listado, Registrar pago (si pendiente), Anular, Devolver. Sección InfoGrid: cliente, vendedor, fecha, tasa ref/VES usada, subtotal/descuento/impuesto/total ref y VES, pagado VES, saldo pendiente VES. Tabla ítems: producto, cantidad, precio ref, subtotal ref. Sección "Pagos" tabla pagos (fecha, método, monto VES, referencia). Sección "Recibo" printable: bloque factura con totales históricos, lista pagos, saldo; botones "Imprimir" y "Descargar PDF" (PDF puede verse disabled/ próximamente). Estados loading skeleton y error. Diseñar también modal M7 confirmación anular: título, texto advertencia reversión stock, Cancelar / Anular venta danger.
```

### 6 — Listado de compras (`/purchases`)

```
[Contexto global]
Pantalla /purchases Compras. CTA "Nueva compra". Filtros: proveedor, estado (pedido, recibido, cancelado, devuelto), fechas. Tabla: N° compra, fecha, proveedor, estado badge, total ref, acciones Ver, Recibir (si pedido), Cancelar, Devolver. Shell + paginación + cards móvil.
```

### 7 — Crear compra (`/purchases/create`)

```
[Contexto global]
Pantalla /purchases/create espejo del POS pero compras: proveedor obligatorio, estado pedido/recibido, carrito productos con costo ref, descuento/impuesto ref, total ref/VES, tasa ref, pago inicial opcional (futuro), notas. Header Confirmar compra + Volver. Layout 2 columnas desktop, stack móvil, barra sticky confirmar. Validación sin proveedor.
```

### 8 — Detalle de compra (`/purchases/[id]`)

```
[Contexto global]
Detalle compra /purchases/[id]: header con N° compra, badge estado, Volver, Registrar pago, Recibir mercancía (si pedido), Cancelar, Devolver. InfoGrid proveedor, fechas, totales ref/VES, pagado/pendiente. Tabla ítems. Tabla pagos. Modales M8 confirmar cancelar y devolver. Sección recepción destacada si estado pedido.
```

### 10 — Movimientos de inventario (`/inventory/movements`)

```
[Contexto global]
/inventory/movements: título Movimientos de inventario, CTA Ajustar stock (M4), FilterPanel producto, tipo movimiento (venta, compra, ajuste entrada/salida, devolución cliente/proveedor, inventario inicial), fechas. Tabla: fecha, producto, tipo badge, cantidad delta, stock resultante, usuario, motivo; fila clic abre M5 detalle movimiento (modal solo lectura con todos los campos). Link volver a inventario. Paginación.
```

### 11 — Listado de productos (`/products`)

```
[Contexto global]
/products Productos: acciones Importar Excel (outline) + Nuevo producto (M2). Filtros búsqueda, categoría, activo/inactivo. Tabla: SKU, nombre, categoría, precio venta ref, costo ref, stock, estado badge, menú Ver detalle, Editar, Historial precios, Desactivar. Modal M9 confirmar desactivar. Empty y paginación. Móvil cards.
```

### 12 — Detalle de producto (`/products/[id]`)

```
[Contexto global]
/products/[id]: PageHeader nombre producto + Editar (M2). Card resumen: SKU, categoría, precio ref, costo ref, descripción, activo. ProductStockSummary con alerta bajo stock. Tabla historial precios (fecha, precio anterior/nuevo, usuario, motivo). Tabla proveedores del producto (proveedor, SKU proveedor, último costo ref). Sección cambiar precio al guardar edición. Loading/error states.
```

### 13 — Wizard importar productos (`/products/import`)

```
[Contexto global]
Wizard 5 pasos /products/import — stepper horizontal: Plantilla | Archivo | Preview | Importación | Resumen.
Paso Plantilla: explicación columnas Excel (sku, nombre, categoria, precio_ref, costo_ref, stock_inicial, stock_minimo), botón Descargar plantilla .xlsx, máx 500 filas.
Paso Archivo: dropzone drag&drop .xlsx.
Paso Preview: tabla validación filas con badges válido/error, contadores importables/errores, toggle política "continuar si hay errores", botón Importar N productos.
Paso Importación: barra progreso %, botón Cancelar importación danger.
Paso Resumen: creados/omitidos/errores, link Volver a productos. Shell sin sidebar estrecho — ancho contenido amplio.
```

### 14 — Listado de contactos (`/contacts`)

```
[Contexto global]
/contacts Contactos: CTA Nuevo contacto (M1). Filtros búsqueda, tipo (cliente, proveedor, ambos), activo. Tabla: nombre, tipo badge, RIF/cédula, teléfono, email, estado, menú Ver/Editar. Paginación. Móvil cards.
```

### 15 — Detalle de contacto (`/contacts/[id]`)

```
[Contexto global]
/contacts/[id]: PageHeader nombre + Editar (M1). ContactProfileCard: tipo, taxId, email, teléfono, dirección, notas, activo. Tabs o secciones apiladas: Actividad reciente (timeline venta/compra/pago), Tabla ventas del cliente, Tabla compras si proveedor, Tabla pagos. Totales ref/VES y deuda pendiente en card KPI si cliente. Enlaces a detalle venta/compra (diseñar como links indigo).
```

### 16 — Listado de pagos (`/payments`)

```
[Contexto global]
/payments Pagos: CTA Registrar pago (M3). Filtros dirección (entrada/salida), venta, compra, contacto, fechas. Tabla: fecha, dirección badge, contacto, venta/compra ref, método, monto VES, moneda, estado. Menú Ver detalle. Paginación.
```

### 17 — Detalle de pago (`/payments/[id]`)

```
[Contexto global]
/payments/[id]: PageHeader ID pago + Volver + Registrar otro pago (M3 mismo contexto) + Anular pago (disabled "pendiente API"). InfoGrid: fecha, método, montos original/VES/ref, banco, teléfono, referencia 4 dígitos, notas, venta/compra vinculada, usuario. Card saldo operación después del pago.
```

### 18 — Reportes hub (`/reports`) — 1 hub + 10 vistas

**Hub:**

```
[Contexto global]
/reports Reportes: título + FilterPanel global (desde, hasta, proveedor ID para reporte compras, productId para kardex). Lista/tabla selector de reportes con columnas nombre, periodo, descripción, filtros hint, badge conectado. En móvil SelectField para elegir reporte. Botones toolbar: Exportar PDF y Exportar Excel (marcar como "próximamente" o diseño activo para futuro). Al seleccionar reporte, panel inferior muestra tabla del reporte + paginación.
```

**18a — Ventas diarias**

```
[Contexto global] Vista reporte "Ventas diarias" dentro de /reports: tabla columnas Fecha, # ventas, Total ref, Total VES, Cobrado VES. Sin gráfico aún; espacio reservado chart línea futuro.
```

**18b — Ganancia bruta**

```
Tabla: Fecha, Ingresos ref, Costos ref, Ganancia ref. Badge utilidad positiva/negativa.
```

**18c — Rentabilidad por producto**

```
Tabla: Producto, SKU, Unidades, Costo ref, Ganancia ref. Ordenable visualmente por ganancia.
```

**18d — Bajo stock**

```
Tabla: Producto, SKU, Stock, Mínimo, diferencia. Filas críticas en amber.
```

**18e — Compras de clientes**

```
Tabla: Cliente, # ventas, Total ref, Pendiente VES, Última compra.
```

**18f — Compras a proveedores**

```
Tabla: Proveedor, # compras, Total ref, Pendiente VES, Último movimiento.
```

**18g — Kardex / tarjeta de stock**

```
Requiere filtro productId arriba. Tabla movimientos: fecha, tipo, entrada, salida, saldo.
```

**18h — Top productos**

```
Filtro rango fechas. Tabla: SKU, nombre, unidades vendidas, total ref.
```

**18i — Top clientes**

```
Filtro rango. Tabla: cliente, total ref, # facturas.
```

**18j — Compras por periodo**

```
Filtro fechas + proveedor. Tabla: fecha, proveedor, total ref, estado.
```

**18k — Modal/panel exportación (F6)**

```
Diseña modal "Exportar reporte": formato PDF | Excel, rango fechas, reporte seleccionado, botón Generar y estado progreso. Aunque API no exista, UI lista para implementar.
```

### 19 — Configuración (`/settings`)

```
[Contexto global]
/settings una página con secciones en cards grid (stack en móvil):
1) Empresa: businessName, invoicePrefix, defaultTaxRate %, lowStockThreshold, Guardar.
2) Tasa de cambio: card tasa vigente DolarAPI (REF/VES, fuente, fecha) + form manual rateVes+source + historial tabla paginada.
3) Usuarios: tabla nombre, email, select rol (admin, vendedor, almacén, contador), select activo/inactivo.
4) Demo dev (opcional): selector rol demo si entorno desarrollo.
Sin sidebar secundario; título Configuración.
```

### 20–21 — Auxiliares (opcional)

```
/api-docs: página Swagger embebida, minimal chrome, link Volver al ERP.
/dev/welcome: landing dev con links dashboard y api-docs, badge "solo desarrollo".
```

---

## Modales — prompts dedicados

### M1 — Contacto crear/editar

```
[Contexto global] Modal "Nuevo contacto" / "Editar contacto": campos nombre*, tipo select (cliente/proveedor/ambos), RIF/cédula, email, teléfono, dirección textarea, notas. Footer Cancelar + Crear/Guardar. Ancho md, sheet bottom en móvil. Error inline bajo título.
```

### M2 — Producto crear/editar

```
Modal producto: SKU*, nombre*, categoría select, precio venta ref*, costo ref*, stock actual, stock mínimo, descripción. Modo editar muestra precio destacado. Footer Guardar. Validación campos requeridos.
```

### M3 — Registrar pago

```
Modal "Registrar pago": si sin contexto — radio venta/compra + input ID; si desde venta/compra — muestra saldo pendiente VES grande. Campos: método (efectivo VES, efectivo USD, pago móvil, punto venta, transferencia), monto*, campos condicionales banco/teléfono/referencia 4 dígitos según método. Notas. Éxito: mensaje nuevo saldo. Footer Cancelar + Registrar.
```

### M4 — Ajuste inventario

```
Modal "Ajuste de stock": producto select buscable, tipo movimiento (entrada, salida, devolución cliente/proveedor, inventario inicial), cantidad*, motivo textarea. Footer Aplicar ajuste.
```

### M5 — Detalle movimiento (solo lectura)

```
Modal lectura movimiento inventario: todos los campos del kardex + usuario + timestamp. Solo Cerrar.
```

### M6 — Drawer navegación móvil

```
Drawer overlay 80% ancho: mismos ítems sidebar, usuario, cerrar sesión abajo, X cerrar.
```

### M7–M9 — Confirmaciones destructivas

```
M7 Anular venta: icono warning, texto reversión stock, Cancelar / Anular danger.
M8 Anular compra y Devolver compra: variantes similares.
M9 Desactivar producto: "El producto no aparecerá en ventas nuevas".
```

---

## Procesos end-to-end (para Stitch “user journey”)

### F1 — Flujo venta (storyboard 6 frames)

```
Frame 1 POS vacío. 2 POS con 3 líneas y totales. 3 Confirmar → toast éxito pendiente pago. 4 Listado ventas fila pendiente. 5 Modal M3 pago móvil parcial. 6 Detalle venta estado pagada + recibo imprimible.
```

### F2 — Flujo compra (5 frames)

```
Nueva compra → confirmar pedido → detalle → botón Recibir → stock actualizado → pago proveedor.
```

### F4 — Import Excel (usa wizard pantalla 13)

### F6 — Export reportes (usa 18k + hub)

---

## Estados UI transversales (aplicar en cada módulo)

```
Diseña 3 variantes componente para tablas ERP BodegaSync:
1) Loading: skeleton 5 filas + spinner sutil en header.
2) Error: ilustración minimal, título "No pudimos cargar…", descripción, botón Reintentar.
3) Empty: icono caja, "Aún no hay registros", CTA contextual (ej. Nueva venta).
Móvil: mismos estados en card stack.
```

---

## Pendientes de producto (diseñar igual, marcar “futuro”)

| Item | Notas |
|------|--------|
| PDF recibo venta | Botón en detalle venta |
| Export PDF/Excel reportes | Toolbar reportes |
| Anular pago | Botón disabled → diseñar habilitado |
| Venta borrador | Estado en listados (poco usado en API) |
| CRUD categorías UI | Solo API hoy |
| Imagen producto | Campo BD sin UI |
| MFA / recuperar contraseña | Login |
| Gráficos dashboard/reportes | Espacio reservado |
| Cliente “Consumidor final” por defecto en POS | Atajo PRD |

---

## Orden sugerido para Stitch (después de las 4 actuales)

1. App Shell (0)  
2. Listado ventas (3) + Detalle venta (5) + M3 + M7  
3. Listado productos (11) + Detalle (12) + M2 + Wizard (13)  
4. Contactos (14–15) + M1  
5. Compras (6–8)  
6. Pagos (16–17)  
7. Movimientos (10) + M4–M5  
8. Reportes hub + 10 vistas + export (18)  
9. Settings (19)  
10. Variantes móvil 375px de POS, Dashboard, listados  

---

## Cómo usar en Stitch

- Proyecto: **BodegaSync ERP Design System**.  
- Cada prompt: **Generate screen from text** o **Edit screen** si refinás una existente.  
- Para modales: generar como pantalla 640×800 o componente en design system.  
- Mantener **mismo design system** (`apply_design_system` si lo usás desde Agent mode).
