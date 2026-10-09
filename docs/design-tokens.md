# Design tokens — BodegaHub

Contrato visual alineado con **Google Stitch** (proyecto BodegaHub ERP Design System). Usar estos tokens en `src/shared/**` y módulos; evitar `blue-*` como color de marca.

## Marca

| Token | Valor | Tailwind / CSS |
|-------|--------|----------------|
| Primary | `#4F46E5` | `indigo-600`, `--primary` |
| Primary hover | — | `indigo-700` |
| Ring / focus | indigo | `--ring: #4F46E5`, `focus:ring-indigo-100` |

## Superficies

| Token | Valor | Uso |
|-------|--------|-----|
| App surface | `#F8F9FF` | Fondo shell autenticado (`bg-[#f8f9ff]`) |
| Page (alt) | `slate-50` | Login, páginas públicas |
| Card | `white` / `slate-900` (dark) | `Card` shared |
| Sidebar | `slate-900` | `AppSidebar`, drawer móvil |

## Semánticos

| Rol | Tailwind |
|-----|----------|
| Success | `emerald-*` |
| Warning | `amber-*` |
| Danger | `red-*` |
| Info | `indigo-50` / `indigo-700` |

## Tema oscuro

Los tokens de color viven en `src/app/globals.css`: `:root` (claro) y `.dark` (oscuro). **Toda variable de color de `:root` debe tener valor en `.dark`**; si falta, el token conserva el valor claro y el texto queda ilegible sobre fondo oscuro (SHR-13).

Paleta oscura: superficies `slate-950/900/800/700/600`, texto `slate-50/300/400`, primario `indigo-500`, contenedores semánticos `*-950` con texto `*-300` (igual que `Badge`).

### Superficies

| Token | Valor | Tailwind |
|-------|-------|----------|
| `--background`, `--surface-container-lowest` | `#020617` | `slate-950` |
| `--surface`, `--surface-container-low` | `#0f172a` | `slate-900` |
| `--surface-container`, `--surface-bright` | `#1e293b` | `slate-800` |
| `--surface-container-high`, `--surface-variant` | `#334155` | `slate-700` |
| `--surface-container-highest` | `#475569` | `slate-600` |

### Texto y bordes sobre superficies (ratio WCAG)

| Token | Valor | lowest / background | surface / low | container / bright | high / variant | highest |
|-------|-------|------|------|------|------|------|
| `--on-surface`, `--on-background`, `--foreground` | `#f8fafc` | 19.28 | 17.06 | 13.98 | 9.90 | 7.24 |
| `--on-surface-variant` | `#cbd5e1` | 13.59 | 12.02 | 9.85 | 6.97 | 5.10 |
| `--muted-foreground` | `#94a3b8` | 7.87 | 6.96 | 5.71 | 4.04 | 2.96 |
| `--outline` | `#94a3b8` | 7.87 | 6.96 | 5.71 | 4.04 | 2.96 |
| `--destructive`, `--error` | `#f87171` | 7.29 | 6.45 | 5.29 | 3.74 | 2.74 |
| `--stitch-secondary`, `--secondary-stitch` | `#34d399` | 10.49 | 9.29 | 7.61 | 5.39 | 3.94 |
| `--primary` | `#6366f1` | 4.52 | 4.00 | 3.27 | 2.32 | 1.70 |
| `--outline-variant` | `#475569` | 2.66 | 2.36 | 1.93 | 1.37 | 1.00 |
| `--border` | `#334155` | 1.95 | 1.72 | 1.41 | 1.00 | 1.37 |

Reglas que salen de la tabla:

- Texto secundario: `text-on-surface-variant` cumple AA (≥ 4.5) en todas las superficies. `text-muted-foreground`, `text-outline`, `text-destructive` y `text-error` solo hasta `surface-container`; no usarlos sobre `surface-container-high`, `surface-variant` ni `surface-container-highest`.
- Borde de control (input, checkbox, botón con borde): `border-outline` (≥ 3:1 hasta `surface-container-high`). `--border` y `--outline-variant` son separadores decorativos: no llegan a 3:1.
- `text-primary` solo cumple AA sobre `background` / `surface-container-lowest`.

### Pares contenedor / contenido

| Texto | Fondo | Ratio |
|-------|-------|-------|
| `--on-error` `#450a0a` | `--error` / `--destructive` `#f87171` | 5.84 |
| `--on-error-container` `#fca5a5` | `--error-container` `#450a0a` | 8.51 |
| `--error` `#f87171` | `--error-container` `#450a0a` | 5.84 |
| `--on-secondary-container` `#6ee7b7` | `--secondary-container` `#022c22` | 9.94 |
| `--secondary-stitch` `#34d399` | `--secondary-container` `#022c22` | 7.88 |
| `--on-tertiary-fixed` `#2a1700` | `--tertiary-fixed` `#ffddb8` | 13.34 |
| `--on-tertiary-fixed` `#2a1700` | `--tertiary-fixed-dim` `#ffb95f` | 10.12 |
| `--on-primary-fixed` `#0f0069` | `--primary-fixed-dim` `#c3c0ff` | 10.05 |
| `--on-surface` `#f8fafc` | `--tertiary-container` `#885500` | 6.00 |
| `--on-primary` `#ffffff` | `--primary` `#6366f1` | 4.47 |
| `--on-primary-container` `#e0e7ff` | `--primary-container` `#6366f1` | 3.63 |

Notas:

- Los roles `*-fixed*`, `--secondary`, `--tertiary` y `--tertiary-container` tienen el mismo valor en ambos temas. `--tertiary-container` es un **fondo**: como texto (`text-tertiary-container`) no se lee en oscuro (1.65–3.21) y necesita una clase `dark:` o un token propio.
- `--secondary` (`#10b981`) y `--tertiary` (`#f59e0b`) con texto blanco dan 2.54 y 2.15 en ambos temas.
- No existe `--on-tertiary-container`: la clase `text-on-tertiary-container` no genera CSS.

## Series de gráficos

Tokens `--chart-1` … `--chart-5` en `src/app/globals.css` (`:root` y `.dark`, también como colores del tema: `text-chart-1`, `bg-chart-2`…).

| Orden | Token | Tono | Claro | Oscuro |
|-------|-------|------|-------|--------|
| 1 | `--chart-1` | Índigo (= `--primary` de cada tema) | `#4f46e5` | `#6366f1` |
| 2 | `--chart-2` | Ámbar | `#a16207` | `#fbbf24` |
| 3 | `--chart-3` | Turquesa | `#0d9488` | `#99f6e4` |
| 4 | `--chart-4` | Fucsia | `#86198f` | `#f0abfc` |
| 5 | `--chart-5` | Pizarra | `#1e293b` | `#64748b` |

Contraste WCAG de cada serie sobre `--surface` / `--surface-container-lowest` (mínimo exigido 3:1, elemento gráfico):

| Token | Claro (`#f8f9ff` / `#ffffff`) | Oscuro (`#0f172a` / `#020617`) |
|-------|------|------|
| `--chart-1` | 5.98 / 6.29 | 4.00 / 4.52 |
| `--chart-2` | 4.69 / 4.92 | 10.69 / 12.08 |
| `--chart-3` | 3.56 / 3.74 | 14.16 / 16.00 |
| `--chart-4` | 7.84 / 8.24 | 10.15 / 11.47 |
| `--chart-5` | 13.92 / 14.63 | 3.75 / 4.24 |

Separación mínima entre dos series cualesquiera (ΔE\*ab CIE76; ≈ 2,3 es lo mínimo apreciable): 40 en claro y 49 en oscuro con visión normal; 33 / 35 con protanopia y 30 / 27 con deuteranopia (simulación de Machado 2009). `src/shared/components/charts/chartTheme.test.ts` lo recalcula leyendo `globals.css` y falla por debajo de 30 (visión normal), 25 (solo tono, sin luminosidad) y 20 (daltonismo).

Reglas:

- **Ningún gráfico escribe colores literales**: ni hex, ni `rgb()`, ni `color-mix()`, ni `var(--chart-N)` a mano. Se importa de `src/shared/components/charts/chartTheme.ts` (`CHART_SERIES_COLORS`, `getChartSeriesColor(index)`, `CHART_COLORS`, `CHART_TOOLTIP_COLORS`).
- **El orden es fijo**: la serie `i` usa `--chart-(i+1)`. Un gráfico de una sola serie usa `--chart-1`. No se salta ni se reordena para "elegir" un color.
- **Máximo 5 series** (`CHART_MAX_SERIES`). Con más categorías, agrupa el resto en "Otros" o usa una tabla; pasado el máximo la paleta se repite y deja de distinguir.
- El color nunca es la única pista: leyenda con nombre, tooltip y, para el periodo anterior, línea discontinua del mismo color (`CHART_PREVIOUS_SERIES_STYLE`), no otro token.
- Las series no significan estado: ninguna es el rojo de `--error` ni el verde de éxito. Para "bien / mal" se usan los semánticos, no `--chart-N`. Con deuteranopia el ámbar (`--chart-2`) queda cerca de `--error`: no pintes un error junto a una serie sin icono o texto.
- Al cambiar un valor, cámbialo en `:root` y en `.dark` y pasa `chartTheme.test.ts`.

## Tipografía

- **Familia:** Inter (`next/font/google`, variable `--font-inter`)
- **Fallback:** system-ui, sans-serif

## Layout

| Elemento | Medida |
|----------|--------|
| Sidebar ancho | 288px (`w-72`) |
| Nav iconos | 20px (`h-5 w-5`) |
| Item activo sidebar | borde izquierdo `border-indigo-500`, fondo `slate-800` |

## Modales

- Overlay: `bg-slate-950/40` (~40%)
- Móvil: sheet inferior (`bottom-0`, `rounded-t-2xl`, `max-h-[90vh]`)
- Desktop: centrado `max-w-lg`, `rounded-2xl`

## Nombre de producto

- **Shell / login:** BodegaHub
- **Nombre legal en settings:** `businessName` (puede seguir siendo "BodegaHub")

## Verificación

```bash
rg "blue-600" src/shared   # Gate_Foundation: debe ser 0
rg "blue-600" src/         # Cierre programa: debe ser 0
```

Referencias: [`stitch-design-checklist.md`](stitch-design-checklist.md), [`responsive-ui.md`](responsive-ui.md).
