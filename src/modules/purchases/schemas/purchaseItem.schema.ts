import { z } from "zod";

export const purchaseEntryModeSchema = z.enum(["unit", "pack"]);
export const purchaseCostCurrencySchema = z.enum(["ves", "ref"]);

const purchaseItemBaseSchema = z.object({
  costCurrency: purchaseCostCurrencySchema,
  productId: z.string().min(1),
  subtotalRef: z.number().min(0),
  subtotalVes: z.number().min(0),
  supplierSku: z.string().optional(),
  taxRate: z.number().min(0).max(100),
  taxRef: z.number().min(0),
  taxVes: z.number().min(0),
  unitCostRef: z.number().min(0),
  unitCostVes: z.number().min(0),
});

export const purchaseItemUnitSchema = purchaseItemBaseSchema.extend({
  entryMode: z.literal("unit"),
  quantity: z.number().int().positive(),
});

export const purchaseItemPackSchema = purchaseItemBaseSchema.extend({
  entryMode: z.literal("pack"),
  packLabel: z.string().min(1),
  packCount: z.number().int().positive(),
  unitsPerPack: z.number().int().positive(),
  packCostRef: z.number().min(0),
  packCostVes: z.number().min(0),
});

export const purchaseItemInputSchema = z.discriminatedUnion("entryMode", [
  purchaseItemUnitSchema,
  purchaseItemPackSchema,
]);

export type PurchaseItemUnitInput = z.infer<typeof purchaseItemUnitSchema>;
export type PurchaseItemPackInput = z.infer<typeof purchaseItemPackSchema>;
export type PurchaseItemInput = z.infer<typeof purchaseItemInputSchema>;
export type PurchaseEntryMode = z.infer<typeof purchaseEntryModeSchema>;
export type PurchaseCostCurrency = z.infer<typeof purchaseCostCurrencySchema>;

export type NormalizedPurchaseLine = {
  entryMode: PurchaseEntryMode;
  packCostRef?: number;
  packCount?: number;
  packLabel?: string;
  quantity: number;
  subtotalRef: number;
  unitCostRef: number;
  unitsPerPack?: number;
};

export function normalizePurchaseLine(item: PurchaseItemInput): NormalizedPurchaseLine {
  if (item.entryMode === "pack") {
    return {
      entryMode: "pack",
      packCostRef: item.packCostRef,
      packCount: item.packCount,
      packLabel: item.packLabel,
      quantity: item.packCount * item.unitsPerPack,
      subtotalRef: item.subtotalRef,
      unitCostRef: item.unitCostRef,
      unitsPerPack: item.unitsPerPack,
    };
  }

  return {
    entryMode: "unit",
    quantity: item.quantity,
    subtotalRef: item.subtotalRef,
    unitCostRef: item.unitCostRef,
  };
}

export function toRpcPurchaseItem(item: PurchaseItemInput) {
  const shared = {
    cost_currency: item.costCurrency,
    product_id: item.productId,
    subtotal_ref: item.subtotalRef,
    subtotal_ves: item.subtotalVes,
    tax_rate: item.taxRate,
    tax_ref: item.taxRef,
    tax_ves: item.taxVes,
    unit_cost_ref: item.unitCostRef,
    unit_cost_ves: item.unitCostVes,
    ...(item.supplierSku ? { supplier_sku: item.supplierSku } : {}),
  };

  if (item.entryMode === "pack") {
    return {
      ...shared,
      entry_mode: "pack",
      pack_cost_ref: item.packCostRef,
      pack_cost_ves: item.packCostVes,
      pack_count: item.packCount,
      pack_label: item.packLabel,
      units_per_pack: item.unitsPerPack,
    };
  }

  return {
    ...shared,
    entry_mode: "unit",
    quantity: item.quantity,
  };
}
