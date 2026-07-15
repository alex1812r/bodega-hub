# Mapa Stitch — Catálogo proveedor-producto (M10–M14)

| Campo | Valor |
|-------|--------|
| Proyecto | BodegaSync ERP Design System |
| Project ID | `12828444962089869126` |
| Verificado MCP | 2026-07-04 |

## Pantallas principales

| ID app | Pantalla Stitch | Screen ID | Componente código |
|--------|-----------------|-----------|-------------------|
| `/contacts/[id]` tab Productos | Detalle Contacto Proveedor - Tab Productos | `f9f1abfd289c4c7f832b2256914cf49a` | `ContactSupplierProductsTab` |
| `/products/[id]` proveedores | Detalle Producto - Proveedores Ampliado | `c1f402f699854714b91c00d0c344f001` | `ProductDetailSuppliersTable` + `ProductDetailSuppliersSummaryCards` |
| Empty state catálogo | No hay productos vinculados | `4b79ce0be0f648d79864871e23b496a7` | Empty en `ContactSupplierProductsTab` |

## Modales M10–M14

| Modal | Pantalla Stitch | Screen ID | Componente | Notas implementación |
|-------|-----------------|-----------|------------|----------------------|
| M10 Vincular | Modal Vincular Producto Proveedor | `1a9734e3e101478a9f140384f5a1f8c5` | `LinkSupplierProductModal` | Desde contacto: elige producto. Desde producto: elige proveedor. |
| M11 Registrar precio | Modal Registrar Precio Proveedor | `15bcbd1e92474f3786ab083e86028738` | `RegisterSupplierPriceModal` | Preview de variación vs precio actual. |
| M12 Editar | Modal Editar Producto Proveedor | `3a40ccd378d940a7bb24cd58b2594c03` | `EditSupplierProductModal` | Solo SKU + notas (sin precio directo). |
| M13 Desvincular | Modal Confirmar Desvincular Producto | `c2bb41b29b5e478ab9d234a035e2a654` | `UnlinkSupplierProductConfirmModal` | Patrón confirm danger como pagos. |
| M14 Historial | Drawer Historial Precios Proveedor | `c32a96447c1e49ab9bcfa180a63e8bf1` | `SupplierProductPriceHistoryModal` | **Modal** `sm:max-w-3xl`, no drawer lateral. |

## Mapeo columnas tab

| Columna Stitch | Campo API | UI |
|----------------|-----------|-----|
| Producto / Proveedor | `product.name` / `supplier.name` | Texto principal |
| SKU interno | `product.sku` | monospace |
| SKU proveedor | `supplierSku` | monospace o `—` |
| Último costo (REF) | `lastCostRef` | `formatRefUsd` |
| Variación | `variationPercent` | `SupplierProductVariationBadge` |
| Última actualización | `updatedAt` + `lastPriceOrigin` | fecha + `SupplierProductOriginChip` |
| Estado | `isActive` | `SupplierProductStatusBadge` |
| Acciones | — | `ActionsMenu` / menú fila |

## Permisos UI

| Acción | Permiso |
|--------|---------|
| Ver tab/tablas/historial | `products.view` |
| Vincular, precio, editar, desvincular | `products.manage` |

Referencia prompts: [`15-supplier-products-catalog.md`](15-supplier-products-catalog.md)
