export {
  normalizePurchaseLine,
  type NormalizedPurchaseLine,
  type PurchaseItemInput,
} from "@/modules/purchases/schemas/purchaseItem.schema";

import { refToVes, roundMoney, vesToRef } from "@/shared/utils/currency";

import type { PurchaseCostCurrency, PurchaseDraftItem } from "../types";
import type { PurchaseItemInput } from "@/modules/purchases/schemas/purchaseItem.schema";

export function draftToPurchaseItemInput(item: PurchaseDraftItem): PurchaseItemInput {
  const taxRate = item.taxRate;
  const subtotalRef = getDraftSubtotalRef(item);
  const subtotalVes = getDraftSubtotalVes(item);
  const taxRef = roundMoney((subtotalRef * taxRate) / 100);
  const taxVes = roundMoney((subtotalVes * taxRate) / 100);

  if (item.entryMode === "pack") {
    return {
      costCurrency: item.costCurrency,
      entryMode: "pack",
      packCostRef: item.packCostRef,
      packCostVes: item.packCostVes,
      packCount: item.packCount,
      packLabel: item.packLabel,
      productId: item.productId,
      subtotalRef,
      subtotalVes,
      taxRate,
      taxRef,
      taxVes,
      unitCostRef: item.unitCostRef,
      unitCostVes: item.unitCostVes,
      unitsPerPack: item.unitsPerPack,
    };
  }

  return {
    costCurrency: item.costCurrency,
    entryMode: "unit",
    productId: item.productId,
    quantity: item.quantity,
    subtotalRef,
    subtotalVes,
    taxRate,
    taxRef,
    taxVes,
    unitCostRef: item.unitCostRef,
    unitCostVes: item.unitCostVes,
  };
}

export function getDraftSubtotalRef(item: PurchaseDraftItem) {
  if (item.entryMode === "pack") {
    return roundMoney(item.packCount * item.packCostRef);
  }

  return roundMoney(item.quantity * item.unitCostRef);
}

export function getDraftSubtotalVes(item: PurchaseDraftItem) {
  if (item.entryMode === "pack") {
    return roundMoney(item.packCount * item.packCostVes);
  }

  return roundMoney(item.quantity * item.unitCostVes);
}

export function getDraftTaxAmount(baseAmount: number, taxRate: number) {
  return roundMoney(baseAmount * (Math.max(0, taxRate) / 100));
}

export function getDraftTotalWithTax(baseAmount: number, taxRate: number) {
  return roundMoney(baseAmount + getDraftTaxAmount(baseAmount, taxRate));
}

/**
 * Keep pack↔unit and REF↔VES in sync.
 * `costCurrency` is the editable source of truth for the primary magnitude.
 */
export function syncLineCostFields(
  item: PurchaseDraftItem,
  rateVes: number,
): PurchaseDraftItem {
  if (item.entryMode !== "pack") {
    if (item.costCurrency === "ves") {
      const unitCostVes = Math.max(0, item.unitCostVes);
      const unitCostRef = roundMoney(vesToRef(unitCostVes, rateVes));
      return {
        ...item,
        packCostRef: 0,
        packCostVes: 0,
        unitCostRef,
        unitCostVes,
      };
    }

    const unitCostRef = Math.max(0, item.unitCostRef);
    const unitCostVes = roundMoney(refToVes(unitCostRef, rateVes));
    return {
      ...item,
      packCostRef: 0,
      packCostVes: 0,
      unitCostRef,
      unitCostVes,
    };
  }

  const unitsPerPack = Math.max(1, item.unitsPerPack);
  const packCount = Math.max(1, item.packCount);
  const quantity = packCount * unitsPerPack;

  if (item.costCurrency === "ves") {
    const packCostVes = Math.max(0, item.packCostVes);
    const unitCostVes = roundMoney(packCostVes / unitsPerPack);
    const packCostRef = roundMoney(vesToRef(packCostVes, rateVes));
    const unitCostRef = roundMoney(vesToRef(unitCostVes, rateVes));

    return {
      ...item,
      packCostRef,
      packCostVes,
      packCount,
      quantity,
      unitCostRef,
      unitCostVes,
      unitsPerPack,
    };
  }

  const packCostRef = Math.max(0, item.packCostRef);
  const unitCostRef = roundMoney(packCostRef / unitsPerPack);
  const packCostVes = roundMoney(refToVes(packCostRef, rateVes));
  const unitCostVes = roundMoney(refToVes(unitCostRef, rateVes));

  return {
    ...item,
    packCostRef,
    packCostVes,
    packCount,
    quantity,
    unitCostRef,
    unitCostVes,
    unitsPerPack,
  };
}

/** @deprecated Prefer syncLineCostFields(item, rateVes) */
export function syncPackDerivedFields(
  item: PurchaseDraftItem,
  rateVes = 0,
): PurchaseDraftItem {
  if (rateVes > 0) {
    return syncLineCostFields(item, rateVes);
  }

  if (item.entryMode !== "pack") {
    return item;
  }

  const quantity = item.packCount * item.unitsPerPack;
  const unitCostRef =
    item.unitsPerPack > 0 ? roundMoney(item.packCostRef / item.unitsPerPack) : 0;
  const unitCostVes =
    item.unitsPerPack > 0 ? roundMoney(item.packCostVes / item.unitsPerPack) : 0;

  return {
    ...item,
    quantity,
    unitCostRef,
    unitCostVes,
  };
}

export function switchCostCurrency(
  item: PurchaseDraftItem,
  nextCurrency: PurchaseCostCurrency,
  rateVes: number,
): PurchaseDraftItem {
  if (item.costCurrency === nextCurrency) {
    return syncLineCostFields(item, rateVes);
  }

  // Refresh mirrors from the current editable currency, then flip.
  // The next edit will treat `nextCurrency` as source of truth.
  const synced = syncLineCostFields(item, rateVes);
  return syncLineCostFields({ ...synced, costCurrency: nextCurrency }, rateVes);
}
