import type { RestockLine } from "@/modules/inventory/restock";

import type { PurchaseLinesSnapshot } from "../hooks/usePurchaseLines";
import type { PurchaseProductResolutions } from "../services/resolvePurchaseProducts";
import {
  createUnitDraftItem,
  type PurchaseCostCurrency,
  type PurchaseLineCatalogMeta,
} from "../types";
import { EMPTY_PURCHASE_LOCK_STATE } from "./purchaseLineLocks";
import { EMPTY_PURCHASE_REVIEW_STATE, settlePurchaseLines } from "./purchaseLineReview";
import { EMPTY_PURCHASE_TAX_STATE } from "./purchaseLineTax";

export const RESTOCK_UNAVAILABLE_MESSAGE =
  "La selección de reposición ya no está disponible. Vuelve a crearla desde Inventario.";

/** Aviso mientras la reposición espera a que se elija el proveedor. */
export function describeRestockAwaitingSupplier(lineCount: number) {
  return lineCount === 1
    ? "Elige el proveedor para cargar 1 producto de la reposición"
    : `Elige el proveedor para cargar ${lineCount} productos de la reposición`;
}

/** Productos de la reposición que no entraron (inactivos, borrados o no comprables). */
export function describeRestockOmitted(count: number) {
  return count === 1
    ? "1 producto no se pudo cargar"
    : `${count} productos no se pudieron cargar`;
}

export type RestockPurchaseLines = {
  lineMeta: Map<string, PurchaseLineCatalogMeta>;
  lines: PurchaseLinesSnapshot;
  /** Productos del payload que se omitieron: inexistentes, inactivos o no comprables. */
  omitted: number;
};

/**
 * Líneas de la compra para una reposición de stock bajo (INV-05): una por
 * producto del payload, EN SU ORDEN, por unidad y con `suggestedQuantity`.
 *
 * Del payload solo salen el producto y la cantidad. Costo y alícuota son los
 * del catálogo, los mismos que al agregar ese producto a mano por unidad
 * (`product.unitCostRef`, ya con el último costo de compra aplicado, y la
 * alícuota de su categoría). Nacen desbloqueadas y asentadas.
 */
export function buildRestockPurchaseLines(
  restockLines: readonly RestockLine[],
  products: PurchaseProductResolutions,
  input: { costCurrency: PurchaseCostCurrency; nextId: () => string; rateVes: number },
): RestockPurchaseLines {
  const lineMeta = new Map<string, PurchaseLineCatalogMeta>();
  let omitted = 0;
  const items = restockLines.flatMap((line) => {
    const resolution = products.get(line.productId);

    if (resolution?.status !== "active" || lineMeta.has(line.productId)) {
      omitted += 1;
      return [];
    }

    const { product } = resolution;

    lineMeta.set(product.productId, {
      name: product.name,
      packUnits: product.packUnits,
      sku: product.sku,
      taxRate: product.taxRate,
    });

    return [
      createUnitDraftItem({
        costCurrency: input.costCurrency,
        id: input.nextId(),
        productId: product.productId,
        quantity: line.suggestedQuantity,
        rateVes: input.rateVes,
        taxRate: product.taxRate,
        unitCostRef: product.unitCostRef,
      }),
    ];
  });

  return {
    lineMeta,
    lines: {
      items,
      locks: EMPTY_PURCHASE_LOCK_STATE,
      review: settlePurchaseLines(EMPTY_PURCHASE_REVIEW_STATE, items, EMPTY_PURCHASE_TAX_STATE),
      taxState: EMPTY_PURCHASE_TAX_STATE,
    },
    omitted,
  };
}
