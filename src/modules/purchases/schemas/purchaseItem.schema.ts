import { z } from "zod";

import { safeText } from "./safeText";

export const purchaseEntryModeSchema = z.enum(["unit", "pack"]);
export const purchaseCostCurrencySchema = z.enum(["ves", "ref"]);

const purchaseItemBaseSchema = z.object({
  costCurrency: purchaseCostCurrencySchema,
  // COM-14: al recibir la compra, los empaques de la linea se abren en los
  // componentes de la receta del producto (que debe ser un empaque con receta activa).
  disassembleOnReceive: z.boolean().optional(),
  productId: safeText().min(1),
  subtotalRef: z.number().min(0),
  subtotalVes: z.number().min(0),
  supplierSku: safeText().optional(),
  // IVA de la linea: `taxRateCode` (alicuota del catalogo) y/o `taxRate` (su
  // porcentaje). Con solo el codigo, la base deriva el porcentaje; con solo el
  // porcentaje (clientes anteriores) debe ser el de una alicuota activa.
  taxRate: z.number().min(0).max(100).optional(),
  taxRateCode: safeText().trim().min(1).max(40).optional(),
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
  packLabel: safeText().min(1),
  packCount: z.number().int().positive(),
  unitsPerPack: z.number().int().positive(),
  packCostRef: z.number().min(0),
  packCostVes: z.number().min(0),
});

export const PURCHASE_ITEM_TAX_REQUIRED_MESSAGE =
  "Cada linea debe indicar su alicuota de IVA (taxRateCode) o su porcentaje (taxRate).";

export const purchaseItemInputSchema = z
  .discriminatedUnion("entryMode", [purchaseItemUnitSchema, purchaseItemPackSchema])
  .refine((item) => item.taxRate !== undefined || item.taxRateCode !== undefined, {
    message: PURCHASE_ITEM_TAX_REQUIRED_MESSAGE,
    path: ["taxRate"],
  });

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
    // Solo las claves enviadas: un cliente que no manda `taxRateCode` produce el
    // mismo payload (y la misma huella de idempotencia) que antes.
    ...(item.taxRate !== undefined ? { tax_rate: item.taxRate } : {}),
    ...(item.taxRateCode !== undefined ? { tax_rate_code: item.taxRateCode } : {}),
    tax_ref: item.taxRef,
    tax_ves: item.taxVes,
    unit_cost_ref: item.unitCostRef,
    unit_cost_ves: item.unitCostVes,
    ...(item.supplierSku ? { supplier_sku: item.supplierSku } : {}),
    // Solo cuando es `true`: una linea sin marca produce el payload (y la huella) de siempre.
    ...(item.disassembleOnReceive === true ? { disassemble_on_receive: true } : {}),
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
