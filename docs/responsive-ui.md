# UI responsive — BodegaHub

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
| `AppShell` | `src/shared/components/AppShell/` | Sidebar desktop + `MobileNavDrawer`; en ambos el menú va en grupos colapsables (Operación, Dinero, Análisis, Configuración) |
| `GlobalSearch` | `src/shared/components/AppShell/GlobalSearch.tsx` | Buscador del header: campo visible desde `sm`; por debajo (390 px) solo la lupa, que al pulsarla abre el campo a todo el ancho del header |
| `PageHeader` | `src/shared/components/PageHeader/` | Título, descripción y acciones responsive |
| `DataTable` | `src/shared/components/DataTable/` | `layout="auto"` → tarjetas en `< md` |
| `useIsBelowMd` | `src/shared/hooks/useMediaQuery.ts` | Lógica JS cuando CSS no basta |
| `Pagination` | `variant="compact"` | Listados en pantallas estrechas |
| `CollapsibleSection` | `src/shared/components/CollapsibleSection/` | Secciones plegables de detalle, formulario y menú |
| `Tabs` | `src/shared/components/Tabs/` | Pestañas de detalle y de Configuración; la barra hace scroll horizontal en pantallas estrechas |
| `PrimaryStateAction` | `src/shared/components/PrimaryStateAction/` | Cabecera de detalle: cifras + acción primaria + menú secundario |
| `FloatingFieldNotice` | `src/shared/components/Input/` | Aviso de campo anclado, para celdas de tabla |

## DataTable

- **`layout="auto"`** (default): tarjetas si viewport `< md`, tabla si no.
- **`cardTitle` / `cardSubtitle`**: encabezado de cada tarjeta.
- **`columnVisibility`**: `"always" | "md" | "lg"` por columna en modo tabla.

## Patrones de pantalla

Patrones que usan las pantallas nuevas del plan ux-mejoras. Las APIs están en [`modules-catalog.md`](modules-catalog.md#componentes-compartidos).

### Secciones colapsables

- La cabecera entera es el botón (ancho completo, `aria-expanded`, teclado). Cerrada, muestra un **resumen de una línea** truncado; abierta, el resumen desaparece.
- El título parte palabras largas en vez de desbordar. Relleno `px-4` en móvil y `sm:px-6` desde `sm`.
- Con `storageKey` recuerda el estado por pantalla en `localStorage`. Regla de los detalles: abiertas las secciones con lo que se viene a ver (productos; pagos si hay saldo), cerradas fechas, notas y vistas previas.
- La apertura anima 200 ms y se desactiva con `prefers-reduced-motion`.
- Una tabla dentro de una sección sigue siendo `DataTable`: tarjetas por debajo de `md`.

### Pestañas (`Tabs`)

- La barra no envuelve: hace scroll horizontal propio (`overflow-x-auto`) y lleva la pestaña activa a la vista sin desplazar la página.
- Con `urlParam` la pestaña vive en la URL (`?tab=`): se puede compartir y sobrevive a recargar y a «Volver».
- Detalle de producto: 4 pestañas; detalle de contacto: hasta 6 según tipo y permisos; Configuración: 5.

### Cabecera de detalle (`PrimaryStateAction`)

- Tarjeta con, de arriba abajo: estado (badges), las cifras que importan (total, pagado, saldo, estado) en una rejilla que se reparte según el ancho, y una fila con el aviso, la **acción primaria del estado** y el menú «…» de acciones secundarias.
- Por debajo de `sm` esa fila se apila (aviso arriba, acciones debajo); desde `sm` va en una línea, con las acciones a la derecha.
- Una sola acción primaria por estado. Lo inofensivo (PDF, recibo) no confirma; lo que mueve stock o dinero abre `ConfirmActionModal`.
- «Recibir mercancía» de una compra en `pedido` no va en la cabecera: va en el banner de pedido, encima.
- `PageBackButton` vuelve a la lista con sus filtros, página y posición de scroll. Por debajo de 768 px el scroll se restaura después de que la tabla pase a tarjetas.

### Aviso flotante de campo

- Un campo puede llevar un aviso no bloqueante (`notice` de `Input`; lo usa `NumberInput` para el aviso de miles): borde ámbar y texto bajo el campo.
- En celdas de tabla y filas compactas se usa `noticePlacement="floating"` (`thousandsHintPlacement="floating"` en `NumberInput`): el aviso se pinta en un portal con `position: fixed`, anclado bajo el campo. No mueve la fila ni lo recorta un contenedor con scroll, y solo se ve con el foco o el puntero en el campo; el borde ámbar se queda.
- No sustituye al error: un error bloquea y va en línea.

### Contenedor de scroll del AppShell

- El `<main>` del `AppShell` es `relative`: es el bloque contenedor de sus descendientes `position: absolute` (por ejemplo los textos `sr-only`). Sin eso se colocaban respecto al documento, escapaban del recorte y a 390 px dejaban desplazar la aplicación entera hacia una zona en blanco.
- Consecuencia para pantallas nuevas: no hace falta (ni conviene) otro contenedor posicionado para «sujetar» elementos ocultos; lo que deba salirse del `<main>` (tooltips del riel, avisos flotantes, menús) va en portal con `position: fixed`.
- `ActionsMenu` se voltea hacia arriba cuando no cabe bajo la última fila.

### Anchos que se revisan

- **390 px**: sin scroll horizontal del documento; `Pagination` cabe entera; la línea de compra y los modales de dinero caben sin recorte.
- **1024 px**: `DataTable` tiene ancho mínimo; la columna Acciones puede quedar bajo scroll interno de la tabla, nunca fuera de alcance.
- **1280 px**: tabla completa con el menú lateral abierto.
- **Fuente al 130 %**: los flujos de compra y de cobro se midieron también así.

## Verificación manual

| Ancho | Casos mínimos |
|-------|----------------|
| 375px | Menú drawer, listado en cards, nueva venta sin scroll horizontal |
| 768px | Drawer, filtros 2 columnas |
| 1280px | Sidebar, tablas completas |

Ver también [web-app-build-checklist.md](web-app-build-checklist.md) §16.2.
