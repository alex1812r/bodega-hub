# Prompts Google Stitch — BodegaSync

Textos listos para **Generate screen from text** o **Edit screen** en el proyecto Stitch **BodegaSync ERP Design System** (`12828444962089869126`).

Checklist de pantallas generadas: [`../stitch-design-checklist.md`](../stitch-design-checklist.md)

## Archivos

| Archivo | Contenido | Estado |
|---------|-----------|--------|
| [`00-global-context.md`](00-global-context.md) | Prefijo de contexto (producto, tokens, layout) | Referencia |
| [`00-design-brief.md`](00-design-brief.md) | Brief general del design system | Referencia |
| [`01-inventario-maestro-prompts.md`](01-inventario-maestro-prompts.md) | Prompts cortos pantallas 0–19, modales M1–M9, flujos F1–F6 | Base inicial |
| [`10-inventory-movements-redesign.md`](10-inventory-movements-redesign.md) | Rediseño completo movimientos (supersede #10 corto) | En Stitch + código |
| [`15-supplier-products-catalog.md`](15-supplier-products-catalog.md) | Tab Productos proveedor, proveedores en producto, M10–M14 | En Stitch + código |

## Convención de nombres

- `00-*` — contexto y brief transversal
- `01-*` — inventario maestro (generación inicial del ERP)
- `10-*`, `15-*` — prompts extendidos posteriores (rediseños o módulos nuevos)

## Prompts extendidos vs inventario maestro

El inventario maestro (`01`) tiene prompts **cortos** por pantalla. Cuando una pantalla necesita más detalle (stub, regresión, módulo nuevo), se agrega un archivo numerado aparte que **reemplaza** el prompt corto correspondiente.

| ID checklist | Prompt corto (01) | Prompt extendido |
|--------------|-------------------|------------------|
| #10 Movimientos | Sí | **10-inventory-movements-redesign** (usar este) |
| #15 Contacto tab Productos | Parcial en #15 corto | **15-supplier-products-catalog** (usar este) |
| #12 Producto proveedores | Parcial en #12 corto | Incluido en **15-supplier-products-catalog** |

## Historial

| Fecha | Acción |
|-------|--------|
| 2026-07-04 | Creación carpeta; migración desde chats; agregado prompt proveedor-producto |
| 2026-07-04 | Catálogo proveedor-producto (M10–M14) verificado en Stitch e implementado en código |
