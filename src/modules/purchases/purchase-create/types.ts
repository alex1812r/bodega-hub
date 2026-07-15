import type { SupplierProductPackUnit } from "@/modules/contacts/types/supplierProducts";
import type { PurchaseEntryMode } from "@/modules/purchases/schemas/purchaseItem.schema";

export type PurchaseDraftItem = {
  entryMode: PurchaseEntryMode;
  id: string;
  packCostRef: number;
  packCount: number;
  packLabel: string;
  packUnitId?: string;
  productId: string;
  quantity: number;
  unitCostRef: number;
  unitsPerPack: number;
};

export function createUnitDraftItem(input: {
  id: string;
  productId: string;
  quantity?: number;
  unitCostRef: number;
}): PurchaseDraftItem {
  return {
    entryMode: "unit",
    id: input.id,
    packCostRef: 0,
    packCount: 1,
    packLabel: "",
    productId: input.productId,
    quantity: input.quantity ?? 1,
    unitCostRef: input.unitCostRef,
    unitsPerPack: 1,
  };
}

export function createPackDraftItem(input: {
  id: string;
  packCostRef: number;
  packCount?: number;
  packLabel: string;
  packUnitId?: string;
  productId: string;
  unitCostRef: number;
  unitsPerPack: number;
}): PurchaseDraftItem {
  return {
    entryMode: "pack",
    id: input.id,
    packCostRef: input.packCostRef,
    packCount: input.packCount ?? 1,
    packLabel: input.packLabel,
    packUnitId: input.packUnitId,
    productId: input.productId,
    quantity: (input.packCount ?? 1) * input.unitsPerPack,
    unitCostRef: input.unitCostRef,
    unitsPerPack: input.unitsPerPack,
  };
}

export type PurchaseLineCatalogMeta = {
  name: string;
  packUnits?: SupplierProductPackUnit[];
  sku: string;
};
