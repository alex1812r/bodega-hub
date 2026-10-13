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

describe("disassembleOnReceive (COM-14)", () => {
  const line = {
    costCurrency: "ref",
    entryMode: "unit",
    productId: "prod-pack",
    quantity: 3,
    subtotalRef: 27,
    subtotalVes: 13770,
    taxRate: 0,
    taxRef: 0,
    taxVes: 0,
    unitCostRef: 9,
    unitCostVes: 4590,
  };

  it("la marca es opcional y debe ser un booleano", () => {
    expect(purchaseItemInputSchema.parse(line)).not.toHaveProperty("disassembleOnReceive");
    expect(purchaseItemInputSchema.parse({ ...line, disassembleOnReceive: true }).disassembleOnReceive).toBe(true);
    expect(purchaseItemInputSchema.safeParse({ ...line, disassembleOnReceive: "si" }).success).toBe(false);
  });

  it("solo viaja a la RPC cuando es true: sin marca o con false el payload es el de siempre", () => {
    const plain = toRpcPurchaseItem(purchaseItemInputSchema.parse(line));

    expect(toRpcPurchaseItem(purchaseItemInputSchema.parse({ ...line, disassembleOnReceive: true }))).toEqual({
      ...plain,
      disassemble_on_receive: true,
    });
    expect(toRpcPurchaseItem(purchaseItemInputSchema.parse({ ...line, disassembleOnReceive: false }))).toEqual(plain);
    expect(plain).not.toHaveProperty("disassemble_on_receive");
  });

  it("una línea por empaque marcada también la lleva", () => {
    const pack = purchaseItemInputSchema.parse({
      ...line,
      disassembleOnReceive: true,
      entryMode: "pack",
      packCostRef: 9,
      packCostVes: 4590,
      packCount: 3,
      packLabel: "Caja",
      unitsPerPack: 6,
    });

    expect(toRpcPurchaseItem(pack)).toMatchObject({ disassemble_on_receive: true, entry_mode: "pack" });
  });
});
