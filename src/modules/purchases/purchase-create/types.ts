import type { SupplierProductPackUnit } from "@/modules/contacts/types/supplierProducts";
import type { PurchaseEntryMode } from "@/modules/purchases/schemas/purchaseItem.schema";
import { refToVes, roundMoney, vesToRef } from "@/shared/utils/currency";

export type PurchaseCostCurrency = "ves" | "ref";

export type PurchaseDraftItem = {
  costCurrency: PurchaseCostCurrency;
  entryMode: PurchaseEntryMode;
  id: string;
  packCostRef: number;
  packCostVes: number;
  packCount: number;
  packLabel: string;
  packUnitId?: string;
  productId: string;
  quantity: number;
  /** % IVA de la linea (snapshot; editable en compra para exentos / factura especial). */
  taxRate: number;
  unitCostRef: number;
  unitCostVes: number;
  unitsPerPack: number;
};

export function createUnitDraftItem(input: {
  costCurrency?: PurchaseCostCurrency;
  id: string;
  productId: string;
  quantity?: number;
  rateVes: number;
  taxRate?: number;
  unitCostRef?: number;
  unitCostVes?: number;
}): PurchaseDraftItem {
  const costCurrency = input.costCurrency ?? "ves";
  const unitCostRef =
    input.unitCostRef != null
      ? input.unitCostRef
      : input.unitCostVes != null
        ? roundMoney(vesToRef(input.unitCostVes, input.rateVes))
        : 0;
  const unitCostVes =
    input.unitCostVes != null
      ? input.unitCostVes
      : roundMoney(refToVes(unitCostRef, input.rateVes));

  return {
    costCurrency,
    entryMode: "unit",
    id: input.id,
    packCostRef: 0,
    packCostVes: 0,
    packCount: 1,
    packLabel: "",
    productId: input.productId,
    quantity: input.quantity ?? 1,
    taxRate: input.taxRate ?? 0,
    unitCostRef,
    unitCostVes,
    unitsPerPack: 1,
  };
}

export function createPackDraftItem(input: {
  costCurrency?: PurchaseCostCurrency;
  id: string;
  packCostRef?: number;
  packCostVes?: number;
  packCount?: number;
  packLabel: string;
  packUnitId?: string;
  productId: string;
  rateVes: number;
  taxRate?: number;
  unitCostRef?: number;
  unitCostVes?: number;
  unitsPerPack: number;
}): PurchaseDraftItem {
  const costCurrency = input.costCurrency ?? "ves";
  const packCount = input.packCount ?? 1;
  const unitsPerPack = input.unitsPerPack;

  let packCostRef = input.packCostRef;
  let packCostVes = input.packCostVes;

  if (packCostRef == null && packCostVes == null) {
    if (input.unitCostRef != null) {
      packCostRef = roundMoney(input.unitCostRef * unitsPerPack);
    } else if (input.unitCostVes != null) {
      packCostVes = roundMoney(input.unitCostVes * unitsPerPack);
    } else {
      packCostRef = 0;
      packCostVes = 0;
    }
  }

  if (packCostRef == null && packCostVes != null) {
    packCostRef = roundMoney(vesToRef(packCostVes, input.rateVes));
  }

  if (packCostVes == null && packCostRef != null) {
    packCostVes = roundMoney(refToVes(packCostRef, input.rateVes));
  }

  const resolvedPackCostRef = packCostRef ?? 0;
  const resolvedPackCostVes = packCostVes ?? 0;
  const unitCostRef =
    unitsPerPack > 0 ? roundMoney(resolvedPackCostRef / unitsPerPack) : 0;
  const unitCostVes =
    unitsPerPack > 0 ? roundMoney(resolvedPackCostVes / unitsPerPack) : 0;

  return {
    costCurrency,
    entryMode: "pack",
    id: input.id,
    packCostRef: resolvedPackCostRef,
    packCostVes: resolvedPackCostVes,
    packCount,
    packLabel: input.packLabel,
    packUnitId: input.packUnitId,
    productId: input.productId,
    quantity: packCount * unitsPerPack,
    taxRate: input.taxRate ?? 0,
    unitCostRef,
    unitCostVes,
    unitsPerPack,
  };
}

export type PurchaseLineCatalogMeta = {
  name: string;
  packUnits?: SupplierProductPackUnit[];
  sku: string;
  taxRate: number;
};
