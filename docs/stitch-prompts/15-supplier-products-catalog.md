# Prompt — Catálogo productos por proveedor + historial de precios

| Campo | Valor |
|-------|--------|
| Rutas | `/contacts/[id]` (tab Productos), `/products/[id]` (Proveedores) |
| Pantallas a actualizar | Detalle de Contacto (`59001e477f854d0ab1a065d5c38c7c15`), Detalle de Producto (`c29446a6aae047c08f550bb9546cb0c6`) |
| Modales nuevos | M10–M14 (vincular, precio, editar, desvincular, historial) |
| Estado | **Pendiente** — enviar a Stitch |
| Tipo | ACTUALIZAR + CREAR modales |

## Prompt (copiar y pegar en Stitch)

```
Proyecto: BodegaSync ERP Design System
Project ID: 12828444962089869126
Resource: projects/12828444962089869126
Device: DESKTOP (1440px, usar Layout Maestro existente)
Idioma UI: español (Venezuela)
Moneda: REF (USD referencia) como principal; VES secundario donde aplique.

Necesito diseñar y/o ACTUALIZAR pantallas y modales para el módulo de 
"Productos que maneja un proveedor": catálogo por proveedor, registro de 
precios sin compra, historial de variaciones, edición y baja lógica.

IMPORTANTE: El shell (sidebar oscuro, header con tasa REF/VES, usuario) 
YA EXISTE en "Layout Maestro - BodegaSync" (screen d82b6653f00a405c94c40d1e46a782c4).
Solo diseña el CONTENIDO dentro de <main>. Mantener tokens del design system 
(indigo primary #4F46E5, Inter, superficies #F8F9FF, cards rounded-xl, 
Material Symbols Outlined).

---

## Contexto del producto

ERP web "BodegaSync" / Control Ventas para bodegas y retail en Venezuela.

Los proveedores son contactos con tipo "Proveedor" o "Ambos".
Cada proveedor puede manejar muchos productos del catálogo interno.
Cada producto puede tener varios proveedores (comparación de precios).

Flujo de negocio:
- Vincular un producto al proveedor SIN necesidad de registrar una compra.
- Registrar un nuevo precio/cotización del proveedor (puede ser mayor o menor al anterior).
- Ver historial de precios para detectar si el proveedor subió o bajó.
- Editar SKU del proveedor y metadatos.
- Desvincular producto del proveedor (baja lógica / inactivar), sin borrar historial.

Rutas app:
- /contacts/[id]  → detalle de contacto (proveedor)
- /products/[id]  → detalle de producto (vista espejo de proveedores)

Permisos UI:
- Ver: products.view
- Gestionar (vincular, precio, editar, desvincular): products.manage

---

## PANTALLAS A ACTUALIZAR

### 1) ACTUALIZAR: "Detalle de Contacto - BodegaSync"
Screen ID existente: 59001e477f854d0ab1a065d5c38c7c15
Ruta: /contacts/[id]

Mantener lo existente (perfil, métricas, tabs Actividad/Ventas/Compras/Pagos).

AGREGAR nueva pestaña en el bloque de tabs inferiores:
- Nombre tab: "Productos" (solo visible si el contacto es Proveedor o Ambos)
- Icono sugerido: local_shipping o inventory_2

Contenido del tab "Productos":

A) Barra superior del tab:
- Título: "Productos que maneja"
- Subtítulo: "Catálogo de productos y precios de cotización de este proveedor"
- Búsqueda inline: placeholder "Buscar por nombre o SKU..."
- Toggle/chip: "Solo activos" (on por defecto)
- Botón primary: "+ Vincular producto"

B) Tabla principal (DataTable estilo BodegaSync, como Pagos/Compras):

Columnas:
| Producto | SKU interno | SKU proveedor | Último costo (REF) | Variación | Última actualización | Estado | Acciones |

Detalle columnas:
- Producto: nombre + link visual (ej. "Harina Pan 1kg")
- SKU interno: monospace (ej. HP-001)
- SKU proveedor: monospace (ej. POL-HP-01) o "—"
- Último costo (REF): "$0.85" tabular-nums
- Variación: badge compacto respecto al precio anterior:
  • "↑ +8.2%" fondo error-container / texto error (subió)
  • "↓ -3.1%" fondo secondary-container / texto secondary (bajó)
  • "—" si es primer registro
- Última actualización: fecha + chip origen pequeño:
  • "Cotización" (outline)
  • "Compra" (secondary)
  • "Ajuste" (neutral)
- Estado: badge "Activo" (secondary) o "Inactivo" (outline gris)
- Acciones: IconButton more_vert (⋮) con menú:
  • Registrar precio
  • Ver historial
  • Editar
  • Desvincular (danger)

C) Fila expandible o drawer lateral al click "Ver historial":
Mini timeline / tabla de historial de precios DEL PAR proveedor-producto:
| Fecha | Precio anterior | Precio nuevo | Variación | Origen | Usuario | Notas |

D) Footer paginación (como otras listas):
"Mostrando 1-10 de 24 productos" + selector 10/25/50

E) Empty state (proveedor sin productos):
Ilustración simple + "Este proveedor aún no tiene productos vinculados"
+ botón "Vincular primer producto"

F) Ejemplo de proveedor en header de página (contexto visual):
Nombre: "Distribuidora Polar C.A."
Badge tipo: "Proveedor"
RIF: J-12345678-9

---

### 2) ACTUALIZAR: "Detalle de Producto - BodegaSync"
Screen ID existente: c29446a6aae047c08f550bb9546cb0c6
Ruta: /products/[id]

La sección "Proveedores Asociados" YA EXISTE pero está básica.
AMPLIARLA para que sea simétrica al tab de proveedor:

Mismas columnas que arriba pero desde perspectiva producto:
| Proveedor | SKU proveedor | Último costo (REF) | Variación | Última actualización | Estado | Acciones |

Agregar encima de la tabla un mini resumen comparativo (3 cards en fila):
- "Mejor precio": Mayorista La Yaguara — $0.82
- "Precio más alto": Distribuidora Polar — $0.88
- "Margen estimado": 32.5% (vs precio venta $1.20 del producto)

Botón "Vincular proveedor" (ghost, primary text) — habilitado.

Badge en fila más barata: "Más económico" (secondary-container).

---

## MODALES NUEVOS A CREAR

### M10 — Modal "Vincular producto al proveedor"
Título: "Vincular producto"
Descripción: "Asocia un producto del catálogo a este proveedor. No requiere registrar una compra."

Campos:
- Producto * (combobox/autocomplete con búsqueda: nombre + SKU)
- SKU del proveedor (opcional, placeholder "Código del mayorista")
- Costo inicial REF (opcional, placeholder "0.00")
- Notas (textarea opcional, 2 filas)

Helper text bajo costo:
"Si indicas un costo, se registrará como cotización inicial en el historial."

Footer:
- Cancelar (outline)
- Vincular producto (primary)

Estado validación: producto requerido; costo >= 0.

---

### M11 — Modal "Registrar nuevo precio"
Título: "Registrar precio"
Descripción: "Registra una cotización o relevamiento de precio. Se guardará en el historial."

Contexto en modal (read-only):
- Proveedor: Distribuidora Polar C.A.
- Producto: Harina Pan 1kg (HP-001)
- Precio actual: $0.85

Campos:
- Nuevo costo (REF) * (input numérico con prefijo $)
- Costo en VES (opcional, calculado o editable; helper "Tasa: 36.50 VES/REF")
- Fecha de relevamiento (date picker, default hoy)
- Origen (select): Cotización | Investigación de mercado | Ajuste manual
- Notas (textarea opcional)

Preview dinámico debajo del input (importante):
Si nuevo > actual → banner warning: "Incremento de +8.2% respecto al precio anterior ($0.85 → $0.92)"
Si nuevo < actual → banner success: "Reducción de -5.9% respecto al precio anterior"
Si igual → info: "Sin cambio respecto al precio actual"

Footer:
- Cancelar
- Registrar precio (primary)

---

### M12 — Modal "Editar relación proveedor-producto"
Título: "Editar producto del proveedor"
Solo edita metadatos, NO el precio (precio va en M11).

Campos:
- Producto (read-only)
- Proveedor (read-only)
- SKU del proveedor (editable)
- Notas (textarea)

Footer: Cancelar | Guardar cambios

---

### M13 — Modal confirmación "Desvincular producto"
Reutilizar estilo "Modales de Confirmación - BodegaSync" (3f17ca71e5f54f979df6830458aa5ce1).

Título: "Desvincular producto"
Descripción: "El producto dejará de aparecer en el catálogo activo de este proveedor. 
El historial de precios se conservará. Podrás reactivarlo después."

Mostrar: Proveedor + Producto + último costo.

Footer:
- Cancelar (outline)
- Desvincular (danger)

---

### M14 — Drawer o modal grande "Historial de precios del proveedor"
Título: "Historial de precios"
Subtítulo: "Distribuidora Polar C.A. · Harina Pan 1kg"

Gráfico simple opcional arriba (sparkline o barras mini) mostrando evolución últimos 6 registros.

Tabla:
| Fecha | Anterior (REF) | Nuevo (REF) | Δ % | Origen | Usuario | Notas |

Filas ejemplo:
- 04/07/2026 | $0.85 | $0.92 | +8.2% ↑ | Cotización | Admin | Subió en mayorista
- 15/06/2026 | $0.88 | $0.85 | -3.4% ↓ | Compra | Sistema | OC-0042 recibida
- 01/05/2026 | — | $0.88 | — | Cotización | Almacén | Relevamiento inicial

Badge origen por fila (Cotización / Compra / Ajuste).

Footer drawer: Cerrar | botón "Registrar nuevo precio" (abre M11)

---

## DATOS DE EJEMPLO (usar en mocks del diseño)

Proveedor principal:
- Distribuidora Polar C.A. (J-12345678-9)

Productos vinculados:
1. Harina Pan 1kg | HP-001 | POL-HP-01 | $0.85 | ↑ +8.2% | 04/07/2026 | Cotización | Activo
2. Aceite Vegetal 900ml | AC-014 | POL-AC-14 | $1.45 | ↓ -2.0% | 28/06/2026 | Compra | Activo
3. Café Molido 500g | CF-220 | POL-CF-22 | $2.10 | — | 10/05/2026 | Cotización | Activo
4. Detergente 1kg | DT-088 | POL-DT-88 | $0.95 | ↑ +12.0% | 01/04/2026 | Cotización | Inactivo

Segundo proveedor (en detalle producto):
- Mayorista La Yaguara | YAG-HP-01 | $0.82 | badge "Más económico"

Precio venta producto ejemplo: $1.20 REF (para card margen estimado)

---

## ESTADOS UI A INCLUIR (screenshot o variantes)

1. Tab Productos con datos (estado normal)
2. Empty state sin productos
3. Modal M11 con preview de incremento de precio (warning)
4. Drawer M14 con historial completo
5. Fila con producto Inactivo (opacity reducida o line-through suave en nombre)

NO incluir estados loading skeleton a menos que sea trivial; priorizar contenido.

---

## CONVENCIONES VISUALES (igual que resto del ERP)

- Tablas: header bg-surface-container-low, filas hover, acciones more_vert al hover
- Montos REF: prefijo $, tabular-nums, alineación derecha en columnas numéricas
- Badges variación: compactos, no gritones; usar error para subida, secondary para bajada
- Botones: primary indigo, danger rojo #BA1A1A para desvincular
- Cards resumen comparativo: border outline-variant, rounded-xl, padding 16px
- Modales: mismo patrón que "Modal Nuevo Contacto" y "Registrar Pago"
- Espaciado: gutter 24px, max-width container 1280-1440px centrado

---

## NO HACER

- No rediseñar sidebar ni header global
- No inventar flujo de compra en estas pantallas (solo referencia chip "Compra" en historial)
- No mobile en esta iteración (solo desktop)
- No stub con "contenido omitido por brevedad"
- No mezclar precio de VENTA al cliente con costo de PROVEEDOR (son conceptos distintos;
  precio venta vive en detalle producto, costo proveedor en este módulo)

---

## ENTREGABLES ESPERADOS

1. Pantalla actualizada: Detalle de Contacto con tab "Productos" completo
2. Pantalla actualizada: Detalle de Producto con sección Proveedores ampliada + resumen comparativo
3. Modales M10, M11, M12, M13, M14 (pantallas separadas o componentes en el mismo proyecto Stitch)
4. HTML exportable + screenshot de cada una

Nombres sugeridos en Stitch:
- "Detalle Contacto Proveedor - Tab Productos - BodegaSync" (UPDATE 59001e...)
- "Detalle Producto - Proveedores Ampliado - BodegaSync" (UPDATE c29446a...)
- "Modal Vincular Producto Proveedor - BodegaSync" (NEW M10)
- "Modal Registrar Precio Proveedor - BodegaSync" (NEW M11)
- "Modal Editar Producto Proveedor - BodegaSync" (NEW M12)
- "Modal Confirmar Desvincular Producto - BodegaSync" (NEW M13)
- "Drawer Historial Precios Proveedor - BodegaSync" (NEW M14)
```

---

## Notas

1. **Prioridad:** si Stitch limita pantallas por prompt, divide en 2 envíos: (A) tab Productos en contacto + modales M10–M13, (B) update detalle producto + drawer M14.
2. Tras generar, actualiza `docs/stitch-design-checklist.md` con los nuevos Screen IDs (como hicimos con movimientos cuando el ID cambió).
3. El shell lo ignora el código (`AuthenticatedAppShell`); solo implementamos el contenido de `<main>`.
