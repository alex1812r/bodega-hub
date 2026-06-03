# UI responsive — Control Ventas ERP

Contrato de breakpoints y patrones compartidos para móvil, tablet y desktop.

## Breakpoints (Tailwind)

| Viewport | Rango | Navegación | Listados | Formularios |
|----------|-------|------------|----------|-------------|
| Móvil | `< md` (< 768px) | Drawer (hamburger) | `DataTable` en tarjetas | Una columna; CTAs sticky cuando aplica |
| Tablet | `md` – `lg` (768–1023px) | Drawer | Tarjetas o tabla con columnas reducidas | Máx. 2 columnas en grids |
| Desktop | `≥ lg` (≥ 1024px) | Sidebar fijo 18rem | Tabla completa | Layout actual (2+ columnas) |

## Componentes

| Componente | Ubicación | Uso |
|------------|-----------|-----|
| `AppShell` | `src/shared/components/AppShell/` | Sidebar desktop + `MobileNavDrawer` |
| `PageHeader` | `src/shared/components/PageHeader/` | Título, descripción y acciones responsive |
| `DataTable` | `src/shared/components/DataTable/` | `layout="auto"` → tarjetas en `< md` |
| `useIsBelowMd` | `src/shared/hooks/useMediaQuery.ts` | Lógica JS cuando CSS no basta |
| `Pagination` | `variant="compact"` | Listados en pantallas estrechas |

## DataTable

- **`layout="auto"`** (default): tarjetas si viewport `< md`, tabla si no.
- **`cardTitle` / `cardSubtitle`**: encabezado de cada tarjeta.
- **`columnVisibility`**: `"always" | "md" | "lg"` por columna en modo tabla.

## Verificación manual

| Ancho | Casos mínimos |
|-------|----------------|
| 375px | Menú drawer, listado en cards, nueva venta sin scroll horizontal |
| 768px | Drawer, filtros 2 columnas |
| 1280px | Sidebar, tablas completas |

Ver también [web-app-build-checklist.md](web-app-build-checklist.md) §16.2.
