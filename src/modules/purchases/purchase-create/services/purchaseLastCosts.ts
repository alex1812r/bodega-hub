import type { PurchaseLastCost } from "@/modules/purchases/services/purchaseLastCosts.mock-server";
import { apiFetch } from "@/shared/api/apiFetch";

import type { PurchaseCatalogProduct } from "../components/PurchaseProductPickerCard";
import { applyLastPurchaseCost } from "../utils/buildPurchaseCatalog";
import type { PurchaseProductResolutions } from "./resolvePurchaseProducts";

/** Tope de `productIds` de `GET /api/purchases/last-costs`. */
const MAX_LAST_COST_PRODUCT_IDS = 50;

/** Último costo de compra por id de producto; un producto nunca comprado no está. */
export type PurchaseLastCosts = Map<string, PurchaseLastCost>;

/**
 * `GET /api/purchases/last-costs`: el unitario SIN IVA de la última línea de compra
 * recibida de cada producto (de `supplierId` y, si no hay, de cualquier proveedor).
 * Una petición por cada 50 productos.
 */
export async function fetchPurchaseLastCosts(
  supplierId: string,
  productIds: string[],
): Promise<PurchaseLastCosts> {
  const ids = [...new Set(productIds)];
  const costs: PurchaseLastCosts = new Map();

  for (let start = 0; start < ids.length; start += MAX_LAST_COST_PRODUCT_IDS) {
    const batch = await apiFetch<PurchaseLastCost[]>("/api/purchases/last-costs", {
      query: {
        productIds: ids.slice(start, start + MAX_LAST_COST_PRODUCT_IDS).join(","),
        supplierId,
      },
    });

    for (const cost of batch) {
      costs.set(cost.productId, cost);
    }
  }

  return costs;
}

/** Un producto del catálogo con el costo sugerido de su última compra recibida, consultada ahora. */
export async function withLastPurchaseCost(
  supplierId: string,
  product: PurchaseCatalogProduct,
): Promise<PurchaseCatalogProduct> {
  const costs = await fetchPurchaseLastCosts(supplierId, [product.productId]);

  return applyLastPurchaseCost(product, costs.get(product.productId)?.unitCostRef);
}

/** Lo mismo para los productos activos de unas resoluciones (duplicar una compra). */
export async function withLastPurchaseCosts(
  supplierId: string,
  resolutions: PurchaseProductResolutions,
): Promise<PurchaseProductResolutions> {
  const activeIds = [...resolutions].flatMap(([productId, resolution]) =>
    resolution.status === "active" ? [productId] : [],
  );

  if (activeIds.length === 0) {
    return resolutions;
  }

  const costs = await fetchPurchaseLastCosts(supplierId, activeIds);

  return new Map(
    [...resolutions].map(([productId, resolution]) => [
      productId,
      resolution.status === "active"
        ? {
            product: applyLastPurchaseCost(resolution.product, costs.get(productId)?.unitCostRef),
            status: "active" as const,
          }
        : resolution,
    ]),
  );
}
