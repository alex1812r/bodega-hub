# Design tokens — BodegaSync

Contrato visual alineado con **Google Stitch** (proyecto BodegaSync ERP Design System). Usar estos tokens en `src/shared/**` y módulos; evitar `blue-*` como color de marca.

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

- **Shell / login:** BodegaSync
- **Nombre legal en settings:** `businessName` (puede seguir siendo "Control Ventas ERP")

## Verificación

```bash
rg "blue-600" src/shared   # Gate_Foundation: debe ser 0
rg "blue-600" src/         # Cierre programa: debe ser 0
```

Referencias: [`stitch-design-checklist.md`](stitch-design-checklist.md), [`responsive-ui.md`](responsive-ui.md).
