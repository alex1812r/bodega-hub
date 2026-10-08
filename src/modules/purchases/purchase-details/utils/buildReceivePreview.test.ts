import {
  buildReceiveDisassembleRequest,
  buildReceivePreview,
  type ReceivePreviewPurchase,
} from "./buildReceivePreview";

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

describe("buildReceivePreview · desarmar al recibir (COM-14)", () => {
  const boxRecipe = {
    components: [
      { currentStock: 4, isActive: true, name: "Refresco 355 ml", unitProductId: "prod-lata", unitsPerPack: 6 },
    ],
    conversionId: "rec-caja",
    totalUnits: 6,
  };

  function box(overrides: Partial<Item> = {}): Item {
    return item({
      disassembleOnReceive: true,
      id: "item-caja",
      packRecipe: boxRecipe,
      product: { currentStock: 2, isActive: true, name: "Caja de refrescos" },
      productId: "prod-caja",
      quantity: 3,
      unitCostRef: 9,
      ...overrides,
    });
  }

  it("línea marcada: el empaque entra y sale (stock neto igual) y el componente sube empaques × unidades", () => {
    expect(buildReceivePreview({ items: [box()] })).toEqual([
      {
        canDisassemble: true,
        disassemble: {
          components: [
            {
              name: "Refresco 355 ml",
              productId: "prod-lata",
              productInactive: false,
              quantityIn: 18,
              stockAfter: 22,
              stockBefore: 4,
            },
          ],
          packsOut: 3,
        },
        name: "Caja de refrescos",
        productId: "prod-caja",
        productInactive: false,
        purchaseItemId: "item-caja",
        quantityIn: 3,
        stockAfter: 2,
        stockBefore: 2,
        unitCostRef: 9,
      },
    ]);
  });

  it("línea con receta pero sin marca: se puede desarmar y no lleva el segundo efecto", () => {
    const [line] = buildReceivePreview({ items: [box({ disassembleOnReceive: false })] });

    expect(line).toMatchObject({ canDisassemble: true, stockAfter: 5, stockBefore: 2 });
    expect(line).not.toHaveProperty("disassemble");
  });

  it("lo elegido en la confirmación manda sobre la marca guardada, en los dos sentidos", () => {
    const unmarked = buildReceivePreview({ items: [box()] }, { disassemble: { "item-caja": false } });
    const marked = buildReceivePreview(
      { items: [box({ disassembleOnReceive: false })] },
      { disassemble: { "item-caja": true } },
    );

    expect(unmarked[0]).not.toHaveProperty("disassemble");
    expect(unmarked[0]?.stockAfter).toBe(5);
    expect(marked[0]?.disassemble?.packsOut).toBe(3);
    expect(marked[0]?.stockAfter).toBe(2);
  });

  it("surtido: una entrada por componente con sus unidades por empaque; un componente inactivo se avisa", () => {
    const [line] = buildReceivePreview({
      items: [
        box({
          packRecipe: {
            components: [
              { currentStock: 0, isActive: true, name: "Sabor fresa", unitProductId: "prod-fresa", unitsPerPack: 5 },
              { currentStock: 7, isActive: false, name: "Sabor uva", unitProductId: "prod-uva", unitsPerPack: 1 },
            ],
            conversionId: "rec-surtido",
            totalUnits: 6,
          },
          quantity: 2,
        }),
      ],
    });

    expect(line?.disassemble).toEqual({
      components: [
        { name: "Sabor fresa", productId: "prod-fresa", productInactive: false, quantityIn: 10, stockAfter: 10, stockBefore: 0 },
        { name: "Sabor uva", productId: "prod-uva", productInactive: true, quantityIn: 2, stockAfter: 9, stockBefore: 7 },
      ],
      packsOut: 2,
    });
  });

  it("el stock se encadena: el componente comprado aparte y el que sale de dos líneas acumulan", () => {
    const lines = buildReceivePreview({
      items: [
        item({ id: "item-lata", product: { currentStock: 4, isActive: true, name: "Refresco 355 ml" }, productId: "prod-lata", quantity: 5 }),
        box(),
        box({ id: "item-caja-2", quantity: 1 }),
      ],
    });

    expect(lines.map((line) => [line.stockBefore, line.stockAfter])).toEqual([
      [4, 9],
      [2, 2],
      [2, 2],
    ]);
    expect(lines[1]?.disassemble?.components[0]).toMatchObject({ quantityIn: 18, stockAfter: 27, stockBefore: 9 });
    expect(lines[2]?.disassemble?.components[0]).toMatchObject({ quantityIn: 6, stockAfter: 33, stockBefore: 27 });
  });

  it("línea marcada cuyo producto ya no tiene receta: no se desarma y se señala", () => {
    const [line] = buildReceivePreview({ items: [box({ packRecipe: undefined })] });

    expect(line).toMatchObject({ disassembleUnavailable: true, stockAfter: 5 });
    expect(line).not.toHaveProperty("canDisassemble");
    expect(line).not.toHaveProperty("disassemble");
  });

  it("una línea sin id no se puede desarmar aunque traiga receta (no habría cómo pedirlo)", () => {
    const [line] = buildReceivePreview({ items: [box({ id: undefined })] });

    expect(line).not.toHaveProperty("canDisassemble");
    expect(line).not.toHaveProperty("disassemble");
  });
});

describe("buildReceiveDisassembleRequest (COM-14)", () => {
  const recipe = {
    components: [{ currentStock: 0, isActive: true, name: "Lata", unitProductId: "prod-lata", unitsPerPack: 6 }],
    conversionId: "rec",
    totalUnits: 6,
  };

  it("ninguna línea con receta ni marcada: no se envía la lista (recepción de siempre)", () => {
    expect(buildReceiveDisassembleRequest(buildReceivePreview({ items: [item()] }))).toBeUndefined();
  });

  it("lista exactamente las líneas que la previsualización desarma", () => {
    const lines = buildReceivePreview({
      items: [
        item({ disassembleOnReceive: true, id: "a", packRecipe: recipe, productId: "prod-a" }),
        item({ id: "b", packRecipe: recipe, productId: "prod-b" }),
        item({ id: "c", productId: "prod-c" }),
      ],
    });

    expect(buildReceiveDisassembleRequest(lines)).toEqual([{ purchaseItemId: "a" }]);
  });

  it("todas desmarcadas, o marcada sin receta: lista vacía (no desarmar ninguna)", () => {
    const unmarked = buildReceivePreview(
      { items: [item({ disassembleOnReceive: true, id: "a", packRecipe: recipe })] },
      { disassemble: { a: false } },
    );
    const withoutRecipe = buildReceivePreview({ items: [item({ disassembleOnReceive: true, id: "a" })] });

    expect(buildReceiveDisassembleRequest(unmarked)).toEqual([]);
    expect(buildReceiveDisassembleRequest(withoutRecipe)).toEqual([]);
  });
});
