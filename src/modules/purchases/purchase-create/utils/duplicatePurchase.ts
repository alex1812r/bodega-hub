import { roundMoney } from "@/shared/utils/currency";

import type { PurchaseDetails } from "../../hooks/usePurchases";
import type { PurchaseLinesSnapshot } from "../hooks/usePurchaseLines";
import type { PurchaseProductResolutions } from "../services/resolvePurchaseProducts";
import {
  createPackDraftItem,
  createUnitDraftItem,
  type PurchaseCostCurrency,
  type PurchaseLineCatalogMeta,
} from "../types";
import { netCostRef } from "./buildPurchaseCatalog";
import { EMPTY_PURCHASE_LOCK_STATE } from "./purchaseLineLocks";
import { EMPTY_PURCHASE_REVIEW_STATE, settlePurchaseLines } from "./purchaseLineReview";
import { EMPTY_PURCHASE_TAX_STATE } from "./purchaseLineTax";

export type PurchaseDuplicateSourceItem = PurchaseDetails["items"][number];

/**
 * Lo que se lee de cada línea de origen: una línea de la compra a duplicar o, con el
 * proveedor de un borrador ya inactivo, una línea guardada (`storedDraftSourceItems`).
 */
export type PurchaseLineSource = Pick<
  PurchaseDuplicateSourceItem,
  | "entryMode"
  | "packCostRef"
  | "packCount"
  | "packLabel"
  | "productId"
  | "quantity"
  | "unitCostRef"
  | "unitsPerPack"
> & { product?: { name: string } };

export type DuplicatedPurchaseLines = {
  lineMeta: Map<string, PurchaseLineCatalogMeta>;
  lines: PurchaseLinesSnapshot;
  /** Avisos para el usuario: productos del origen que se omitieron. */
  notices: string[];
};

function samePackLabel(left: string, right: string) {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

/**
 * Líneas de una compra duplicada (COM-09): mismo producto, mismo modo (unidad o
 * empaque, con su etiqueta y sus unidades por empaque) y misma cantidad que el
 * origen, con el costo AL ÚLTIMO CONOCIDO, igual que el buscador: el unitario sin
 * IVA de la última compra recibida del producto; si no se conoce, el del vínculo
 * proveedor–producto actual llevado a base sin IVA, y solo si no hay vínculo con
 * costo, el de la línea de origen (que ya es sin IVA). La alícuota es la de la
 * categoría actual del producto.
 *
 * Nacen desbloqueadas y asentadas (sin marca de "editada"). Los productos
 * inactivos o que ya no existen se omiten y se listan en `notices`.
 */
export function buildDuplicatedPurchaseLines(
  sourceItems: PurchaseLineSource[],
  products: PurchaseProductResolutions,
  input: { costCurrency: PurchaseCostCurrency; nextId: () => string; rateVes: number },
): DuplicatedPurchaseLines {
  const lineMeta = new Map<string, PurchaseLineCatalogMeta>();
  const omittedNames = new Map<string, string>();
  const items = sourceItems.flatMap((source) => {
    const resolution = products.get(source.productId);

    if (resolution?.status !== "active") {
      omittedNames.set(
        source.productId,
        resolution?.name ?? source.product?.name ?? "Producto sin nombre",
      );
      return [];
    }

    const { product } = resolution;
    const lastUnitCostRef = product.lastPurchaseUnitCostRef;
    const hasLinkCost = product.link !== "none" && product.costWithTaxRef > 0;
    const base = {
      costCurrency: input.costCurrency,
      id: input.nextId(),
      productId: product.productId,
      rateVes: input.rateVes,
      taxRate: product.taxRate,
    };
    const unitsPerPack = source.unitsPerPack ?? 0;

    lineMeta.set(product.productId, {
      name: product.name,
      packUnits: product.packUnits,
      sku: product.sku,
      taxRate: product.taxRate,
    });

    if (source.entryMode === "pack" && unitsPerPack > 0) {
      const packLabel = source.packLabel?.trim() || "Bulto";
      const packUnit = product.packUnits.find(
        (candidate) =>
          candidate.unitsPerPack === unitsPerPack && samePackLabel(candidate.label, packLabel),
      );

      return [
        createPackDraftItem({
          ...base,
          // Del costo con IVA del empaque, no del unitario ya redondeado: evita arrastrar céntimos.
          packCostRef:
            lastUnitCostRef !== undefined
              ? roundMoney(lastUnitCostRef * unitsPerPack)
              : hasLinkCost
                ? netCostRef(product.costWithTaxRef * unitsPerPack, product.taxRate)
                : (source.packCostRef ?? roundMoney(source.unitCostRef * unitsPerPack)),
          packCount: source.packCount ?? 1,
          packLabel,
          packUnitId: packUnit?.id,
          unitsPerPack,
        }),
      ];
    }

    return [
      createUnitDraftItem({
        ...base,
        quantity: source.quantity,
        unitCostRef:
          lastUnitCostRef ?? (hasLinkCost ? product.unitCostRef : source.unitCostRef),
      }),
    ];
  });
  const notices: string[] = [];

  if (omittedNames.size > 0) {
    const names = [...omittedNames.values()].join(", ");

    notices.push(
      omittedNames.size === 1
        ? `No se duplicó 1 producto que ya no existe o está inactivo: ${names}.`
        : `No se duplicaron ${omittedNames.size} productos que ya no existen o están inactivos: ${names}.`,
    );
  }

  return {
    lineMeta,
    lines: {
      items,
      locks: EMPTY_PURCHASE_LOCK_STATE,
      review: settlePurchaseLines(EMPTY_PURCHASE_REVIEW_STATE, items, EMPTY_PURCHASE_TAX_STATE),
      taxState: EMPTY_PURCHASE_TAX_STATE,
    },
    notices,
  };
}
