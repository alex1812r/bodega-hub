import { buildReceivePreview, type ReceivePreviewPurchase } from "./buildReceivePreview";

type Item = ReceivePreviewPurchase["items"][number];

function item(overrides: Partial<Item> = {}): Item {
  return {
    product: { currentStock: 10, isActive: true, name: "Harina PAN" },
    productId: "prod-harina",
    purchaseId: "purchase-1",
    quantity: 5,
    subtotalRef: 10,
    subtotalVes: 5000,
    unitCostRef: 2,
    unitCostVes: 1000,
    ...overrides,
  };
}

describe("buildReceivePreview (COM-07)", () => {
  it("línea por unidad: entra la cantidad de la línea y el stock sube en esa cantidad", () => {
    expect(buildReceivePreview({ items: [item({ entryMode: "unit" })] })).toEqual([
      {
        name: "Harina PAN",
        productId: "prod-harina",
        productInactive: false,
        quantityIn: 5,
        stockAfter: 15,
        stockBefore: 10,
        unitCostRef: 2,
      },
    ]);
  });

  it("línea por empaque: entran las unidades totales y lleva el desglose del empaque", () => {
    const [line] = buildReceivePreview({
      items: [
        item({
          entryMode: "pack",
          packCount: 3,
          packLabel: "caja",
          quantity: 36,
          unitsPerPack: 12,
        }),
      ],
    });

    expect(line).toMatchObject({
      packCount: 3,
      packLabel: "caja",
      quantityIn: 36,
      stockAfter: 46,
      stockBefore: 10,
      unitsPerPack: 12,
    });
  });

  it("una línea por unidad no lleva datos de empaque aunque la fila los traiga", () => {
    const [line] = buildReceivePreview({
      items: [item({ entryMode: "unit", packCount: 3, packLabel: "caja", unitsPerPack: 12 })],
    });

    expect(line).not.toHaveProperty("packCount");
    expect(line).not.toHaveProperty("packLabel");
    expect(line).not.toHaveProperty("unitsPerPack");
  });

  it("marca el producto inactivo", () => {
    const [line] = buildReceivePreview({
      items: [item({ product: { currentStock: 0, isActive: false, name: "Descontinuado" } })],
    });

    expect(line.productInactive).toBe(true);
    expect(line.stockBefore).toBe(0);
    expect(line.stockAfter).toBe(5);
  });

  it("el mismo producto en dos líneas encadena el stock y conserva el orden", () => {
    const lines = buildReceivePreview({
      items: [
        item({ quantity: 5 }),
        item({
          product: { currentStock: 1, isActive: true, name: "Arroz" },
          productId: "prod-arroz",
          quantity: 2,
        }),
        item({ entryMode: "pack", packCount: 2, quantity: 24, unitsPerPack: 12 }),
      ],
    });

    expect(lines.map((line) => [line.productId, line.stockBefore, line.stockAfter])).toEqual([
      ["prod-harina", 10, 15],
      ["prod-arroz", 1, 3],
      ["prod-harina", 15, 39],
    ]);
  });

  it("sin producto embebido usa el id como nombre y deja el stock sin calcular", () => {
    expect(buildReceivePreview({ items: [item({ product: undefined })] })).toEqual([
      {
        name: "prod-harina",
        productId: "prod-harina",
        productInactive: false,
        quantityIn: 5,
        stockAfter: null,
        stockBefore: null,
        unitCostRef: 2,
      },
    ]);
  });

  it("compra sin líneas: lista vacía", () => {
    expect(buildReceivePreview({ items: [] })).toEqual([]);
  });

  it("no modifica la compra recibida", () => {
    const purchase = { items: [item()] };
    const snapshot = JSON.stringify(purchase);

    buildReceivePreview(purchase);

    expect(JSON.stringify(purchase)).toBe(snapshot);
  });
});
