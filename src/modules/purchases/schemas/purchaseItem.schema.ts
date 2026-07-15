import { z } from "zod";

export const purchaseEntryModeSchema = z.enum(["unit", "pack"]);

const purchaseItemBaseSchema = z.object({
  productId: z.string().min(1),
  supplierSku: z.string().optional(),
});

export const purchaseItemUnitSchema = purchaseItemBaseSchema.extend({
  entryMode: z.literal("unit"),
  quantity: z.number().int().positive(),
  unitCostRef: z.number().min(0),
});

export const purchaseItemPackSchema = purchaseItemBaseSchema.extend({
  entryMode: z.literal("pack"),
  packLabel: z.string().min(1),
  packCount: z.number().int().positive(),
  unitsPerPack: z.number().int().positive(),
  packCostRef: z.number().min(0),
});

export const purchaseItemInputSchema = z.discriminatedUnion("entryMode", [
  purchaseItemUnitSchema,
  purchaseItemPackSchema,
]);

export type PurchaseItemUnitInput = z.infer<typeof purchaseItemUnitSchema>;
export type PurchaseItemPackInput = z.infer<typeof purchaseItemPackSchema>;
export type PurchaseItemInput = z.infer<typeof purchaseItemInputSchema>;
export type PurchaseEntryMode = z.infer<typeof purchaseEntryModeSchema>;

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
    const quantity = item.packCount * item.unitsPerPack;
    const unitCostRef = Math.round((item.packCostRef / item.unitsPerPack) * 100) / 100;
    const subtotalRef = Math.round(item.packCount * item.packCostRef * 100) / 100;

    return {
      entryMode: "pack",
      packCostRef: item.packCostRef,
      packCount: item.packCount,
      packLabel: item.packLabel,
      quantity,
      subtotalRef,
      unitCostRef,
      unitsPerPack: item.unitsPerPack,
    };
  }

  const subtotalRef = Math.round(item.quantity * item.unitCostRef * 100) / 100;

  return {
    entryMode: "unit",
    quantity: item.quantity,
    subtotalRef,
    unitCostRef: item.unitCostRef,
  };
}

export function toRpcPurchaseItem(item: PurchaseItemInput) {
  if (item.entryMode === "pack") {
    return {
      entry_mode: "pack",
      pack_cost_ref: item.packCostRef,
      pack_count: item.packCount,
      pack_label: item.packLabel,
      product_id: item.productId,
      units_per_pack: item.unitsPerPack,
      ...(item.supplierSku ? { supplier_sku: item.supplierSku } : {}),
    };
  }

  return {
    entry_mode: "unit",
    product_id: item.productId,
    quantity: item.quantity,
    unit_cost_ref: item.unitCostRef,
    ...(item.supplierSku ? { supplier_sku: item.supplierSku } : {}),
  };
}
