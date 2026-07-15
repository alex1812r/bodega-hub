export {
  normalizePurchaseLine,
  type NormalizedPurchaseLine,
  type PurchaseItemInput,
} from "@/modules/purchases/schemas/purchaseItem.schema";

import type { PurchaseItemInput } from "@/modules/purchases/schemas/purchaseItem.schema";

import type { PurchaseDraftItem } from "../types";

export function draftToPurchaseItemInput(item: PurchaseDraftItem): PurchaseItemInput {
  if (item.entryMode === "pack") {
    return {
      entryMode: "pack",
      packCostRef: item.packCostRef,
      packCount: item.packCount,
      packLabel: item.packLabel,
      productId: item.productId,
      unitsPerPack: item.unitsPerPack,
    };
  }

  return {
    entryMode: "unit",
    productId: item.productId,
    quantity: item.quantity,
    unitCostRef: item.unitCostRef,
  };
}

export function getDraftSubtotalRef(item: PurchaseDraftItem) {
  if (item.entryMode === "pack") {
    return Math.round(item.packCount * item.packCostRef * 100) / 100;
  }

  return Math.round(item.quantity * item.unitCostRef * 100) / 100;
}

export function syncPackDerivedFields(item: PurchaseDraftItem): PurchaseDraftItem {
  if (item.entryMode !== "pack") {
    return item;
  }

  const quantity = item.packCount * item.unitsPerPack;
  const unitCostRef =
    item.unitsPerPack > 0
      ? Math.round((item.packCostRef / item.unitsPerPack) * 100) / 100
      : 0;

  return {
    ...item,
    quantity,
    unitCostRef,
  };
}
