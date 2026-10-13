import { fetchAllPaginatedItems } from "@/lib/api/fetchAllPaginatedItems";
import type { SupplierProduct } from "@/modules/contacts/types/supplierProducts";
import type { ProductWithCategory } from "@/modules/products/hooks/useProducts";
import { apiFetch, ClientApiError } from "@/shared/api/apiFetch";

import type { PurchaseCatalogProduct } from "../components/PurchaseProductPickerCard";
import { buildPurchaseCatalog, buildUnlinkedCatalogProduct } from "../utils/buildPurchaseCatalog";

export type PurchaseProductResolution =
  | { product: PurchaseCatalogProduct; status: "active" }
  /** Inactivo o ya no existe; `name` es `null` si el servidor ya no lo conoce. */
  | { name: string | null; status: "unavailable" };

export type PurchaseProductResolutions = Map<string, PurchaseProductResolution>;

/** Productos sin vínculo que se consultan a la vez. */
const UNLINKED_BATCH_SIZE = 8;

async function resolveUnlinkedProduct(productId: string): Promise<PurchaseProductResolution> {
  try {
    const product = await apiFetch<ProductWithCategory>(`/api/products/${productId}`);

    return product.isActive === false
      ? { name: product.name, status: "unavailable" }
      : { product: buildUnlinkedCatalogProduct(product), status: "active" };
  } catch (error) {
    if (error instanceof ClientApiError && error.status === 404) {
      return { name: null, status: "unavailable" };
    }

    throw error;
  }
}

/**
 * Estado ACTUAL de unos productos para una compra a `supplierId`, tal como los
 * daría el buscador: con vínculo activo, su último costo y sus empaques; sin
 * vínculo, el costo actual del producto. Los inactivos o inexistentes salen
 * como `unavailable`. Lo usan restaurar el borrador y duplicar una compra.
 *
 * No hay consulta de productos por lista de ids: se leen los vínculos activos
 * del proveedor (páginas de 100) y, solo para los productos sin vínculo, su
 * ficha (`GET /api/products/[id]`) de `UNLINKED_BATCH_SIZE` en `UNLINKED_BATCH_SIZE`.
 */
export async function resolvePurchaseProducts(
  supplierId: string,
  productIds: string[],
): Promise<PurchaseProductResolutions> {
  const wanted = new Set(productIds);
  const resolutions: PurchaseProductResolutions = new Map();

  if (wanted.size === 0) {
    return resolutions;
  }

  const linkedRows = supplierId
    ? (
        await fetchAllPaginatedItems<SupplierProduct>(`/api/suppliers/${supplierId}/products`, {
          isActive: "true",
        })
      ).filter((row) => wanted.has(row.productId))
    : [];

  for (const product of buildPurchaseCatalog(supplierId, linkedRows)) {
    resolutions.set(product.productId, { product, status: "active" });
  }

  // Vínculo activo de un producto inactivo: `buildPurchaseCatalog` no lo ofrece.
  for (const row of linkedRows) {
    if (!resolutions.has(row.productId)) {
      resolutions.set(row.productId, { name: row.product?.name ?? null, status: "unavailable" });
    }
  }

  const unlinkedIds = [...wanted].filter((productId) => !resolutions.has(productId));

  for (let start = 0; start < unlinkedIds.length; start += UNLINKED_BATCH_SIZE) {
    const batch = unlinkedIds.slice(start, start + UNLINKED_BATCH_SIZE);
    const resolved = await Promise.all(batch.map(resolveUnlinkedProduct));

    batch.forEach((productId, index) => {
      resolutions.set(productId, resolved[index]);
    });
  }

  return resolutions;
}
