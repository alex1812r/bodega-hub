import { getPaginatedItems, type PaginatedList } from "@/lib/api/pagination";
import type { SupplierProduct } from "@/modules/contacts/types/supplierProducts";
import { apiFetch } from "@/shared/api/apiFetch";

import type { PurchaseCatalogProduct } from "../components/PurchaseProductPickerCard";
import { buildPurchaseCatalog } from "../utils/buildPurchaseCatalog";

export async function resolveSupplierCatalogProduct(
  supplierId: string,
  productId: string,
): Promise<PurchaseCatalogProduct | null> {
  const page = await apiFetch<PaginatedList<SupplierProduct>>(
    `/api/suppliers/${supplierId}/products`,
    {
      query: {
        isActive: "true",
        productId,
      },
    },
  );

  const catalog = buildPurchaseCatalog(supplierId, getPaginatedItems(page));
  return catalog[0] ?? null;
}
