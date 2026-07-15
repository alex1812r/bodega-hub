# Checklist de diseño Stitch — BodegaSync / Control Ventas

Inventario de pantallas y componentes UI generados en **Google Stitch**, contrastado con las rutas reales del ERP.

| Campo | Valor |
|-------|--------|
| Proyecto Stitch | **BodegaSync ERP Design System** |
| Project ID | `12828444962089869126` |
| Resource name | `projects/12828444962089869126` |
| MCP en Cursor | `project-0-control-ventas-stitch` |
| Última verificación MCP | 2026-07-04 |
| Total pantallas en Stitch | **43** (catálogo proveedor-producto M10–M14 + tab Productos) |

Referencias: [`modules-catalog.md`](modules-catalog.md), [`responsive-ui.md`](responsive-ui.md), [`stitch-theming.md`](stitch-theming.md) (tokens y plan de theming), [`stitch-prompts/README.md`](stitch-prompts/README.md) (textos para generar/editar en Stitch), rutas en `src/shared/components/AppShell/appShellNav.ts`.

---

## Resumen de verificación

| Área | Esperado | En Stitch | Estado |
|------|----------|-----------|--------|
| Pantallas principales (0–19) | 20 ítems | 20 | Completo |
| Wizard importación (5 pasos) | 5 | 5 | Completo |
| Modales recomendados + opcionales | 14 | 14 | Completo (M10–M14 catálogo proveedor) |
| Estados transversales | 1 | 1 | Completo |
| Móvil (mínimo recomendado) | 3 | 3 | Completo |
| Reportes 18a–18j (variantes) | 0 (omitido) | 0 | OK — una sola `/reports` |
| Auxiliares dev (`/api-docs`, `/dev/welcome`) | 0 | 0 | OK — no producto |
| Móvil extra (otros módulos) | opcional | 0 | Pendiente opcional |

**Conclusión:** El diseño cubre el producto operativo. No faltan pantallas obligatorias. Lo único pendiente son refinamientos opcionales (más breakpoints móvil, variantes “Editar” en modales si se quieren separadas de “Nuevo”).

---

## Leyenda

- [x] Generado en Stitch y verificado vía MCP (`list_screens`)
- [ ] Pendiente / no aplica
- **Opc.** — mejora opcional, no bloquea implementación

---

## Sistema y layout

| ID | Ruta / uso | Pantalla Stitch | Screen ID (sufijo) | Device |
|----|------------|-----------------|-------------------|--------|
| 0 | Shell autenticado | Layout Maestro - BodegaSync | `d82b6653f00a405c94c40d1e46a782c4` | DESKTOP |
| — | Design system | (tema en proyecto Stitch: indigo `#4F46E5`, Inter) | — | — |

---

## Módulos (pantallas)

| ID | Ruta app | Pantalla Stitch | Screen ID (sufijo) | Device | Notas |
|----|----------|-----------------|-------------------|--------|-------|
| 1 | `/login` | Iniciar Sesión - BodegaSync | `ac3f52c5fe2d472a9051ca68920b6092` | DESKTOP | Sin shell |
| 2 | `/dashboard` | Dashboard - BodegaSync | `9b9fae22fd0a4df1a44f322a828db3e0` | DESKTOP | |
| 3 | `/sales` | Listado de Ventas - BodegaSync | `ef95543eb9514d339d53c9e233a226c9` | DESKTOP | |
| 4 | `/sales/create` | Punto de Venta (POS) - BodegaSync | `ec082662ac554b468ecbe7aeabcd9db1` | DESKTOP | Carrito con montos REF + VES por línea (`PosCartLine`) |
| 4m | `/sales/create` | Punto de Venta (Móvil) - BodegaSync | `9821b81c38df40b1be605d7d99f7e3e5` | MOBILE | |
| 5 | `/sales/[id]` | Detalle de Venta - BodegaSync | `f07e58bcda6d4612a2563f2f138972a0` | DESKTOP | Incluye recibo |
| 6 | `/purchases` | Listado de Compras - BodegaSync | `da6e7e2537e64771bd4778dcfaaf7920` | DESKTOP | |
| 7 | `/purchases/create` | Registrar Compra - BodegaSync | `69eea028ac3d43f5977f7b1b45d1a87e` | DESKTOP | |
| 8 | `/purchases/[id]` | Detalle de Compra - BodegaSync | `abd4055c1b86428bab1119e875d6aa52` | DESKTOP | |
| 9 | `/inventory` | Inventario - BodegaSync | `f656b746c3df408a885a838423adaa0a` | DESKTOP | |
| 10 | `/inventory/movements` | Movimientos de Inventario - BodegaSync | `e28d2abad3d842c8a4c4a4fb55ec16f0` | DESKTOP | Rediseño completo; stub antiguo `951862590…` |
| 11 | `/products` | Listado de Productos - BodegaSync | `3c471938513149ecab7afcd1b1aba634` | DESKTOP | |
| 12 | `/products/[id]` | Detalle de Producto - BodegaSync | `c29446a6aae047c08f550bb9546cb0c6` | DESKTOP | Sección proveedores ampliada: `c1f402f699854714b91c00d0c344f001` |
| 13.1 | `/products/import` | Importar Productos - Paso 1: Plantilla | `230cdf04d16a4affbca44ee9ed1d686d` | DESKTOP | |
| 13.2 | `/products/import` | Importar Productos - Paso 2: Archivo | `f7a6fa28c83e4934bff289c2c092fb24` | DESKTOP | |
| 13.3 | `/products/import` | Importar Productos - Paso 3: Preview | `e4d19af43ac646ada0bbe25c031d391d` | DESKTOP | |
| 13.4 | `/products/import` | Importar Productos - Paso 4: Importación | `f373afae9cc44d64b5c5e40faf291242` | DESKTOP | |
| 13.5 | `/products/import` | Importar Productos - Paso 5: Resumen | `cfaacb31076c422bb7d18eb3e3e9d191` | DESKTOP | |
| 14 | `/contacts` | Listado de Contactos - BodegaSync | `e6ee7224f0254dee83ea5cdd9f7f5800` | DESKTOP | |
| 15 | `/contacts/[id]` | Detalle de Contacto - BodegaSync | `59001e477f854d0ab1a065d5c38c7c15` | DESKTOP | Tab Productos (proveedor): `f9f1abfd289c4c7f832b2256914cf49a` |
| 16 | `/payments` | Gestión de Pagos - BodegaSync | `02df6320d23e45c08df250a90eb96b37` | DESKTOP | |
| 17 | `/payments/[id]` | Detalle de Pago - BodegaSync | `ba43d217069244f49effccd98c65aad9` | DESKTOP | |
| 18 | `/reports` | Reportes - BodegaSync | `3f817dba28ce4a9f835493890abc0efa` | DESKTOP | Hub único (sin 18a–18j) |
| 19 | `/settings` | Configuración - BodegaSync | `fddeed35f7c146f8b30037d97d678d20` | DESKTOP | |

---

## Modales y overlays

| ID | Componente código | Pantalla Stitch | Screen ID (sufijo) | Prioridad | Código |
|----|---------------------|-----------------|-------------------|-----------|--------|
| M1 | `ContactFormModal` | Modal Nuevo Contacto - BodegaSync | `d9db1eecd94843f48a6c9e66a24e0e23` | Cubre crear/editar | [x] |
| M2 | `ProductFormModal` | Modal Nuevo Producto - BodegaSync | `f7fa6fd9abb14ef6a636b1ce8ea25423` | Cubre crear/editar | [x] |
| M3 | `RegisterPaymentModal` | Registrar Pago - BodegaSync | `30705a6e8f6c4bc191aca0659744de2c` | | [x] |
| M4 | `InventoryAdjustmentModal` | Ajuste de Stock - BodegaSync | `2774398070ae483a91ebe37703b562d6` | | [x] |
| M5 | `InventoryMovementDetailModal` | Modal Detalle de Movimiento - BodegaSync | `e10565e2aae94d6aaf27c35b3a88279d` | | [x] |
| M6 | `MobileNavDrawer` | Menú de Navegación Móvil - BodegaSync | `2b14558b3a3441bdb292e805898145b9` | MOBILE | [x] |
| M7–M9 | Confirmaciones (UI futura) | Modales de Confirmación - BodegaSync | `3f17ca71e5f54f979df6830458aa5ce1` | Anular venta/compra, desactivar producto | [ ] |
| M10 | `LinkSupplierProductModal` | Modal Vincular Producto Proveedor - BodegaSync | `1a9734e3e101478a9f140384f5a1f8c5` | Catálogo proveedor-producto | [x] |
| M11 | `RegisterSupplierPriceModal` | Modal Registrar Precio Proveedor - BodegaSync | `15bcbd1e92474f3786ab083e86028738` | Cotización / relevamiento | [x] |
| M12 | `EditSupplierProductModal` | Modal Editar Producto Proveedor - BodegaSync | `3a40ccd378d940a7bb24cd58b2594c03` | Metadatos (SKU, notas) | [x] |
| M13 | `UnlinkSupplierProductConfirmModal` | Modal Confirmar Desvincular Producto - BodegaSync | `c2bb41b29b5e478ab9d234a035e2a654` | Baja lógica | [x] |
| M14 | `SupplierProductPriceHistoryModal` | Drawer Historial Precios Proveedor - BodegaSync | `c32a96447c1e49ab9bcfa180a63e8bf1` | **Implementar como Modal** (no drawer) | [x] |
| 18k | Export reportes (UI futura) | Modal Exportar Reporte - BodegaSync | `3b66cb2c6f11431e9832c876e300c345` | | [ ] |

---

## Estados y responsive

| ID | Uso | Pantalla Stitch | Screen ID (sufijo) | Device |
|----|-----|-----------------|-------------------|--------|
| UX1 | Loading / error / empty | Estados UI - BodegaSync | `d5ab725b9ef446279267eb74a6e38f96` | DESKTOP |
| UX2 | Listado ventas móvil | Listado de Ventas (Móvil) - BodegaSync | `024c33bc52444242bdaae91f0f84ff80` | MOBILE |
| UX-SP1 | Empty catálogo proveedor | Empty state productos vinculados | `4b79ce0be0f648d79864871e23b496a7` | DESKTOP | Tab Productos / sección proveedores |
| 12-SP | `/products/[id]` proveedores | Detalle Producto - Proveedores Ampliado | `c1f402f699854714b91c00d0c344f001` | DESKTOP | Cards comparativas + tabla acciones |

---

## Omitido a propósito

| Ítem | Motivo |
|------|--------|
| 18a–18j (10 reportes separados) | Una ruta `/reports`; el hub basta |
| `/api-docs`, `/dev/welcome` | No son UI de producto |
| Storyboards F1–F6 | Flujos cubiertos por pantallas + modales |

---

## Pendiente opcional (no verificado en Stitch)

Mejoras de cobertura móvil o variantes; **no bloquean** alinear el código con Stitch.

| Ítem | Ruta | Notas |
|------|------|-------|
| **Opc.** | `/login` | Vista móvil 375px |
| **Opc.** | `/dashboard` | Vista móvil |
| **Opc.** | `/sales/[id]` | Detalle venta móvil |
| **Opc.** | `/purchases`, `/purchases/create` | Listado y crear compra móvil |
| **Opc.** | `/inventory`, `/inventory/movements` | Móvil |
| **Opc.** | `/products`, `/products/[id]` | Móvil |
| **Opc.** | `/contacts`, `/contacts/[id]` | Móvil |
| **Opc.** | `/payments` | Móvil |
| **Opc.** | `/reports` | Selector + tabla en móvil (código ya usa `SelectField`) |
| **Opc.** | `/settings` | Móvil |
| **Opc.** | M1 / M2 | Pantallas separadas “Editar contacto/producto” si se quiere arte distinto al crear |
| **Opc.** | — | Modal “Anular pago” (API aún no existe; botón disabled en app) |
| **Opc.** | 18a | Un **edit** en “Reportes” con tabla “Ventas diarias” si el hub no muestra datos de ejemplo |
| ~~Pend.~~ | `/contacts/[id]` tab Productos | ~~Catálogo proveedor-producto + M10–M14~~ | Ver M10–M14 + mapa [`stitch-prompts/supplier-products-stitch-map.md`](stitch-prompts/supplier-products-stitch-map.md) |

---

## Mapeo código ↔ Stitch (implementación)

| Módulo código | Archivo principal |
|---------------|-------------------|
| Login | `src/modules/auth/login/page.tsx` |
| Dashboard | `src/app/dashboard/page.tsx` |
| Ventas | `src/modules/sales/` |
| Compras | `src/modules/purchases/` |
| Inventario | `src/modules/inventory/` |
| Productos | `src/modules/products/` |
| Contactos | `src/modules/contacts/` |
| Pagos | `src/modules/payments/` |
| Reportes | `src/modules/reports/reports-list/page.tsx` |
| Settings | `src/modules/settings/settings-list/page.tsx` |
| Shell | `src/shared/components/AppShell/` |
| Modal | `src/shared/components/Modal/Modal.tsx` |

---

## Cómo reverificar en Cursor

```text
MCP server: project-0-control-ventas-stitch
Tool: list_screens
projectId: 12828444962089869126
```

Comprobar que cada pantalla tenga `screenshot.downloadUrl` y `htmlCode.downloadUrl`. Si falta HTML, regenerar o usar `get_screen` en esa pantalla.

---

## Historial

| Fecha | Acción |
|-------|--------|
| 2026-05-20 | Verificación MCP: 37 pantallas, checklist inicial |
| 2026-07-04 | Catálogo proveedor-producto: M10–M14 + tab Productos verificados vía MCP (43 pantallas); mapa en `docs/stitch-prompts/supplier-products-stitch-map.md` |
| 2026-07-04 | Catálogo proveedor-producto: tab Productos contacto, proveedores producto, modales M10–M14 verificados vía MCP |
| 2026-07-04 | M10–M14 + tab Productos (#15) + proveedores ampliado (#12): implementados en código |
| 2026-07-04 | POS: documentado dual currency REF/VES por línea en carrito (`PosCartLine`) |

Actualizar la tabla **Historial** y la fecha de **Última verificación MCP** cuando se agreguen o editen pantallas en Stitch.
