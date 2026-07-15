# Stitch Design Brief — Control Ventas / Bodega ERP

## 1. Producto

| Campo | Valor |
|--------|--------|
| **Nombre comercial (PRD)** | BodegaSync |
| **Nombre en app (implementado)** | Control Ventas ERP |
| **Tipo** | ERP web para bodegas, minimarkets y almacenes (LatAm) |
| **Objetivo** | Ventas, inventario, compras, pagos y reportes con poca fricción para personal no técnico |
| **Stack real** | Next.js (App Router), React, Tailwind, TanStack Query, Supabase, Lucide |

**Mensaje de diseño:** “Simple como un POS, completo como un ERP” — no es solo caja; incluye compras, contactos, reportes y configuración.

---

## 2. Pilares (PRD → diseño)

1. **Simplicidad:** pocas decisiones por pantalla; venta en pocos pasos.
2. **Claridad visual:** stock bajo / agotado y estados de pago con color (badge chips).
3. **Tema claro/oscuro:** ya implementado; Stitch debe proponer variantes light + dark coherentes.
4. **Responsive:** móvil (drawer + cards), tablet, desktop (sidebar 288px).

---

## 3. Personas y permisos (impacta menú y pantallas)

| Persona | Rol en app | Ve en menú (típico) | Necesidad principal |
|---------|------------|---------------------|---------------------|
| Dueño de bodega | `admin` | Todo | Dashboard, reportes, settings |
| Vendedor | `vendedor` | Inicio, Ventas, Productos (lectura), Contactos (lectura), Pagos (lectura) | Registrar venta rápido |
| Almacén | `almacen` | Compras, Inventario, Productos | Stock y compras |
| Contador | `contador` | Pagos, Reportes, lecturas | Cobros y reportes |

**Nota UX:** el menú lateral se filtra por permisos; en móvil es **drawer hamburger**, no sidebar fijo.

---

## 4. Mapa de pantallas (lo que existe hoy — diseñar/refinar)

### Autenticación
- **Login** — email/password; panel branding solo desktop.

### Shell global (todas las pantallas autenticadas)
- **Header:** tasa REF/VES vigente, usuario, rol, salir, toggle tema.
- **Sidebar (desktop ≥1024px)** / **Drawer (móvil/tablet)** — 9 módulos máx.

### Módulos

| Módulo | Rutas | Pantallas clave |
|--------|-------|-----------------|
| **Dashboard** | `/dashboard` | 4 KPI cards, métricas rango, tablas “ventas recientes” y “stock bajo” |
| **Ventas** | `/sales`, `/sales/create`, `/sales/[id]` | Listado con filtros; **nueva venta** (cliente + carrito + totales ref/VES); detalle con ítems y pagos |
| **Productos** | `/products`, `/products/[id]`, `/products/import` | Listado; detalle; wizard import Excel |
| **Inventario** | `/inventory`, `/inventory/movements` | Stock actual; movimientos + kardex |
| **Contactos** | `/contacts`, `/contacts/[id]` | Clientes/proveedores; perfil con ventas/compras/pagos |
| **Compras** | `/purchases`, `/purchases/create`, `/purchases/[id]` | Listado; registro compra; detalle |
| **Pagos** | `/payments`, `/payments/[id]` | Listado; detalle; modal registrar pago |
| **Reportes** | `/reports` | Selector reporte + filtros fechas + tabla resultado |
| **Settings** | `/settings` | Datos negocio, usuarios, tasas de cambio |

---

## 5. PRD vs implementación (para el rediseño)

| Requisito PRD | Estado actual | Dirección Stitch |
|---------------|---------------|------------------|
| KPI: ventas día, beneficio, pendientes, stock bajo | Parcial — ventas, VES, pendientes, stock bajo (no “net profit” explícito como KPI) | Unificar cards y copy; añadir “utilidad” si producto lo pide |
| Últimas 5–10 facturas con chips | Sí — dashboard + listado ventas con badges estado | Refinar chips: pagada, pendiente, cancelada, devuelta |
| Alertas inventario | Sí — stock bajo en dashboard e inventario | Reforzar rojo/ámbar para agotado vs bajo |
| **POS: cliente “Consumidor final” por defecto** | **No implementado** — hay que elegir cliente siempre | **Diseño prioritario:** selector con default + búsqueda rápida |
| Picker producto +/- grande | Parcial — select + cantidad + “Agregar”; tabla carrito | Proponer UI tipo POS (grid productos, steppers grandes) |
| Totales tiempo real ref + moneda local | **Sí** — ref + VES con tasa en header y totales | Mantener dual currency visible en sticky bar móvil |
| CRUD productos en modales | Sí — modales crear/editar | Mantener patrón modal + form 2 cols desktop |
| Categorías producto | Sí | Chips/filtros en listado |
| Paleta Indigo #4F46E5 | **Código usa blue-600 / slate** (no indigo estricto) | Decidir: migrar a indigo PRD o documentar blue como marca |
| Success/warning/danger | Sí — emerald/amber/red en `Badge` | Alinear con PRD |
| Tipografía Inter/Geist | Sistema Next por defecto | Especificar Inter o Geist en design tokens |
| Sidebar navegación | Sí + drawer móvil | Diseñar ambos estados |
| Tablas con paginación | Sí — `DataTable`; cards en móvil | Cards con título + filas label/valor |
| Venta &lt; 15 s | Objetivo UX — flujo a optimizar en `/sales/create` | Wireframe POS compacto |

---

## 6. Design system (tokens para Stitch)

### Colores — PRD objetivo
- **Primary / brand:** `#4F46E5` (Indigo) — acciones principales, links activos menú  
- **Success:** `#10B981` — pagado, stock OK, agregar  
- **Warning:** `#F59E0B` — stock bajo, pendiente  
- **Danger:** `#EF4444` — cancelado, agotado, quitar  
- **Neutrals:** slate 50–950 (fondos, bordes, texto) — **ya en uso**

### Colores — implementación actual (referencia dev)
- Brand accent: `text-blue-600`, active nav `bg-blue-50 text-blue-700`
- Badges: emerald / amber / red / blue / slate
- Fondo app: `slate-50` light, `slate-950` dark

### Componentes reutilizables (nombres reales en código)
- `AppShell`, `PageHeader`, `Card`, `Button`, `Badge`, `DataTable` (+ cards móvil)
- `FilterPanel`, `Modal`, `SelectField`, `Input`, `Pagination`
- `EntityListPage`, `DetailSection`, `InfoGrid`, `EmptyState`, `ErrorState`

### Layout
- Sidebar ancho: **288px** (`w-72`)
- Contenido: padding `px-4` móvil, `px-8` desktop
- Border radius: `rounded-2xl` en cards/tablas
- Iconos: **Lucide** (outline, 16–20px en nav)

### Breakpoints
- Móvil &lt;768px: drawer, listados en cards, formularios 1 columna, CTA sticky en nueva venta/compra  
- Tablet 768–1023px: drawer, grids 2 cols  
- Desktop ≥1024px: sidebar + tablas completas  

---

## 7. Flujos prioritarios para diseñar en Stitch

### P0 — Vendedor (dueño del PRD “15 segundos”)
1. **Nueva venta (`/sales/create`)** — layout 2 columnas desktop (carrito | totales); móvil stack + barra fija “Registrar venta” + total ref.  
2. **Listado ventas** — filtros colapsables; cards móvil con factura, cliente, total, estado.  
3. **Dashboard vendedor/dueño** — 4 KPI + 2 tablas.

### P1 — Operación diaria
4. **Listado productos** + modal crear producto.  
5. **Inventario** — stock con badges agotado/bajo/ok.  
6. **Login** — simple, confiable, mobile-first.

### P2 — Back-office
7. **Detalle venta** — resumen + ítems + acciones (pago, anular).  
8. **Settings** — negocio + tasa cambio.  
9. **Reportes** — selector + filtros + tabla.

---

## 8. Pantallas sugeridas para generar en Stitch (prompts cortos)

Copia cada bloque como prompt de pantalla:

**A. Dashboard**  
“ERP dashboard for small grocery store. Four KPI cards: daily sales, total VES, pending payments, low stock count. Below: two sections — recent sales table (invoice, date, status chip paid/pending) and low stock products (SKU, name, quantity). Light and dark mode. Primary indigo #4F46E5, clean Inter font, sidebar navigation. LatAm Spanish labels.”

**B. POS — Nueva venta (prioridad)**  
“Mobile-first POS sale screen for bodega. Top: customer selector with default ‘Consumidor final’. Product search by name/SKU. Large +/- quantity steppers. Cart as cards on mobile, table on desktop. Right/bottom panel: discount, tax, subtotal in REF and VES. Sticky bottom bar on mobile: total + ‘Registrar venta’ button. Indigo primary, emerald success, minimal clicks.”

**C. Listado ventas**  
“Sales list page with filter panel (customer, status, date range). Data table desktop, card list mobile. Status badges: paid, pending payment, cancelled, returned. Primary action ‘Nueva venta’. ERP sidebar layout.”

**D. Login**  
“Simple login for ERP Control Ventas. Email and password, sign in button, light/dark. Professional blue/indigo brand, no clutter.”

**E. Inventario**  
“Inventory list with product name, SKU, current stock, minimum stock, status badge (out of stock / low / OK). Warning amber and danger red for alerts. Filters for search and low stock.”

---

## 9. Copy y locale

- **Idioma UI:** español (es-VE donde aplique fechas/moneda).  
- **Monedas:** REF (referencia) + **VES** con tasa oficial visible en header.  
- **Estados venta:** borrador, pendiente pago, pagada, cancelada, devuelta.

---

## 10. Fuera de alcance del rediseño visual (fase actual)

- PWA / app nativa  
- Bottom tab bar permanente  
- Export PDF/Excel en reportes (pendiente negocio)  
- MFA / registro usuarios  
- Middleware auth (solo backend + shell hoy)

---

## 11. Prompt maestro (un solo bloque para Stitch Project)

```
Design system and key screens for "Control Ventas ERP" (BodegaSync) — web ERP for Latin American small retail (bodegas, warehouses).

Audience: store owner (dashboard, reports) and seller (fast sales). Roles filter navigation.

Principles: minimal clicks for sales (<15s goal), clear stock/finance color coding, light + dark themes, responsive (mobile drawer + card lists, desktop 288px sidebar + tables).

Brand: primary indigo #4F46E5 (or align existing blue-600), success #10B981, warning #F59E0B, danger #EF4444, neutral slate surfaces. Typography Inter or Geist. Lucide icons.

Core screens: Login; Dashboard with 4 KPIs + recent sales + low stock; Sales list with filters; NEW SALE POS (default walk-in customer, product search, +/- qty, cart, REF+VES totals, mobile sticky CTA); Product list; Inventory with stock badges; App shell with sidebar (desktop) and hamburger drawer (mobile), header showing exchange rate REF/VES.

Language: Spanish. Components: cards, modals, badges, paginated tables/cards, filter panels.

Match modern SaaS ERP aesthetic — clean, trustworthy, not playful.
```

---

## 12. Cómo usar esto en Stitch

1. Crea un **proyecto** en [Stitch](https://stitch.withgoogle.com) llamado p. ej. “Control Ventas ERP”.  
2. Pega la sección **11** como descripción del proyecto.  
3. Genera pantallas **P0** (Dashboard, Nueva venta, Login) con los prompts de la sección **8**.  
4. Cuando tengas MCP con herramientas visibles, puedes iterar pantalla por pantalla contra este brief.

Si quieres, en un siguiente paso puedo guardar este texto en `docs/stitch-design-brief.md` en el repo o acortarlo a **solo 3 pantallas** para tu primera ronda en Stitch.

[REDACTED]