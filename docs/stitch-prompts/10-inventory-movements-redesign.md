# Prompt — Movimientos de Inventario (rediseño completo)

| Campo | Valor |
|-------|--------|
| Ruta | `/inventory/movements` |
| Pantalla Stitch | Movimientos de Inventario - BodegaSync |
| Screen ID (stub) | `951862590f234ebfb93bca6ae93bfdf2` |
| Screen ID (completa) | `e28d2abad3d842c8a4c4a4fb55ec16f0` |
| Estado | Generado en Stitch; implementado en código |
| Tipo | ACTUALIZAR pantalla existente (no crear paralela) |

## Prompt (copiar y pegar en Stitch)

```
Rediseña COMPLETAMENTE la pantalla existente "Movimientos de Inventario - BodegaSync" 
(proyecto BodegaSync ERP Design System, screen ID 951862590f234ebfb93bca6ae93bfdf2).

La versión actual solo tiene shell + título + placeholder "Contenido de tabla omitido por brevedad".
Necesito el diseño COMPLETO y funcional de la pantalla, no un stub.

---

## Contexto del producto

ERP web "BodegaSync" para bodegas/retail en Venezuela.
Auditoría de inventario: cada cambio de stock (venta, compra, ajuste, devolución, inventario inicial) 
queda registrado como movimiento en `stock_movements` (kardex).

Ruta de la app: `/inventory/movements`
Permiso: `inventory.view`
Llegada típica: desde `/inventory` con link "Ver movimientos" o "Kardex" por producto (`?productId=...`).

---

## Pantallas de referencia (COPIAR patrón visual, no inventar otro estilo)

Usa el MISMO design system y layout maestro del proyecto:

1. **Layout Maestro - BodegaSync** (shell: sidebar 288px, header h-16, badge REF/VES)
2. **Gestión de Pagos - BodegaSync** (`02df6320…`) — patrón de:
   - panel de filtros horizontal siempre visible (sin colapsar)
   - tabla dentro de card `rounded-xl border bg-surface-container-lowest`
   - paginación pegada al borde inferior de la card (sin card anidada)
3. **Listado de Ventas - BodegaSync** (`ef95543e…`) — patrón de filtros con rango **Desde / Hasta**
4. **Inventario - BodegaSync** (`f656b746…`) — módulo padre; esta pantalla es sub-vista de inventario

NO uses sidebar de filtros como Inventario (existencias). 
Esta pantalla es un LISTADO transaccional como Pagos/Ventas.

Modal "Detalle de Movimiento" (M5, `e10565e2…`) YA EXISTE — no rediseñar modal aquí; 
solo prever acción "Ver detalle" por fila que abriría ese modal.

Modal "Ajuste de Stock" (M4, `2774398070…`) YA EXISTE — el botón "Ajustar stock" lo dispara.

---

## Design system (obligatorio)

- Fuente: **Inter**
- Primary / botones: **indigo `#4F46E5`** (`primary_container`)
- Success (entradas): **secondary `#006C49`** / `#10B981`
- Warning (salidas/ajustes negativos): **amber/tertiary**
- Info (ventas): **indigo suave**
- Fondo app: `#F8F9FF` (`surface`)
- Cards: `surface_container_lowest`, borde `outline_variant`, `rounded-xl`
- Sidebar: `inverse_surface` `#213145`
- Idioma UI: **español (Venezuela)**
- Device: **DESKTOP** 1440–2560px ancho
- Material Symbols Outlined para iconos

---

## Estructura de la pantalla (de arriba a abajo)

### 1. Page header (mantener lo que ya existe, pulir)

- Link secundario arriba del título: **"Volver a Inventario"** (con icono arrow_back) → navega a `/inventory`
- Título H1: **"Movimientos de Inventario"** (display-lg / headline-md)
- Subtítulo opcional (body-md, on-surface-variant): 
  "Historial auditable de entradas, salidas, ventas, compras y ajustes de stock."
- Acción primaria derecha: botón **"Ajustar stock"** (primary_container, icono edit_square)
  — abre modal M4, visible solo para rol con permiso de gestión (mostrar en diseño)

### 2. Panel de filtros — SIEMPRE VISIBLE

Card horizontal `rounded-xl border p-4 md:p-5`, grid responsive.

**IMPORTANTE — convención del producto:**
- NO incluir botón "Ocultar filtros", "Mostrar filtros", "Aplicar" ni "Limpiar"
- Los filtros aplican en tiempo real al cambiar valor (como Pagos/Ventas)
- Labels en label-md; inputs/selects con borde outline, altura ~40px

Campos (4 columnas en desktop, 2 en tablet, 1 en móvil):

| Campo | Control | Placeholder / opciones |
|-------|---------|------------------------|
| **Producto** | Select searchable | "Todos los productos" + ej: "Cable HDMI 2m (CBL-HDMI-2M)" |
| **Tipo de movimiento** | Select | "Todos los tipos" + ver lista abajo |
| **Desde** | Date input | vacío |
| **Hasta** | Date input | vacío |

Opciones de **Tipo de movimiento** (labels legibles en español):
- Ajuste entrada
- Ajuste salida
- Venta
- Compra
- Devolución cliente
- Devolución proveedor
- Inventario inicial

Estado de ejemplo en diseño: Producto = "Todos", Tipo = "Todos", fechas vacías.

### 3. Tabla de movimientos

Card contenedora única (`rounded-xl border bg-surface-container-lowest shadow-sm`).
Tabla full-width, headers en **label-sm uppercase** (#464555).

**Columnas:**

| Columna | Contenido | Notas |
|---------|-----------|-------|
| **Fecha** | `18/05/2026` | formato DD/MM/YYYY |
| **Producto** | Nombre producto | ej. "Taladro Percutor 850W" |
| **SKU** | Código mono | ej. `TAL-850W` — columna visible md+ |
| **Tipo** | Badge pill | ver semántica de colores abajo |
| **Cantidad** | Número con signo | `+10`, `-1`, `-6` — verde si positivo, rojo/amber si negativo |
| **Stock final** | Número | stock después del movimiento |
| **Motivo** | Texto truncado | "Sin motivo" si vacío; columna lg+ |
| **Referencia** | Link/código mono | `sale-002`, `purchase-001` o "—" — opcional md+ |
| **Acciones** | Menú ⋮ (3 dots) | "Ver detalle" |

**Badges de tipo (semántica):**
- `Compra`, `Ajuste entrada`, `Devolución cliente`, `Inventario inicial` → badge **success/verde**
- `Venta` → badge **info/indigo**
- `Ajuste salida`, `Devolución proveedor` → badge **warning/amber**

Hover fila: `bg-surface-container-low`.
Filas alternas sutiles opcionales.

**Menú acciones por fila:**
- Ver detalle (única acción por ahora)

### 4. Paginación (dentro de la misma card, borde superior)

Barra inferior plana, sin card extra:
- Izquierda: "Mostrando **1–10** de **47** movimientos"
- Derecha: selector "10 / 25 / 50" + botones Anterior / Siguiente
- Estilo coherente con Gestión de Pagos (variante stitch, compacta)

### 5. Estados vacíos y de carga

Incluir en el diseño (puede ser variante o anotación):

**Empty state** (tabla sin resultados):
- Título: "No hay movimientos para mostrar"
- Descripción: "Ajusta los filtros o registra un ajuste manual de stock."
- CTA secundario: "Ajustar stock"

**Loading:** skeleton de 5 filas en tabla

**Error:** banner inline rojo suave con "No pudimos cargar los movimientos" + botón Reintentar

---

## Datos de ejemplo (usar en la tabla)

Mostrar al menos 8 filas realistas:

| Fecha | Producto | SKU | Tipo | Cant. | Stock final | Motivo | Ref |
|-------|----------|-----|------|-------|-------------|--------|-----|
| 18/05/2026 | Taladro Percutor 850W | TAL-850W | Venta | -1 | 18 | — | sale-001 |
| 18/05/2026 | Cable HDMI 2m | CBL-HDMI | Venta | -1 | 4 | — | sale-002 |
| 17/05/2026 | Cable HDMI 2m | CBL-HDMI | Compra | +10 | 5 | — | purchase-001 |
| 17/05/2026 | Tubo PVC 1/2" | PVC-050 | Compra | +5 | 15 | — | purchase-002 |
| 16/05/2026 | Martillo de uña 16oz | MART-16 | Inventario inicial | +6 | 6 | Carga inicial de producto | — |
| 16/05/2026 | Martillo de uña 16oz | MART-16 | Ajuste salida | -6 | 0 | Conteo físico | — |
| 15/05/2026 | Martillo de uña 16oz | MART-16 | Devolución cliente | +1 | 1 | Devolución de venta V-000005 | sale-005 |
| 14/05/2026 | Interruptor simple | INT-SIM | Ajuste entrada | +5 | 30 | Ajuste por inventario | — |

Orden: más reciente primero (desc por fecha).

---

## Qué NO incluir en esta pantalla

- NO segunda tabla "Kardex base" debajo (el listado principal ES el kardex)
- NO panel colapsable de filtros con Aplicar/Limpiar
- NO diseño del modal de detalle (ya existe M5)
- NO diseño del modal de ajuste (ya existe M4)
- NO placeholder "Contenido omitido por brevedad"
- NO buscador global del header (ya existe en shell; no duplicar lógica de producto ahí)

---

## Navegación y flujos

1. Usuario en `/inventory` → clic "Ver todos los movimientos" → esta pantalla
2. Usuario en `/inventory` → acción fila "Kardex / movimientos" → esta pantalla con **Producto preseleccionado**
3. Clic "Ajustar stock" → modal M4
4. Clic ⋮ → "Ver detalle" → modal M5 (overlay; mostrar opcionalmente una fila con menú abierto como hint visual)
5. "Volver a Inventario" → `/inventory`

---

## Entregable

Pantalla desktop COMPLETA con:
- Shell BodegaSync (sidebar con "Inventario" activo)
- Header de página
- Filtros siempre visibles (4 campos)
- Tabla con 8+ filas de ejemplo y badges
- Paginación
- HTML exportable coherente con el resto del proyecto Stitch

Título final: **"Movimientos de Inventario - BodegaSync"**
Reemplazar el diseño stub actual, no crear una pantalla paralela con otro nombre.
```

---

## Notas

1. **Editar la pantalla existente** (`951862590…`) en lugar de crear una nueva, para no duplicar en el checklist.
2. Si Stitch permite **referenciar pantallas**, adjunta como contexto visual: Pagos (`02df6320…`) y Ventas (`ef95543e…`).
3. Tras generar, conviene verificar que el HTML **no** tenga el texto placeholder; debe traer tabla + filtros reales.
4. Cuando tengas el diseño, actualiza `docs/stitch-design-checklist.md` marcando la pantalla #10 como “completa” (no stub).
