# Auditoría de producto — BodegaHub web (octubre 2026)

Inspección funcional y de experiencia de uso sobre el código de `src/modules/` (rama `fix/stock-integrity`, estado al 2026-10-06). Se revisaron los flujos de registro de ventas, compras, productos, categorías, vínculo producto–proveedor, pagos (totales y parciales), inventario y las pantallas de detalle. Método: lectura de las pantallas, componentes y hooks de cada flujo, conteo de pasos/campos/pantallas por tarea, y contraste con lo que reportan los usuarios (complejidad al registrar compras y pagos, dificultad para ver stock, detalles muy largos sin secciones colapsables).

> **Actualización 2026-10-07.** Tras esta auditoría se mergearon en `main` la app móvil (repo aparte, `@bodega/core`), la nómina y el asistente, y se ejecutó el plan de integridad de stock en `fix/stock-integrity` (21 causas corregidas, libro mayor como fuente de verdad, RPC idempotentes, laboratorio `stock-lab`). Eso cierra o reduce varios hallazgos de este documento: **R3 (stock editable a mano)** ya está resuelto en datos y BFF (C1, C2); **I1–I4** se construyen ahora sobre el libro con `seq`; **D3** (acción primaria) convive con la numeración nueva `V-YYYYMMDD-NNNNNN`. Los abiertos del plan de stock que son de producto (`register_payment` sin idempotencia, descuento casi total, producto inactivo comprable, `pendiente_pago` sin vencimiento) se incorporaron al plan de mejoras (§0b de `agent-prompts/ux-mejoras-gtm.md`).

Severidad: **Alta** = frena o induce errores en la operación diaria · **Media** = fricción recurrente · **Baja** = pulido.

---

## 1. Resumen ejecutivo

El sistema es funcionalmente completo y técnicamente sólido (RPC transaccionales, dual REF/Bs, idempotencia reciente en ventas y compras). El problema no es falta de funciones sino **exceso de pasos y de densidad por pantalla**: los flujos están diseñados alrededor del modelo de datos (producto → proveedor → vínculo → empaque → compra → pago) y no alrededor de la tarea del usuario ("llegó mercancía, anótala y páguela").

Cuatro hallazgos concentran la mayor parte de la queja:

1. **Comprar un producto nuevo exige pasar por 5 pantallas y 3 modales** antes de poder registrar la compra, porque la compra solo acepta productos ya vinculados al proveedor y no permite crear ni vincular desde ahí.
2. **Pagar una compra te saca de la compra**: el botón "Pagar" navega a `/payments`, abre un modal genérico, no prellena el saldo, pide el monto en Bs aunque la deuda se piensa en REF, y sin el parámetro de URL obliga a escribir el **ID** de la compra a mano.
3. **Cada línea de compra tiene hasta 9 controles** (moneda, modo, tipo de empaque, cantidad, unidades por empaque, costo, costo auto, impuesto, total). Para una compra típica de 15 líneas son más de 100 controles en pantalla.
4. **Ninguna pantalla de detalle tiene secciones colapsables ni tabs**; `grep` de `<details>`, `Accordion`, `Collapsible` en todo `src/` devuelve cero resultados. El detalle de producto apila 8 bloques (incluida una tabla de ventas históricas y otra de proveedores) en una sola columna.

Y un hallazgo transversal: **el stock se consulta en tres sitios distintos** (Productos, Inventario, detalle de producto) con columnas casi idénticas, y en ninguno se ve de un vistazo "cuánto compré, cuánto vendí, cuánto debería tener".

---

## 2. Mapa de esfuerzo por tarea

Conteo de pantallas, modales y campos obligatorios/visibles para tareas reales de una bodega. "Pantalla" = cambio de ruta.

| Tarea | Pantallas | Modales | Campos tocados | Observación |
|-------|-----------|---------|----------------|-------------|
| Vender 3 productos, efectivo exacto | 1 | 1 (cobrar) | 3–5 | Bien: el POS es el flujo más pulido |
| Vender con vuelto en Bs y pago mixto | 1 | 2–3 | 8–12 | Correcto pero denso: contar billetes + declarar vuelto + denominaciones |
| Comprar 10 productos **ya vinculados** al proveedor, recibido, pago después | 3 (`/purchases/create` → detalle → `/payments`) | 1 | ~45 (10 líneas × 4 mín.) + 4 del pago | El pago rompe el flujo |
| Comprar 1 producto **nuevo** de un proveedor **nuevo** | 5 (`/contacts` nuevo → `/products` nuevo → `/contacts/[id]` tab Productos → `/purchases/create` → `/payments`) | 4 (producto, vincular, empaques, pago) | ~30 | El peor camino; es el caso normal cuando entra mercancía nueva |
| Ver cuánto stock hay de un producto y por qué | 1–2 (`/inventory` o `/products` → detalle) | 0 | 1 búsqueda | El "por qué" (movimientos) está en `/inventory/movements` filtrado por producto, otra pantalla más |
| Registrar un abono parcial a una venta fiada | 2 (`/sales/[id]` → `/payments?saleId=`) | 1 | 4 | El saldo no se prellena; sin botón "completar" |
| Saber qué compras debo | — | — | — | **No se puede**: la lista de compras no muestra pagado/saldo ni filtra por estado de pago |
| Crear categoría mientras creas un producto | 2 (`/products/categories` → volver) | 2 | 3 | No hay "nueva categoría" inline |

---

## 3. Hallazgos por flujo

### 3.1 Registro de compras (`/purchases/create`) — Alta

**H1 · Solo se pueden comprar productos ya vinculados al proveedor.** `PurchaseProductPickerCard` busca únicamente en el catálogo del proveedor (`resolveSupplierCatalogProduct`); el escáner responde "Producto no vinculado a este proveedor"; la búsqueda sin resultados muestra solo "Sin resultados". No hay acción "crear producto" ni "vincular producto existente" desde la compra. Resultado: la compra, que es el momento en que el usuario tiene la factura del proveedor en la mano, es el único sitio donde **no** puede dar de alta lo que está recibiendo.

**H2 · Densidad de la línea.** `PurchaseLineItemsTable` muestra por línea: Moneda (USD/Bs), Modo (Unidad/Empaque), Tipo de empaque, Cantidad o Empaques + Uds/empaque, Costo unitario o por empaque, Costo auto en la otra moneda, Impuesto %, Subtotal y Total. Casi todo visible siempre. El 80 % de las compras de un abasto son "N unidades a X Bs"; los demás controles deberían aparecer solo al pedirlos.

**H3 · Dos monedas por línea.** El selector Moneda por línea más el campo auto en la otra moneda duplica la información y obliga a leer dos cifras por celda. La tasa ya está en el header; basta elegir la moneda una vez por compra y mostrar la conversión en el resumen.

**H4 · El estado "Pedido" no advierte que el stock no entra.** El select dice "Pedido (Pendiente por recibir)", pero tras guardar nada en el detalle grita que falta recibir. Está documentado como hipótesis H1 del plan de inventario: es muy probablemente una de las causas de "compré y no subió el stock".

**H5 · Sin pago inicial.** Existe `PurchasePaymentSection` ("Pago inicial opcional") pero no está montado en la página; el usuario confirma la compra y recién después descubre que tiene que ir a otra pantalla para pagarla.

**H6 · Sin borrador ni duplicar.** Una compra grande que se interrumpe se pierde; no se puede "repetir la compra de la semana pasada" con el mismo proveedor.

**H7 · Impuesto como número libre y desproporcionado.** No existe tabla de impuestos: `categories.tax_rate` es un `numeric(5,2)` libre entre 0 y 100, `app_settings.default_tax_rate` igual, y cada línea de compra guarda el `tax_rate` que el usuario teclee. El IVA venezolano tiene alícuotas **fijas** (general 16 %, reducida 8 %, exento/0 %; validar vigencia con el contador): permitir "13 %" o "20 %" es permitir un error. En pantalla, el "Impuesto" de cada línea es un `LineFieldBox` bajo el nombre del producto que ocupa **todo el ancho de la columna** para mostrar dos dígitos y un lápiz, y poner una compra exenta (muy común al comprar al mayor) exige tres gestos por línea.

**H8 · Cambios accidentales en líneas ya registradas.** Seis inputs `type="number"` por línea que guardan en cada `onChange`, sin confirmación ni "commit" al salir del campo. Dos causas concretas de "cambié algo sin darme cuenta": (a) con un campo numérico enfocado, **la rueda del ratón o el trackpad cambia el valor** (comportamiento nativo de `type="number"`, no está neutralizado en ningún input del repo); (b) `Tab` o un clic errado aterriza en la línea de arriba y la siguiente tecla la modifica. No existe forma de **bloquear una línea** como solo lectura una vez revisada; el usuario termina releyendo toda la compra para encontrar qué cambió.

### 3.2 Pagos (ventas y compras, totales y parciales) — Alta

**P1 · "Pagar" saca del documento.** `PurchaseDetailActionsMenu` → `router.push('/payments?purchaseId=…')`. El usuario pierde el contexto (qué compra, cuánto debe) y aterriza en una lista filtrada con un botón "Registrar pago".

**P2 · Modal genérico con ID a mano.** `RegisterPaymentModal` sin contexto fijo pide "Contexto: Venta/Compra" y un campo "ID compra" con placeholder `purchase-002`. Nadie en una bodega conoce el UUID de una compra. Si el usuario entra a `/payments` por el menú lateral y pulsa "Registrar pago", cae exactamente ahí.

**P3 · Monto sin prellenar ni "completar".** Muestra "Saldo pendiente actual" como texto, pero el campo Monto nace vacío y no hay botón para cargar el saldo, al contrario que en el POS, que sí tiene "Completar restante". Para pagos parciales no hay sugerencias (50 %, resto).

**P4 · Moneda del monto.** Para métodos bancarios el monto es en Bs; la compra se registró en REF (y el proveedor cobra en USD la mayoría de las veces). El usuario tiene que convertir mentalmente con la tasa del día. Debería poder escribir en REF o Bs y ver la equivalencia.

**P5 · Deuda invisible.** `PurchasesList` no tiene columna de pagado/saldo ni filtro "con saldo". La lista de ventas sí tiene "Pagado". Para saber a quién le debo hay que abrir compra por compra o el reporte de proveedores.

**P6 · Pago desde el detalle del contacto.** El detalle de proveedor muestra compras y pagos en tabs, pero no permite abonar desde ahí ("pagarle 100 REF a este proveedor y que se aplique a sus compras pendientes").

**C6 · Nada protege un proceso a medias.** No existe ningún guardia de salida en la app (`grep` de `beforeunload`, `isDirty`, `unsaved` en `src/` devuelve cero). Con una compra de 20 líneas a medio cargar, un carrito del POS con productos, un formulario de producto con cambios o el asistente de importación en el paso 3, un clic en el menú lateral, el botón "atrás", `F5` o cerrar la pestaña **pierden todo sin preguntar**. El POS persiste la clave de idempotencia del cobro (`saleAttempt.ts`) para no duplicar ventas, pero no el carrito. La compra no persiste nada.

### 3.3 Registro de productos y categorías — Media

**R1 · Formulario largo sin jerarquía.** `ProductFormModal`: imagen, nombre, SKU, código de barras, categoría, costo REF, precio REF, stock actual/inicial, stock mínimo, descripción, conversión de empaque. Todo en un modal, sin separar "lo imprescindible" (nombre, categoría, precio) de "lo avanzado".

**R2 · Sin categoría inline.** Si la categoría no existe, hay que cerrar el modal, ir a `/products/categories`, crearla y volver a empezar. La categoría además define el IVA, así que es obligatoria para que los costos cuadren.

**R3 · "Stock actual" vs "Stock inicial".** El mismo campo cambia de etiqueta según crear/editar. En edición, permitir escribir el stock a mano es la puerta trasera que descuadra el libro mayor (hipótesis H9 del plan de inventario). Debería ser solo lectura con un enlace "Ajustar stock" que genere movimiento.

**R4 · SKU.** Se autogenera desde el nombre (bien), pero es `required` y editable sin explicar que es interno; la mayoría de los usuarios solo tienen el código de barras.

**R5 · Alta por lotes.** El import Excel existe pero es tarea de escritorio. No hay "agregar varios productos seguidos" (guardar y crear otro).

### 3.4 Vínculo producto ↔ proveedor — Alta (por su efecto en compras)

**V1 · Tres modales para una relación.** `LinkSupplierProductModal` (producto, SKU proveedor, costo inicial, notas) + `ManageSupplierProductPackUnitsModal` (etiqueta, unidades por empaque) + `RegisterSupplierPriceModal` para cotizar. El concepto es valioso (historial de precios por proveedor, empaques), pero la **captura** debería ocurrir de forma implícita al comprar: la primera compra de un producto a un proveedor crea el vínculo, fija el costo y, si se compró por empaque, guarda el empaque.

**V2 · Escondido en Contactos.** El tab "Productos" dentro del detalle de un contacto es el único lugar para vincular desde el lado del proveedor. Desde el producto hay tabla de proveedores, pero tampoco se llega desde la compra.

**V3 · Vocabulario.** "Vincular", "cotizar", "metadatos", "empaques", "variación": lenguaje de sistema. El usuario piensa en "este proveedor me vende esto a tanto, en cajas de 12".

**V4 · Los proveedores no se pueden elegir al crear o editar el producto.** `ProductFormModal` no menciona proveedores (cero referencias). El vínculo solo existe desde el detalle del producto (tabla de proveedores + modal) o desde el contacto, y `supplier_products` no tiene noción de **proveedor habitual**: cuando un producto lo venden dos proveedores, nada indica a cuál se le compra normalmente, así que las sugerencias de reposición no saben a quién proponer.

### 3.5 Ventas (POS) — Baja/Media

**S1 · El POS es el mejor flujo**: caja obligatoria, cliente por defecto, escáner, carrito con REF+Bs, cobro con vuelto real por denominaciones, idempotencia. Mantenerlo como referencia de diseño para el resto.

**S2 · El cobro puede ser pesado para el caso simple.** El modal "Cobrar" muestra pad de billetes, vuelto, método del vuelto y denominaciones del vuelto. Para "pago móvil exacto" la mayor parte no aplica; hay atajos (`quickTenders`, prellenado del total en métodos bancarios), pero el modal no se encoge visualmente al caso simple.

**S3 · Admin sin POS.** Por diseño el rol admin no tiene `sales.create`. En una bodega de un solo cajero, cuando el cajero falta, el dueño no puede vender sin reasignar caja y permisos. Vale una decisión explícita de producto.

**S4 · Venta fiada.** La venta puede quedar `pendiente_pago`, pero no hay vista "cuentas por cobrar" por cliente con botón de abonar; el camino es cliente → tab Ventas → venta → Pagar → `/payments`.

### 3.6 Stock e inventario — Alta (por la queja reportada)

**I1 · Tres lugares, ninguna respuesta completa.** Productos (SKU, nombre, categoría, costo, PVP, stock, estado), Inventario (SKU, producto, categoría, stock actual, mínimo, estado) y detalle de producto repiten lo mismo. Ninguno muestra entradas/salidas del periodo ni el último movimiento. La pregunta real del usuario ("compré 24, vendí 10, ¿por qué dice 9?") exige ir a `/inventory/movements`, filtrar producto y reconstruir mentalmente.

**I2 · Movimientos sin filtros de servidor.** `useInventoryMovements` filtra tipo y fecha solo en cliente; con meses de historia la pantalla se vuelve lenta y confusa.

**I3 · Sin kardex visual en el detalle de producto.** `ProductDetailStockCard` muestra el número; el kardex (saldo tras cada movimiento) existe como vista SQL y como reporte, pero no está donde el usuario mira el producto.

**I4 · Sin alerta accionable.** "Stock bajo" aparece en dashboard y reportes, pero no hay botón "crear compra con estos productos" ni sugerencia de proveedor habitual.

### 3.7 Pantallas de detalle — Media

**D1 · Sin colapsables ni tabs (confirmado en código).** Detalle de producto: info, stock, conversión de empaque, cambio de precio, historial de precios, proveedores (tabla + tarjetas resumen), historial de ventas — todo expandido, ~2.100 líneas de componentes. Detalle de compra: cabecera, proveedor, fechas, financiero, estado de pago, banner, productos, pagos. Detalle de venta: 7 bloques + vista previa de recibo.

**D2 · Jerarquía plana.** Las tarjetas tienen el mismo peso visual; lo que importa (stock y precio en producto; saldo y estado en compra) no destaca.

**D3 · Acciones en menú "…".** Recibir, pagar, anular, devolver, PDF están en un `ActionsMenu` desplegable. La acción principal del estado (una compra `pedido` → "Recibir"; una venta `pendiente_pago` → "Cobrar") debería ser un botón primario visible.

**D4 · Enlaces cruzados incompletos.** Desde el detalle de compra se llega al proveedor, pero desde la tabla de productos de la compra no se llega al producto; desde el detalle de venta no se llega al producto ni al movimiento de stock que generó.

### 3.8 Listas y navegación — Baja/Media

**L1 · Lista de compras pobre.** Sin saldo, sin filtro de pago, sin rango de fechas visible (verificar `PurchasesListFilters`: solo búsqueda y estado).

**L2 · Menú de 13 entradas.** Inicio, Ventas, Mi caja, Cajas, Baúl, Compras, Inventario, Productos, Contactos, Pagos, Reportes, Configuración (+ Nómina, Asistente). "Pagos" como módulo de primer nivel es discutible: los pagos nacen de ventas y compras; como entrada propia invita al flujo genérico P2.

**L3 · Sin búsqueda global.** El header tiene la tasa del día pero no una búsqueda (producto por código, factura, proveedor).

**L4 · Sin "deshacer" ni confirmaciones graduadas.** Anular venta/compra pide confirmación en modal (bien); quitar una línea del carrito o de la compra no la pide (bien); pero recibir una compra, que mueve stock, no muestra qué va a entrar antes de confirmar.

### 3.9 Selectores con listas completas — Media (Alta con catálogos grandes)

**A1 · Selects nativos cargados con todos los productos o contactos.** `InventoryAdjustmentModal` (campo Producto), `InventoryPackConversionModal` (producto empaque), `ProductPackConversionFields` (Producto unidad) y `LinkSupplierProductModal` (Proveedor) usan `SelectField`/`<select>` con la lista completa. Con cientos de productos el desplegable es inservible: no filtra por SKU ni código de barras, no muestra stock ni precio para desambiguar, y obliga a desplazarse. Ya existe un `SearchAutocomplete` (usado en la compra y en el vínculo de productos) que resuelve el problema; no está generalizado. Regla propuesta: `SelectField` solo para listas cortas y fijas; cualquier entidad (producto, contacto, proveedor, usuario) se elige con autocomplete con búsqueda en servidor.

### 3.10 Precio y ganancia — Alta (afecta cada alta y cada cambio de precio)

**M1 · No se ve el porcentaje de ganancia.** La lista de productos muestra Costo y PVP en columnas separadas; el detalle muestra "Margen (REF)" como diferencia absoluta (`salePriceRef − costRef`), nunca como porcentaje, y en ningún sitio hay un indicador de si la ganancia es baja, media o alta. El usuario tiene que restar y dividir de cabeza producto por producto para saber dónde está perdiendo margen.

**M2 · El precio de venta se calcula con calculadora externa.** `ProductFormModal` (costo REF y precio REF como campos independientes) y `ProductDetailPriceChangeCard` (un solo input numérico de precio) no permiten escribir "quiero 30 % sobre el costo" y obtener el precio. El usuario calcula fuera del sistema, suma a mano y teclea el resultado; con cambios de costo frecuentes por compras nuevas, lo repite constantemente. Tampoco hay sugerencia de reprecio cuando una compra entra con un costo mayor al registrado.

### 3.11 Confirmaciones en operaciones clave — Alta

Inspección de todas las acciones que mueven stock, dinero o permisos, y de si piden confirmación y qué muestran.

**C1 · Confirman, pero sin mostrar el efecto.** Anular venta ("La venta quedará marcada como anulada. Esta acción no se puede deshacer."), devolver venta, cancelar compra, recibir compra ("La mercancía ingresará al inventario"), devolver compra, anular pago ("se ajustará el saldo del documento vinculado"), desvincular proveedor, desactivar/reactivar producto. Todas usan un texto genérico fijo. Ninguna dice *qué* va a pasar con *este* documento: cuántas unidades de qué productos vuelven o entran al stock, qué pagos quedan atrapados o se revierten, qué saldo de caja o baúl cambia. El usuario confirma a ciegas.

**C2 · No confirman nada.** Confirmar compra (el botón envía directo: mueve stock, fija costos, y con R1 también creará vínculos con el proveedor); cambio de precio de producto (inmediato); ajuste de stock; conversión empaque→unidad; retiro del baúl; transferir cierres al baúl; cambiar rol o desactivar usuario (un `<select>` con `onChange` que guarda al instante); cambiar IVA por defecto y métodos de pago habilitados.

**C3 · Confirmaciones nativas.** Desactivar o reactivar categoría usa `window.confirm` del navegador (`products/categories-list/page.tsx`, dos usos; son los únicos en `src/`): sin estilo, sin contexto, bloquea la pestaña y rompe el tema. Regla de producto: ninguna interfaz fuera del tema de la plataforma; toda confirmación, aviso o entrada pasa por componentes propios, y un lint lo garantiza.

**C4 · Confirmaciones que estorban.** Descargar PDF, imprimir e "Ir a pagos" piden confirmación. Confirmar lo inofensivo entrena al usuario a pulsar "Aceptar" sin leer, y devalúa las confirmaciones que sí importan.

**C5 · Confirmar venta en el POS, correctamente, no confirma.** Es un flujo rápido de cajero y debe seguir así; el riesgo se cubre con la caja abierta, el stock validado y la idempotencia. No tocar.

### 3.12 Reportes y dashboard — Media

Trece reportes (`reportCatalog.ts`) en un `<select>` plano, dos inputs de fecha nativos, resultado en `DataTable`, exportación PDF/Excel con vista previa. Dashboard con KPIs (hoy / ayer / rango / desde el inicio) y comparación con el periodo anterior, un gráfico de ventas, mix de pagos, ventas recientes y stock bajo. Base técnica correcta (vistas SQL, día operativo Caracas); el déficit es de lectura.

**G1 · Un solo gráfico en toda la app.** `DashboardSalesChartCard` es el único uso de Recharts, y es de **barras**: para ver picos y valles de venta por fecha, una línea con marcadores lee mejor y permite superponer el periodo anterior. Los trece reportes son tablas; ganancia bruta, métodos de pago, top productos y rentabilidad piden gráfico.

**G2 · Fechas sin atajos en reportes.** Dos `type="date"` nativos (UI del navegador, fuera del tema) y sin presets (hoy / ayer / semana / mes / mes pasado / 30 días), que el dashboard sí tiene.

**G3 · Sin comparación ni agrupación.** Ningún reporte compara con el periodo anterior ni agrupa por semana/mes.

**G4 · Catálogo plano.** Trece opciones sin agrupar ni describir; el usuario no sabe cuál responde su pregunta.

**G5 · Reportes que faltan para una bodega** (los datos ya existen): ventas por hora y por día de la semana; ventas y margen por categoría; cuentas por cobrar/pagar con antigüedad; productos sin movimiento y rotación; diferencias de cierre de caja (`theoretical_closing` vs `closing`, guardados y no reportados); mermas/ajustes por motivo. *Ventas por vendedor queda fuera por ahora: un vendedor por tienda.*

**Bien:** cierre del día como reporte compuesto; depreciación FX; comparación con periodo anterior en el dashboard.

### 3.13 Empaques surtidos (un empaque, varios productos) — Media

**E1 · La conversión empaque→unidad es estrictamente 1 a 1.** `product_pack_conversions` enlaza **un** producto empaque con **un** producto unidad (`units_per_pack`), con índices únicos en ambos lados: un empaque solo puede abrirse en un producto, y un producto unidad solo puede venir de un empaque. La RPC `convert_pack_to_units` reparte el costo del empaque entre esas unidades (promedio ponderado) y genera un par `conversion_salida`/`conversion_entrada`. El caso real de bodega no cabe: la **caja surtida** ("Refrescos sabores", 6 unidades: 2 cola, 2 manzana, 2 naranja) se factura como un solo producto pero se vende por unidad **por sabor**. Hoy el usuario tiene que elegir entre perder el detalle por sabor (vender "refresco sabores" genérico) o inventar compras ficticias por sabor para que el stock cuadre. Además, el contenido del surtido a veces varía entre cajas (3-1-2), y el modelo no permite declarar la distribución real al abrirla.

### 3.14 Filtros que se pierden al navegar — Alta (fricción en cada lista, varias veces al día)

**L5 · Ningún listado guarda su estado en la URL.** Los doce listados (productos, categorías, inventario, movimientos, contactos, ventas, compras, pagos, cajas, reportes, tiendas, usuarios) mantienen filtros, búsqueda, orden y página en `useState` / `usePaginationState` / `useSortState`, en memoria. Cero usos de `useSearchParams` o `router.replace(…?…)` en `src/modules/*/*-list/`. Al entrar al detalle de un producto y volver, el componente se monta de nuevo y el usuario encuentra la lista sin filtros, en la página 1 y con el orden por defecto. La única excepción parcial es Pagos, que lee `purchaseId`/`saleId` de la URL una sola vez al cargar y luego los pierde igual.

**L6 · El botón "Volver" no vuelve: va a la lista limpia.** `PageBackButton` es un `<Link href="/products">` fijo en todos los detalles (`ProductDetailPageHeader`, `SaleDetailHeaderCard`, `PurchaseDetailPageHeader`, `ContactDetailPageHeader`, `PaymentDetailPageHeader`, `InventoryMovementsPageHeader`). Aunque la lista guardara sus filtros en la URL, este botón los descartaría. Tampoco se restaura la posición de scroll.

---

## 4. Lo que está bien (no tocar)

- Modelo dual REF/Bs con snapshot de tasa en cada documento; conversión visible en todas partes.
- POS: gate de caja, cliente por defecto, escáner con cámara y lector, cobro con vuelto por denominaciones, idempotencia (`clientRequestId`) en ventas y compras.
- Patrón visual consistente (tokens, tarjetas, tablas → tarjetas en móvil, modo oscuro).
- Permisos por rol con overrides; vendedor solo ve clientes y cobros de venta.
- Documentación del repo y catálogo de módulos.

---

## 5. Recomendaciones priorizadas

Ordenadas por impacto en la queja reportada ÷ esfuerzo. Cada una es un ticket candidato para el plan de ejecución.

### Prioridad 1 — quita la mayor fricción (1–2 semanas)

| # | Recomendación | Cierra |
|---|---------------|--------|
| 1 | **Compra en un solo lugar.** En `/purchases/create`: buscar en **todos** los productos activos; si el producto no está vinculado al proveedor, se vincula al confirmar (costo = el de la línea, empaque = el usado). Botón "Nuevo producto" que abre `ProductFormModal` reducido (nombre, categoría, código de barras, precio) y lo agrega a la compra. | H1, V1, V2, R5 |
| 2 | **Línea de compra simple por defecto.** Visible: producto, cantidad, costo, total. Un chip "Empaque" convierte la línea a modo empaque; un chip "IVA" muestra el impuesto solo si difiere del de la categoría. Moneda de costo **una vez por compra** (toggle REF/Bs en el resumen), no por línea. | H2, H3 |
| 3 | **Pago sin salir del documento.** `RegisterPaymentModal` se abre dentro del detalle de compra y de venta con contexto fijo, saldo prellenado, botón "Completar saldo", chips 25/50/100 %, y monto en REF **o** Bs con equivalencia en vivo. Montar `PurchasePaymentSection` en la creación como "Pagar ahora" opcional. | P1, P3, P4, H5 |
| 4 | **Eliminar el modal genérico de pago.** En `/payments`, "Registrar pago" abre un buscador de documentos pendientes (venta/compra por número, cliente o proveedor), nunca un campo de ID. | P2 |
| 5 | **Lista de compras con saldo.** Columnas Pagado y Saldo, badge de estado de pago, filtro "con saldo pendiente" y rango de fechas. | P5, L1 |
| 6 | **Estado "Pedido" explícito.** Tras crear una compra `pedido`, banner amarillo fijo en el detalle "El inventario no ha cambiado. Recibir mercancía →" con botón primario; en la lista, badge distinto. | H4, D3 |

### Prioridad 2 — stock comprensible (1 semana)

| # | Recomendación | Cierra |
|---|---------------|--------|
| 7 | **Un solo lugar para stock.** `/inventory` pasa a ser la vista de stock por producto con columnas: stock, mínimo, **entradas 30 d, salidas 30 d, último movimiento**, y fila expandible con los últimos 10 movimientos (kardex inline). `/products` conserva catálogo y precios; su columna Stock enlaza a esa fila. | I1, I3 |
| 8 | **Kardex en el detalle de producto** como primera tarjeta tras el encabezado: saldo actual, gráfico de 30 días, últimos movimientos, enlace al reporte completo. | I3 |
| 9 | **Filtros de movimientos en servidor** (tipo, rango, producto, documento). | I2 |
| 10 | **Stock editable solo por movimiento.** En editar producto, "Stock actual" pasa a solo lectura + botón "Ajustar stock" (abre `InventoryAdjustmentModal`). | R3 |
| 11 | **Desde stock bajo a compra.** Botón "Crear compra con estos productos" que precarga líneas con el último proveedor conocido. | I4 |

### Prioridad 3 — detalles legibles (3–4 días)

| # | Recomendación | Cierra |
|---|---------------|--------|
| 12 | **Componente `CollapsibleSection`** en `src/shared/components/` (título, resumen de una línea cuando está cerrado, `defaultOpen`, recuerda estado por pantalla en `localStorage`). | D1 |
| 13 | **Detalle de producto en tabs**: Resumen (info + stock + precio) · Proveedores · Historial (precios y ventas) · Avanzado (empaques, imagen). | D1, D2 |
| 14 | **Detalle de compra/venta**: cabecera con las 4 cifras que importan (total, pagado, saldo, estado) y la **acción primaria del estado** como botón visible; el resto en secciones colapsables (productos abiertas, pagos abiertas si hay saldo, fechas/notas cerradas). | D2, D3 |
| 15 | **Enlaces cruzados**: producto ↔ compra ↔ venta ↔ movimiento de stock, en ambas direcciones. | D4 |

### Prioridad 4 — pulido

| # | Recomendación | Cierra |
|---|---------------|--------|
| 16 | Categoría inline desde el formulario de producto ("+ Nueva categoría" en el select). | R2 |
| 17 | Formulario de producto en dos niveles: básico visible, "Más opciones" colapsado (SKU, descripción, stock mínimo, empaque). | R1, R4 |
| 18 | Cobro del POS: el modal arranca en modo compacto (método + monto) y expande billetes/vuelto solo con efectivo y diferencia > 0. | S2 |
| 19 | Vista "Cuentas por cobrar / por pagar" por contacto con abono directo que se aplica a los documentos más antiguos. | S4, P6 |
| 20 | "Guardar y crear otro" en producto y contacto; "Duplicar compra" desde el detalle. | R5, H6 |
| 21 | Decidir y documentar si el admin puede vender (toggle en Configuración) para bodegas de un solo cajero. | S3 |
| 22 | Búsqueda global en el header (código de barras, SKU, N° factura, contacto). | L3 |
| 23 | Mover "Pagos" del menú principal a sub-sección de Reportes/Finanzas; conservar la ruta. | L2 |
| 24 | Al recibir una compra, mostrar qué cantidades van a entrar antes de confirmar. | L4 |
| 25 | **Autocomplete para entidades en todos los modales.** Componente `EntityAutocomplete` (producto/contacto, búsqueda en servidor, SKU y código de barras, detalle secundario, recientes, lector de barras) y migración de los cuatro selects detectados. | A1 |
| 26 | **Porcentaje de ganancia visible con semáforo.** Columna "Ganancia" en la lista de productos y en el detalle: `% = (PVP − costo) / costo`, ambos en REF (el costo ya incluye IVA desde `20260813b`); el Bs no interviene, con badge rojo / amarillo / verde según umbrales configurables (por defecto: rojo < 15 %, amarillo 15–24,9 %, verde ≥ 25 %, alineado a los rangos que usa el negocio: 10–12 / 20 / 30). Filtro "ganancia baja" en la lista. **Cola "Por revisar"**: al fijar un precio se guarda la banda; si una compra sube el costo y la banda baja (verde→amarillo, amarillo→rojo), el producto queda marcado ⚠ en lista, detalle y dashboard hasta que el admin reprecie o elija "Mantener precio". Nunca se cambia el precio solo. | M1 |
| 27 | **Calcular el precio desde el porcentaje.** Campo "% de ganancia" junto al precio en el formulario de producto, en cambio de precio y en "Nuevo producto" desde la compra, con chips de porcentajes recomendados (12 %, 20 %, 30 %, configurables, más el de la categoría si está definido). Elegir un chip o escribir el % completa el precio; editar el precio recalcula el %. Base del cálculo: `current_cost_ref` (ya con IVA). Tras recibir una compra con costo mayor, aviso con el margen resultante y botón "reprecio al X %". | M2 |
| 28 | **Confirmación con efecto visible en operaciones clave.** Componente único `ConfirmActionModal` con sección "Qué va a pasar" calculada para ese documento (productos y cantidades que entran/salen, pagos afectados, saldo de caja/baúl, costo y vínculo con proveedor, precio anterior → nuevo y % de ganancia), variante peligro para lo irreversible, y escritura de confirmación ("ANULAR") solo en anulaciones con dinero pagado. Añadirla donde falta (confirmar compra, cambio de precio, ajuste de stock, conversión, retiro y transferencias del baúl, rol/estado de usuario, IVA y métodos), quitarla de lo inofensivo (PDF, imprimir, navegar), reemplazar `window.confirm`. **Excluido: confirmar venta en el POS.** | C1–C5 |
| 29 | **Gráfico de ventas en línea** con marcadores en los picos, tooltip con fecha, REF/Bs y nº de ventas, y serie del periodo anterior superpuesta (atenuada). Mismo componente reutilizable para los reportes de serie temporal. | G1 |
| 30 | **Reportes legibles**: `DateRangeField` propio con presets y sin inputs nativos; catálogo agrupado (Ventas · Compras · Inventario · Dinero) con descripción de una línea; gráfico encima de la tabla en los reportes de serie o ranking; comparación con periodo anterior y agrupación día/semana/mes donde aplique. | G2, G3, G4 |
| 31 | **Reportes nuevos**: ventas por hora y día de la semana; ventas y margen por categoría; cuentas por cobrar y por pagar con antigüedad; productos sin movimiento / rotación; diferencias de cierre de caja; ajustes y mermas por motivo. Sin reporte por vendedor hasta que haya más de uno. | G5 |
| 32 | **Catálogo de alícuotas fijas, sin número editable.** Tabla `tax_rates` (código, etiqueta, %, activo) sembrada con Exento 0 %, Reducida 8 %, General 16 %; categorías, configuración y líneas de compra referencian una alícuota (con % congelado en la línea). En la compra, chip compacto junto al producto con la alícuota de la categoría preseleccionada y **chips alternativos** (Exento, Reducida…), nunca un input numérico. Toggle "Compra exenta" en la cabecera. Alta/baja de alícuotas solo desde Configuración por el admin. Migración de los valores libres existentes (16→General, 8→Reducida, 0→Exento; otros → revisión). | H7 |
| 33 | **Líneas bloqueables y edición segura.** Candado por línea (y "Bloquear todas / Desbloquear todas" en la cabecera): una línea bloqueada se muestra como solo lectura compacta (producto · cantidad · costo · total) y no responde a teclado ni rueda; se desbloquea con el candado o doble clic. Al agregar una línea nueva, las anteriores se bloquean automáticamente (opción por defecto, desactivable). Además, para **todos** los inputs numéricos del sistema: ignorar la rueda del ratón mientras el campo está enfocado, seleccionar el contenido al enfocar, `inputMode="decimal"`, y resaltar brevemente la celda que acaba de cambiar para que un cambio accidental sea visible. | H8 |
| 34 | **Empaque surtido con varios componentes.** Generalizar la conversión a cabecera + componentes: un producto empaque se abre en N productos unidad con una cantidad por defecto cada uno (2 cola, 2 manzana, 2 naranja). Al abrirlo, el usuario confirma o ajusta la distribución real (la suma debe coincidir con el total del empaque). El costo se reparte por unidad (o con pesos opcionales si un componente vale más). Un producto unidad puede venir de varios empaques (caja de solo cola y caja surtida). Opción "Desarmar al recibir" en la compra para los empaques que nunca se venden cerrados. Sin cambiar el modelo monetario ni el libro de stock: siguen siendo movimientos `conversion_salida`/`conversion_entrada` con el mismo `conversion_id`. | E1 |
| 35 | **Guardia de salida con proceso nombrado + borrador recuperable.** Un `ProcessGuard` que, mientras un proceso crítico está a medias (compra con líneas, carrito del POS con productos, formulario con cambios, importación en curso, pago/ajuste/cierre abiertos), intercepta la navegación interna (menú, enlaces, atrás) con un modal del tema: "Estás registrando una **compra a Distribuidora X con 12 líneas**. Si sales, se guarda como borrador / se perderá." con botones *Seguir aquí* y *Salir*. Al cerrar la pestaña o recargar, el navegador solo permite su aviso nativo (`beforeunload`), que es la única excepción admitida a la regla de cero diálogos nativos, y por eso se complementa con **borrador local automático** en compra y POS para que, aun saliendo, al volver se ofrezca restaurar. | C6 |
| 36 | **Proveedores en el formulario de producto + proveedor habitual.** Sección "Proveedores" en el formulario (crear y editar) con autocomplete de contactos proveedor/ambos, varios por producto, costo y SKU del proveedor opcionales, y una marca de **habitual** (uno por producto). Guardar crea o actualiza los vínculos `supplier_products`. El habitual alimenta el chip "Habitual" de la compra, la reposición desde stock bajo y el aviso de reprecio. | V4 |
| 37 | **Estado de lista en la URL y "Volver" que vuelve de verdad.** Hook compartido que sincroniza filtros, búsqueda, orden, página y tamaño de página con los parámetros de la URL en todos los listados (enlaces compartibles, recarga sin perder nada); `PageBackButton` que regresa a la URL exacta de la lista desde la que se abrió el detalle (con sus filtros), con la ruta limpia como respaldo cuando se llegó por enlace directo; restauración de la posición de scroll; y opcionalmente recordar los últimos filtros por lista al entrar desde el menú, con un chip visible para limpiarlos. | L5, L6 |

---

## 6. Métricas para validar las mejoras

Medir antes y después con usuarios reales (o con el eval de navegador del equipo de agentes):

| Métrica | Hoy (estimado desde el código) | Meta |
|---------|-------------------------------|------|
| Pantallas para comprar un producto nuevo y pagarlo | 5 | 1 |
| Campos visibles por línea de compra simple | 8–9 | 4 |
| Clics desde "detalle de compra" hasta pago registrado | 6–8 | 3 |
| Pantallas para responder "¿por qué este stock?" | 3 | 1 |
| Altura del detalle de producto (bloques expandidos) | 8 | 3 visibles + tabs |
| Compras en estado `pedido` olvidadas > 7 días | medir | 0 con el banner |
| Selects con lista completa de productos/contactos en modales | 4 | 0 |
| Productos con % de ganancia visible y semáforo | 0 % | 100 % |
| Pasos para fijar un precio con 30 % sobre el costo | calculadora + 1 campo | 1 chip |
| Operaciones que mueven stock/dinero sin confirmación con efecto visible | 10 | 0 |
| Confirmaciones en acciones inofensivas (PDF, imprimir, navegar) | 3 | 0 |
| Reportes con gráfico | 0 de 13 | todos los de serie o ranking |
| Inputs de fecha nativos en reportes | 2 | 0 |
| Gestos para marcar una compra exenta de IVA | 3 por línea | 1 por compra |
| Porcentajes de IVA tecleables a mano | en 3 sitios | 0 |
| Registrar una caja surtida y venderla por sabor | imposible sin compras ficticias | 1 compra + 1 apertura |
| Procesos críticos que se pierden al navegar o recargar sin aviso | todos | 0 |
| Listados que conservan filtros, orden y página al volver del detalle | 0 de 12 | 12 de 12 |
| Inputs numéricos que cambian con la rueda del ratón | todos | 0 |

---

## 7. Cómo ejecutar

Estas recomendaciones se pueden convertir en un plan `docs/agent-prompts/ux-compras-pagos-gtm.md` con el formato de los demás planes (fases, agentes, caos, QA, definición de hecho), empezando por la Prioridad 1. Las de Prioridad 2 dependen de que el plan de integridad de inventario (`stock-integrity-gtm.md`) haya cerrado, para no construir vistas de stock sobre datos descuadrados.
