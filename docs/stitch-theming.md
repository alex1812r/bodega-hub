# Theming — BodegaSync Design System (Stitch) vs código actual

Guía para alinear el theming de **Control Ventas** con el design system exportado desde Stitch MCP.

| Referencia | Valor |
|------------|--------|
| Proyecto Stitch | `12828444962089869126` — BodegaSync ERP Design System |
| Asset design system | `assets/5ca9ba327b4e4e96a1a28ab3b74016ef` |
| MCP | `project-0-control-ventas-stitch` → `list_design_systems` |
| CSS actual | [`src/app/globals.css`](../src/app/globals.css) |
| Checklist pantallas | [`stitch-design-checklist.md`](stitch-design-checklist.md) |

---

## Resumen ejecutivo

| Área | ¿Alineado? | Acción |
|------|------------|--------|
| Primary indigo `#4F46E5` | Sí (parcial) | Consolidar `blue-*` → tokens `primary` / `indigo-*` |
| Fuente Inter | Sí | Mantener; ajustar escala `Typography` opcional |
| Fondo app `#F8F9FF` | Parcial | `globals.css` sí; `AppShell` usa `bg-slate-50` |
| Sidebar `inverse_surface` #213145 | Sí | `AppSidebar` + `MobileNavDrawer` |
| Nav activo primary + barra 4px | Sí | `AppNavLinks` |
| Layout Maestro (shell/header) | Sí | Ver sección abajo |
| Success / warning / error | Sí (badges) | Mapear a tokens `secondary` / `tertiary` / `error` |
| Radio 4px botones/inputs | Sí | `rounded-md` ≈ 4px |
| Cards `rounded-2xl` | Más redondo que Stitch | Valorar `rounded-lg` (8px) en cards grandes |
| Tokens CSS completos | No | Ampliar variables desde `namedColors` |
| Dark mode | Parcial | Definir superficies Stitch en `.dark` |

---

## Tokens Stitch (MCP `list_design_systems`)

### Semántica de color (light)

| Token Stitch | Hex | Uso en ERP |
|--------------|-----|------------|
| `primary` | `#3525CD` | Texto/icono on-brand oscuro |
| `primary_container` | `#4F46E5` | Botones primary, links, ring |
| `on_primary` | `#FFFFFF` | Texto sobre primary |
| `secondary` | `#006C49` | Success / compras OK |
| `secondary_container` | `#6CF8BB` | Fondos success suaves |
| `overrideSecondaryColor` | `#10B981` | Alias marketing (emerald Tailwind) |
| `tertiary` / container | `#684000` / `#885500` | Warning |
| `overrideTertiaryColor` | `#F59E0B` | Amber alertas |
| `error` | `#BA1A1A` | Danger / anular |
| `surface` / `background` | `#F8F9FF` | Canvas app |
| `surface_container` | `#E5EEFF` | Cards elevadas, filas alternas |
| `surface_container_high` | `#DCE9FF` | Hover sutil |
| `on_surface` | `#0B1C30` | Texto principal |
| `on_surface_variant` | `#464555` | Texto secundario |
| `outline` | `#777587` | Bordes inputs |
| `outline_variant` | `#C7C4D8` | Bordes cards |
| `inverse_surface` | `#213145` | Sidebar oscuro |
| `overrideNeutralColor` | `#64748B` | Slate neutro |

### Tipografía (Inter)

| Token | Tamaño | Peso | Uso código sugerido |
|-------|--------|------|---------------------|
| `display-lg` | 36px / 28px móvil | 700 | `Typography` variant `display` |
| `headline-md` | 24px | 600 | `h1` páginas módulo |
| `headline-sm` | 20px | 600 | `h2` secciones |
| `body-lg` | 16px | 400 | Texto intro |
| `body-md` | 14px | 400 | **Default** tablas y forms |
| `label-md` | 14px | 500 | Labels formulario |
| `label-sm` | 12px | 600 + tracking | Headers tabla |

### Layout y forma

| Token | Valor Stitch | Código actual |
|-------|--------------|---------------|
| `sidebar-width` | 288px | `w-72` + `lg:pl-72` ✓ |
| `gutter` | 1.5rem (24px) | `lg:px-8` (32px) — ligeramente más ancho |
| `roundness` | ROUND_FOUR (4px) | inputs/buttons `rounded-md` ✓ |
| Cards grandes | 8px (`lg` en designMd) | `rounded-2xl` (16px) — más redondo |

### Componentes (guía Stitch)

- **Primary button:** `bg-primary` ([`Button.tsx`](../src/shared/components/Button/Button.tsx)) ✓
- **Secondary button:** blanco + borde (`border-border`) ✓
- **Sidebar / header:** alineado con pantalla **Layout Maestro** (`d82b6653…`) — [`AppSidebar`](../src/shared/components/AppShell/AppSidebar.tsx), [`AppHeader`](../src/shared/components/AppShell/AppHeader.tsx)
- **Form controls:** tokens compartidos en [`form-controls.ts`](../src/shared/styles/form-controls.ts) → Input, SelectField, Textarea
- **Modal overlay:** Slate-900 @ 40% → `bg-slate-950/50` ✓ aproximado
- **Badges success/warning:** emerald/amber → [`Badge.tsx`](../src/shared/components/Badge/Badge.tsx) ✓

---

## Código actual — qué ya coincide

```6:12:src/app/globals.css
:root {
  --background: #f8f9ff;
  --foreground: #0f172a;
  --primary: #4f46e5;
  --surface: #f8f9ff;
  --sidebar: #213145;
  --ring: #4f46e5;
}
```

- **Inter** cargada en [`layout.tsx`](../src/app/layout.tsx).
- **Botones primary** ya usan `indigo-600/700`.
- **Inputs** focus `indigo-600` + ring.
- **Badges** emerald / amber / red alineados con semántica Stitch.
- **Badges info** usan indigo (coherente con primary).

---

## Layout Maestro — BodegaSync (implementado)

Pantalla Stitch: `screens/d82b6653f00a405c94c40d1e46a782c4`.

| Pieza | Implementación |
|-------|----------------|
| Marca sidebar | `Store` + **BodegaSync** + rol (`userRole` desde `roleLabels`) |
| Nav | Hover `white/10`; activo `bg-primary` + `border-l-4 border-indigo-300` |
| Cerrar sesión | Footer del sidebar (desktop y drawer móvil) |
| Top bar | `h-16`, `bg-surface-container-lowest`, chip tasa REF/VES, usuario + `UserCircle` |
| Main | `bg-surface`, gutter `px-4 lg:px-6` |

---

## Brechas principales

### 1. Acentos `blue-600` sueltos en módulos

Aparecen en badges de página (`sale-create`, `product-details`, `AppSidebar` marca, `ProgressBar`, skeletons `DataTable`). Stitch usa **indigo** como marca.

**Aplicar:** reemplazo mecánico `blue-600` → `indigo-600` o clase `text-primary`.

### 5. Variables CSS incompletas

Solo 6 variables; Stitch expone ~30 `namedColors` + escalas de superficie.

**Aplicar:** ampliar `:root` y `.dark` (ver propuesta abajo).

### 6. Tipografía

`Typography` usa escalas Tailwind genéricas (`text-3xl` h1) no la escala exacta Stitch (`headline-md` = 24px).

**Aplicar (fase 2):** variantes alineadas a tokens o CSS variables `--text-headline-md`.

---

## Propuesta: `globals.css` ampliado

Copiar tokens desde MCP; mapear a Tailwind v4 `@theme inline`:

```css
:root {
  /* Superficies */
  --background: #f8f9ff;
  --foreground: #0b1c30;
  --surface: #f8f9ff;
  --surface-container: #e5eeff;
  --surface-container-high: #dce9ff;
  --surface-container-lowest: #ffffff;

  /* Marca */
  --primary: #4f46e5;
  --primary-foreground: #ffffff;
  --primary-dark: #3525cd;

  /* Semánticos */
  --secondary: #10b981;
  --secondary-foreground: #00714d;
  --tertiary: #f59e0b;
  --destructive: #ba1a1a;

  /* Neutros */
  --muted: #464555;
  --border: #c7c4d8;
  --input: #777587;
  --ring: #4f46e5;

  /* Shell */
  --sidebar: #0f172a;
  --sidebar-foreground: #e2e8f0;
  --sidebar-accent: #4f46e5;
}

.dark {
  --background: #020617;
  --foreground: #f8fafc;
  --surface: #0f172a;
  --surface-container: #1e293b;
  --primary: #6366f1;
  --ring: #818cf8;
  /* …completar desde designMd dark (slate-950 progresivo) */
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-tertiary: var(--tertiary);
  --color-destructive: var(--destructive);
  --color-muted: var(--muted);
  --color-border: var(--border);
  --color-sidebar: var(--sidebar);
  --color-surface-container: var(--surface-container);
  --color-ring: var(--ring);
}
```

Luego en componentes preferir `bg-background`, `border-border`, `text-muted` en lugar de `slate-*` literales donde tenga sentido.

---

## Plan de implementación por fases

### Fase 1 — Tokens + shell (alto impacto visual)

1. Ampliar [`globals.css`](../src/app/globals.css) con tabla anterior.
2. [`AppShell.tsx`](../src/shared/components/AppShell/AppShell.tsx): `bg-background`.
3. [`AppSidebar.tsx`](../src/shared/components/AppShell/AppSidebar.tsx) + [`MobileNavDrawer.tsx`](../src/shared/components/AppShell/MobileNavDrawer.tsx): tema oscuro + logo BodegaSync.
4. [`AppNavLinks.tsx`](../src/shared/components/AppShell/AppNavLinks.tsx): activo indigo + barra izquierda.
5. Buscar/reemplazar `blue-600` → `indigo-600` o `text-primary` en `src/`.

### Fase 2 — Superficies y densidad

1. Cards/tablas: fondo `bg-surface-container-lowest` o blanco con borde `border-border`.
2. Filas alternas tabla: `bg-surface-container` / `surface-container-low`.
3. Ajustar `rounded-2xl` → `rounded-lg` en `Card`, `DataTable`, `FilterPanel` si se quiere fidelidad Stitch 8px.

### Fase 3 — Tipografía y componentes

1. Alinear [`Typography.tsx`](../src/shared/components/Typography/Typography.tsx) a escala Stitch.
2. Headers tabla: `label-sm` uppercase tracking.
3. Documentar en Storybook variantes Button/Badge/Input vs Stitch.

### Fase 4 — Dark mode

1. Completar tokens `.dark` desde guía (superficies slate-950/900).
2. Revisar contraste sidebar y modales en dark.

---

## Tabla rápida Tailwind ↔ Stitch

| Stitch / diseño | Tailwind actual recomendado |
|-----------------|----------------------------|
| primary_container `#4F46E5` | `indigo-600` o `bg-primary` |
| secondary success `#10B981` | `emerald-500` / `Badge success` |
| tertiary warning `#F59E0B` | `amber-500` / `Badge warning` |
| error `#BA1A1A` | `red-600` / `Button danger` |
| surface `#F8F9FF` | `bg-background` |
| on_surface `#0B1C30` | `text-foreground` |
| outline_variant `#C7C4D8` | `border-slate-200` o `border-border` |
| inverse_surface sidebar | `bg-slate-900` / `bg-sidebar` |

---

## Cómo reverificar tokens en Stitch

```text
MCP: project-0-control-ventas-stitch
Tool: list_design_systems
projectId: 12828444962089869126
```

Revisar `designSystem.theme.namedColors`, `typography`, `spacing` y `designMd` (YAML embebido).

---

## Historial

| Fecha | Notas |
|-------|--------|
| 2026-05-20 | Comparación inicial MCP vs `globals.css` + AppShell + Button/Badge |
| 2026-05-20 | **Implementado** fases 1–3 en código; `jest.setup` fuerza `mock` + demo auth en tests |
