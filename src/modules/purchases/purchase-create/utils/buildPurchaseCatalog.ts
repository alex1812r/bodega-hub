import type { SupplierProduct } from "@/modules/contacts/types/supplierProducts";
import type { ProductWithCategory } from "@/modules/products/hooks/useProducts";
import { roundMoney } from "@/shared/utils/currency";

import type { PurchaseCatalogProduct } from "../components/PurchaseProductPickerCard";

export const PURCHASE_CATALOG_LIMIT = 20;

/**
 * Costo de la línea (sin IVA) a partir de un costo que ya lo incluye.
 *
 * `supplier_products.last_cost_ref` y `products.current_cost_ref` se guardan
 * con el IVA de la línea (regla 10); la línea de compra pide el costo sin IVA y
 * le suma su alícuota. Sin este paso el IVA se aplicaría dos veces.
 */
export function netCostRef(costWithTaxRef: number, taxRate: number) {
  const cost = Math.max(0, costWithTaxRef);
  const rate = Math.max(0, taxRate);

  return roundMoney(cost / (1 + rate / 100));
}

/** Productos vinculados al proveedor, con el habitual primero. Nunca ofrece inactivos. */
export function buildPurchaseCatalog(
  supplierId: string,
  supplierRows: SupplierProduct[],
): PurchaseCatalogProduct[] {
  if (!supplierId) {
    return [];
  }

  return supplierRows
    .filter((row) => row.product && row.product.isActive !== false)
    .map((row): PurchaseCatalogProduct => {
      const taxRate = row.product?.taxRate ?? 0;
      const costWithTaxRef = row.lastCostRef ?? 0;

      return {
        barcode: row.product?.barcode ?? null,
        costWithTaxRef,
        currentStock: row.product?.currentStock ?? 0,
        defaultPackUnit: row.defaultPackUnit,
        link: row.isPreferred ? "preferred" : "linked",
        name: row.product?.name ?? row.productId,
        packUnits: row.packUnits ?? [],
        productId: row.productId,
        sku: row.supplierSku ?? row.product?.sku ?? "—",
        taxRate,
        unitCostRef: netCostRef(costWithTaxRef, taxRate),
      };
    })
    .sort(
      (left, right) =>
        Number(right.link === "preferred") - Number(left.link === "preferred"),
    );
}

/**
 * Producto de la tienda sin vínculo con el proveedor: entra por unidad, con el
 * costo actual del producto llevado a la misma base (sin IVA) que un vinculado.
 */
export function buildUnlinkedCatalogProduct(product: ProductWithCategory): PurchaseCatalogProduct {
  const taxRate = product.category?.taxRate ?? product.taxRate ?? 0;
  const costWithTaxRef = product.currentCostRef ?? 0;

  return {
    barcode: product.barcode ?? null,
    costWithTaxRef,
    currentStock: product.currentStock ?? 0,
    link: "none",
    name: product.name,
    packUnits: [],
    productId: product.id,
    sku: product.sku,
    taxRate,
    unitCostRef: netCostRef(costWithTaxRef, taxRate),
  };
}

/**
 * Resultado del buscador de la compra: los vinculados al proveedor primero
 * (habitual arriba) y después el resto de productos activos de la tienda.
 */
export function mergePurchaseCatalog(
  supplierId: string,
  supplierRows: SupplierProduct[],
  products: ProductWithCategory[],
  limit = PURCHASE_CATALOG_LIMIT,
): PurchaseCatalogProduct[] {
  if (!supplierId) {
    return [];
  }

  const linked = buildPurchaseCatalog(supplierId, supplierRows);
  // Tambien los vinculos de productos inactivos: asi el producto no reaparece como "sin vinculo".
  const linkedIds = new Set(supplierRows.map((row) => row.productId));
  const unlinked = products
    .filter((product) => product.isActive !== false && !linkedIds.has(product.id))
    .map(buildUnlinkedCatalogProduct);

  return [...linked, ...unlinked].slice(0, limit);
}
