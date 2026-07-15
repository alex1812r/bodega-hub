import type { SupplierProduct } from "@/modules/contacts/types/supplierProducts";

import type { PurchaseCatalogProduct } from "../components/PurchaseProductPickerCard";

export function buildPurchaseCatalog(
  supplierId: string,
  supplierRows: SupplierProduct[],
): PurchaseCatalogProduct[] {
  if (!supplierId) {
    return [];
  }

  return supplierRows
    .filter((row) => row.product)
    .map((row) => ({
      barcode: row.product?.barcode ?? null,
      defaultPackUnit: row.defaultPackUnit,
      name: row.product?.name ?? row.productId,
      packUnits: row.packUnits ?? [],
      productId: row.productId,
      sku: row.supplierSku ?? row.product?.sku ?? "—",
      unitCostRef: row.lastCostRef ?? 0,
    }));
}
