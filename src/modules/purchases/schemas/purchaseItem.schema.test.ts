import {
  normalizePurchaseLine,
  purchaseItemInputSchema,
  toRpcPurchaseItem,
} from "./purchaseItem.schema";

describe("purchaseItem.schema", () => {
  it("normalizes pack mode lines", () => {
    const item = purchaseItemInputSchema.parse({
      costCurrency: "ves",
      entryMode: "pack",
      packCostRef: 30,
      packCostVes: 22701.25,
      packCount: 2,
      packLabel: "Bulto",
      productId: "prod-1",
      subtotalRef: 60,
      subtotalVes: 45402.5,
      taxRate: 16,
      taxRef: 9.6,
      taxVes: 7264.4,
      unitCostRef: 1.25,
      unitCostVes: 945.89,
      unitsPerPack: 24,
    });

    expect(normalizePurchaseLine(item)).toEqual({
      entryMode: "pack",
      packCostRef: 30,
      packCount: 2,
      packLabel: "Bulto",
      quantity: 48,
      subtotalRef: 60,
      unitCostRef: 1.25,
      unitsPerPack: 24,
    });
  });

  it("normalizes unit mode lines", () => {
    const item = purchaseItemInputSchema.parse({
      costCurrency: "ref",
      entryMode: "unit",
      productId: "prod-1",
      quantity: 10,
      subtotalRef: 25,
      subtotalVes: 18917.71,
      taxRate: 16,
      taxRef: 4,
      taxVes: 3026.83,
      unitCostRef: 2.5,
      unitCostVes: 1891.77,
    });

    expect(normalizePurchaseLine(item)).toEqual({
      entryMode: "unit",
      quantity: 10,
      subtotalRef: 25,
      unitCostRef: 2.5,
    });
  });

  it("maps pack items to RPC payload with REF and VES", () => {
    const item = purchaseItemInputSchema.parse({
      costCurrency: "ves",
      entryMode: "pack",
      packCostRef: 30,
      packCostVes: 22701.25,
      packCount: 1,
      packLabel: "Bulto",
      productId: "prod-1",
      subtotalRef: 30,
      subtotalVes: 22701.25,
      taxRate: 16,
      taxRef: 4.8,
      taxVes: 3632.2,
      unitCostRef: 1.5,
      unitCostVes: 1135.06,
      unitsPerPack: 20,
    });

    expect(toRpcPurchaseItem(item)).toEqual({
      cost_currency: "ves",
      entry_mode: "pack",
      pack_cost_ref: 30,
      pack_cost_ves: 22701.25,
      pack_count: 1,
      pack_label: "Bulto",
      product_id: "prod-1",
      subtotal_ref: 30,
      subtotal_ves: 22701.25,
      tax_rate: 16,
      tax_ref: 4.8,
      tax_ves: 3632.2,
      unit_cost_ref: 1.5,
      unit_cost_ves: 1135.06,
      units_per_pack: 20,
    });
  });
});
