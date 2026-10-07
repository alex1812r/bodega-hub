import {
  PURCHASE_ITEM_TAX_REQUIRED_MESSAGE,
  purchaseItemInputSchema,
  toRpcPurchaseItem,
} from "./purchaseItem.schema";

const unitLine = {
  costCurrency: "ref",
  entryMode: "unit",
  productId: "prod-1",
  quantity: 10,
  subtotalRef: 25,
  subtotalVes: 18917.71,
  taxRef: 4,
  taxVes: 3026.83,
  unitCostRef: 2.5,
  unitCostVes: 1891.77,
};

const packLine = {
  costCurrency: "ves",
  entryMode: "pack",
  packCostRef: 30,
  packCostVes: 22701.25,
  packCount: 1,
  packLabel: "Bulto",
  productId: "prod-1",
  subtotalRef: 30,
  subtotalVes: 22701.25,
  taxRef: 4.8,
  taxVes: 3632.2,
  unitCostRef: 1.5,
  unitCostVes: 1135.06,
  unitsPerPack: 20,
};

describe("purchaseItem.schema · alicuota de IVA (SHR-10)", () => {
  it("acepta solo taxRateCode y lo envia como tax_rate_code sin tax_rate", () => {
    const item = purchaseItemInputSchema.parse({ ...unitLine, taxRateCode: " general " });
    const rpcItem = toRpcPurchaseItem(item);

    expect(item.taxRateCode).toBe("general");
    expect(rpcItem).toEqual(expect.objectContaining({ tax_rate_code: "general" }));
    expect(Object.keys(rpcItem)).not.toContain("tax_rate");
  });

  it("acepta taxRate y taxRateCode juntos, tambien en lineas por empaque", () => {
    const item = purchaseItemInputSchema.parse({ ...packLine, taxRate: 16, taxRateCode: "general" });

    expect(toRpcPurchaseItem(item)).toEqual(
      expect.objectContaining({ entry_mode: "pack", tax_rate: 16, tax_rate_code: "general" }),
    );
  });

  it("solo taxRate no anade la clave tax_rate_code al payload", () => {
    const item = purchaseItemInputSchema.parse({ ...unitLine, taxRate: 16 });

    expect(Object.keys(toRpcPurchaseItem(item))).not.toContain("tax_rate_code");
  });

  it.each([
    ["ninguno de los dos", {}],
    ["taxRateCode vacio", { taxRateCode: "" }],
    ["taxRateCode de mas de 40 caracteres", { taxRateCode: "a".repeat(41) }],
    ["taxRate negativo", { taxRate: -1, taxRateCode: "general" }],
  ])("rechaza %s", (_case, tax) => {
    expect(purchaseItemInputSchema.safeParse({ ...unitLine, ...tax }).success).toBe(false);
  });

  it("explica que falta la alicuota cuando no llega ninguno de los dos", () => {
    const result = purchaseItemInputSchema.safeParse(packLine);

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toEqual([
      PURCHASE_ITEM_TAX_REQUIRED_MESSAGE,
    ]);
  });
});
