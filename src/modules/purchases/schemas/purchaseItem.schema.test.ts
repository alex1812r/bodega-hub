import {
  normalizePurchaseLine,
  purchaseItemInputSchema,
  toRpcPurchaseItem,
} from "./purchaseItem.schema";

describe("purchaseItem.schema", () => {
  it("normalizes pack mode lines", () => {
    const item = purchaseItemInputSchema.parse({
      entryMode: "pack",
      packCostRef: 30,
      packCount: 2,
      packLabel: "Bulto",
      productId: "prod-1",
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
      entryMode: "unit",
      productId: "prod-1",
      quantity: 10,
      unitCostRef: 2.5,
    });

    expect(normalizePurchaseLine(item)).toEqual({
      entryMode: "unit",
      quantity: 10,
      subtotalRef: 25,
      unitCostRef: 2.5,
    });
  });

  it("maps pack items to RPC payload", () => {
    const item = purchaseItemInputSchema.parse({
      entryMode: "pack",
      packCostRef: 30,
      packCount: 1,
      packLabel: "Bulto",
      productId: "prod-1",
      unitsPerPack: 20,
    });

    expect(toRpcPurchaseItem(item)).toEqual({
      entry_mode: "pack",
      pack_cost_ref: 30,
      pack_count: 1,
      pack_label: "Bulto",
      product_id: "prod-1",
      units_per_pack: 20,
    });
  });
});
