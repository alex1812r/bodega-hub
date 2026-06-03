# Importación masiva de productos (Excel)

Guía para el agente frontend: flujo UX, validaciones, hooks y contrato API.

Documentos relacionados:

- [`frontend-api-guide.md`](frontend-api-guide.md) — `POST /api/products`, permisos
- [`mock-api-endpoints.md`](mock-api-endpoints.md) — payload crear producto
- [`backend-api-agent-guide.md`](backend-api-agent-guide.md) — handler `GET /api/products/import/template`

## Resumen

El usuario descarga una plantilla Excel, la completa y la sube en `/products/import`. El navegador:

1. Descarga plantilla vía `GET /api/products/import/template` (fallback cliente si falla). **Generación:** exceljs (lista desplegable en columna `categoria`). **Lectura del archivo subido:** `xlsx`.
2. Parsea el `.xlsx` localmente (`xlsx`).
3. Valida cada fila (Zod + categorías + SKUs duplicados en archivo).
4. Muestra preview con errores por fila.
5. Importa **un producto por request** con `POST /api/products`.
6. Actualiza progreso en UI (`N/total`) sin WebSocket.

## Ruta y permisos

| Ruta | Permiso UI | API |
|------|------------|-----|
| `/products/import` | `products.manage` | `POST /api/products` por fila |
| Descarga plantilla | `products.view` (mismo usuario con manage) | `GET /api/products/import/template` |

Entrada: botón **Importar Excel** en listado de productos.

## Wizard (5 pasos)

| Paso | Id | Acción |
|------|-----|--------|
| 1 Plantilla | `template` | Descargar `.xlsx`; ver categorías disponibles |
| 2 Archivo | `file` | Dropzone `.xlsx` (drag-and-drop), máx. 500 filas |
| 3 Preview | `preview` | Tabla con badge válida / error / advertencia |
| 4 Importación | `importing` | Barra progreso, fila actual, cancelar |
| 5 Resumen | `summary` | Contadores, errores por fila, log CSV, volver al listado |

Estados del hook `useProductBulkImport`: `idle` → `parsing` → `validated` → `importing` → `done` | `cancelled` | `error`.

## Formato Excel

### Hoja `Productos`

Fila 1 = encabezados (exactos). Fila 2 = ejemplo. Fila 3+ = datos.

| Columna | Obligatorio | API field |
|---------|-------------|-----------|
| `sku` | Sí | `sku` |
| `nombre` | Sí | `name` |
| `categoria` | No | `categoryId` (lista desplegable; solo categorias del sistema) |
| `precio_ref` | Sí | `salePriceRef` |
| `costo_ref` | No | `currentCostRef` (default 0) |
| `stock_inicial` | No | `currentStock` (default 0) |
| `stock_minimo` | No | `minStock` (default 5) |

### Hoja `Categorias`

Listado de nombres validos y fuente del desplegable en columna `categoria` (validacion tipo lista en Excel).

### Hoja `Instrucciones`

Texto fijo con reglas de uso.

## Validaciones

| Capa | Dónde | Qué |
|------|-------|-----|
| 1 Archivo | Cliente | `.xlsx`, hoja `Productos`, headers correctos, ≤500 filas |
| 2 Fila | Cliente Zod | Tipos, rangos, SKU/nombre no vacíos, SKU único en archivo, categoría existente |
| 2b Advertencia | Cliente | SKU ya en BD (prefetch) → status `warning`, importable |
| 3 API | Servidor | 409 SKU duplicado, 400 Zod, 403 permiso |

## Política de errores en importación

Toggle antes de confirmar:

- **Continuar y resumir** (`onError: 'continue'`): registra fallo de la fila y sigue.
- **Detener en primer error** (`onError: 'stop'`): aborta el job al primer POST fallido.

Cancelar durante importación: `AbortController`; filas ya creadas permanecen.

## Archivos del módulo

```text
src/modules/products/products-import/
src/app/api/products/import/template/route.ts   # plantilla server-side
```

Ver árbol completo en el repo bajo `src/modules/products/products-import/`.

## Hook `useProductBulkImport`

```ts
const bulk = useProductBulkImport({ categories });

await bulk.downloadTemplate();           // API blob; fallback cliente + aviso
await bulk.parseFile(file);
await bulk.startImport({ onError: "continue" });
bulk.cancelImport();
// bulk.progress, bulk.results, bulk.templateDownloadMessage, bulk.isDownloadingTemplate
```

Invalidación: una sola `invalidateQueries(productsQueryKeys.all)` al terminar el job.

## Contrato API

### `GET /api/products/import/template` (implementado)

- **Handler:** [`src/app/api/products/import/template/route.ts`](../src/app/api/products/import/template/route.ts)
- **Permiso:** `products.view`
- **200** — body binario XLSX
- **Headers:** `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `Content-Disposition: attachment; filename="plantilla-productos.xlsx"`
- **Contenido:** hojas Productos, Categorias (activas desde mock/Supabase), Instrucciones

Frontend: `downloadProductImportTemplateFromApi` con `credentials: "include"`. Si falla, genera plantilla en cliente y muestra aviso en el wizard.

### `POST /api/products` (existente)

Un registro por fila importada. Body = `ProductInput`.

| HTTP | Código | UI |
|------|--------|-----|
| 201 | — | Fila éxito |
| 409 | `CONFLICT` | SKU duplicado en BD |
| 400 | — | Payload inválido |
| 403 | `FORBIDDEN` | Sin `products.manage` |

### `POST /api/products/import/validate` (opcional futuro)

No implementado. Validación batch server-side.

## Smoke manual

1. Login `admin@example.com` → `/products` → «Importar Excel»
2. Descargar plantilla → abrir Excel: 3 hojas, categorías reales en hoja Categorias
3. Completar 2–3 filas válidas + 1 fila con SKU vacío
4. Preview: contadores válida/error correctos
5. Importar con «Continuar y resumir» → barra progreso → resumen
6. `/products` lista los nuevos SKUs
7. Repetir SKU existente → advertencia en preview o 409 en resumen

E2E backend incluye `GET /api/products/import/template` en fase 4 (productos).

## Tests

- `src/app/api/products/import/template/route.test.ts`
- `productImportRowSchema.test.ts`
- `parseProductImportWorkbook.test.ts`
- `runProductImportJob.test.ts`
- `useProductBulkImport.test.tsx`
