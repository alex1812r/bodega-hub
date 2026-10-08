import { getPaginatedItems, type PaginatedList } from "@/lib/api/pagination";
import type { SupplierProduct } from "@/modules/contacts/types/supplierProducts";
import type { ProductWithCategory } from "@/modules/products/hooks/useProducts";
import { apiFetch } from "@/shared/api/apiFetch";

import type { PurchaseCatalogProduct } from "../components/PurchaseProductPickerCard";
import { buildPurchaseCatalog, buildUnlinkedCatalogProduct } from "../utils/buildPurchaseCatalog";

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

export type PurchaseCodeResolution =
  | { product: PurchaseCatalogProduct; status: "found" }
  | { status: "ambiguous" | "not_found" };

function findActiveProductsByCode(filter: { barcode: string } | { sku: string }) {
  return apiFetch<PaginatedList<ProductWithCategory>>("/api/products", {
    query: { ...filter, isActive: true, limit: 2 },
  });
}

/**
 * Código leído o tecleado + Enter: producto ACTIVO de la tienda cuyo código de
 * barras (o, si no hay, SKU) coincide exacto. Con vínculo al proveedor sale con
 * su último costo y sus empaques; sin vínculo, con el costo actual del producto.
 */
export async function resolvePurchaseProductByCode(
  supplierId: string,
  code: string,
): Promise<PurchaseCodeResolution> {
  const trimmed = code.trim();

  if (!supplierId || !trimmed) {
    return { status: "not_found" };
  }

  let matches = getPaginatedItems(await findActiveProductsByCode({ barcode: trimmed }));

  if (matches.length === 0) {
    matches = getPaginatedItems(await findActiveProductsByCode({ sku: trimmed }));
  }

  if (matches.length > 1) {
    return { status: "ambiguous" };
  }

  const product = matches[0];

  if (!product || product.isActive === false) {
    return { status: "not_found" };
  }

  const linked = await resolveSupplierCatalogProduct(supplierId, product.id);

  return { product: linked ?? buildUnlinkedCatalogProduct(product), status: "found" };
}
