import { receivePurchaseBodySchema, toRpcDisassembleList } from "../../services/purchaseDisassemble";
import {
  buildReceiveDisassembleRequest,
  buildReceivePreview,
  findReceiveDistributionError,
  parseReceiveDistribution,
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
              unitsPerPack: 6,
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
      canAdjustDistribution: true,
      components: [
        { name: "Sabor fresa", productId: "prod-fresa", productInactive: false, quantityIn: 10, stockAfter: 10, stockBefore: 0, unitsPerPack: 5 },
        { name: "Sabor uva", productId: "prod-uva", productInactive: true, quantityIn: 2, stockAfter: 9, stockBefore: 7, unitsPerPack: 1 },
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

describe("buildReceivePreview · reparto ajustado de un surtido (COM-14, flujo 11)", () => {
  /** 3 cajas surtidas de 6: 2 Cola + 2 Manzana + 2 Naranja por caja. */
  const assortedRecipe = {
    components: [
      { currentStock: 4, isActive: true, name: "Cola", unitProductId: "prod-cola", unitsPerPack: 2 },
      { currentStock: 0, isActive: true, name: "Manzana", unitProductId: "prod-manzana", unitsPerPack: 2 },
      { currentStock: 1, isActive: true, name: "Naranja", unitProductId: "prod-naranja", unitsPerPack: 2 },
    ],
    conversionId: "rec-surtida",
    totalUnits: 6,
  };

  function assorted(overrides: Partial<Item> = {}): Item {
    return item({
      disassembleOnReceive: true,
      id: "item-surtida",
      packRecipe: assortedRecipe,
      product: { currentStock: 0, isActive: true, name: "Caja surtida" },
      productId: "prod-surtida",
      quantity: 3,
      unitCostRef: 12,
      ...overrides,
    });
  }

  /** Dos cajas por receta (2-2-2) y una ajustada a 3-1-2. */
  const adjusted = { "prod-cola": 7, "prod-manzana": 5, "prod-naranja": 6 };
  const quantities = (line: ReturnType<typeof buildReceivePreview>[number] | undefined) =>
    line?.disassemble?.components.map((component) => [component.name, component.quantityIn, component.stockBefore, component.stockAfter]);

  it("sin reparto abre por receta: +6 / +6 / +6, se puede ajustar y no se envía distribution", () => {
    const [line] = buildReceivePreview({ items: [assorted()] });

    expect(quantities(line)).toEqual([
      ["Cola", 6, 4, 10],
      ["Manzana", 6, 0, 6],
      ["Naranja", 6, 1, 7],
    ]);
    expect(line?.disassemble).toMatchObject({ canAdjustDistribution: true, packsOut: 3 });
    expect(line?.disassemble).not.toHaveProperty("distribution");
    expect(line?.disassemble).not.toHaveProperty("distributionError");
    expect(buildReceiveDisassembleRequest([line!])).toEqual([{ purchaseItemId: "item-surtida" }]);
  });

  it("una caja a 3-1-2: −3 cajas, +7 Cola, +5 Manzana, +6 Naranja y el stock después de cada uno", () => {
    const [line] = buildReceivePreview(
      { items: [assorted()] },
      { distribution: { "item-surtida": adjusted } },
    );

    expect(line).toMatchObject({ quantityIn: 3, stockAfter: 0, stockBefore: 0 });
    expect(line?.disassemble?.packsOut).toBe(3);
    expect(quantities(line)).toEqual([
      ["Cola", 7, 4, 11],
      ["Manzana", 5, 0, 5],
      ["Naranja", 6, 1, 7],
    ]);
    expect(line?.disassemble).not.toHaveProperty("distributionError");
    expect(findReceiveDistributionError([line!])).toBeNull();
  });

  it("la petición lleva ese reparto como distribution, en el orden de la receta, con el formato que aceptan el BFF y la RPC", () => {
    const lines = buildReceivePreview(
      { items: [assorted()] },
      { distribution: { "item-surtida": adjusted } },
    );
    const disassemble = buildReceiveDisassembleRequest(lines);

    expect(disassemble).toEqual([
      {
        distribution: [
          { unitProductId: "prod-cola", units: 7 },
          { unitProductId: "prod-manzana", units: 5 },
          { unitProductId: "prod-naranja", units: 6 },
        ],
        purchaseItemId: "item-surtida",
      },
    ]);
    expect(receivePurchaseBodySchema.parse({ disassemble })).toEqual({ disassemble });
    expect(toRpcDisassembleList(disassemble ?? [])).toEqual([
      {
        components: [
          { unit_product_id: "prod-cola", units: 7 },
          { unit_product_id: "prod-manzana", units: 5 },
          { unit_product_id: "prod-naranja", units: 6 },
        ],
        purchase_item_id: "item-surtida",
      },
    ]);
  });

  it("un componente en 0 viaja en 0 y uno sin entrada conserva lo de la receta", () => {
    const [line] = buildReceivePreview(
      { items: [assorted()] },
      { distribution: { "item-surtida": { "prod-cola": 12, "prod-manzana": 0 } } },
    );

    expect(quantities(line)?.map(([, quantityIn]) => quantityIn)).toEqual([12, 0, 6]);
    expect(line?.disassemble?.distribution).toEqual([
      { unitProductId: "prod-cola", units: 12 },
      { unitProductId: "prod-manzana", units: 0 },
      { unitProductId: "prod-naranja", units: 6 },
    ]);
  });

  it("un reparto igual al de la receta no es un ajuste: la línea viaja sin distribution", () => {
    const lines = buildReceivePreview(
      { items: [assorted()] },
      { distribution: { "item-surtida": { "prod-cola": 6, "prod-manzana": 6, "prod-naranja": 6 } } },
    );

    expect(buildReceiveDisassembleRequest(lines)).toEqual([{ purchaseItemId: "item-surtida" }]);
  });

  it("reparto que no suma 18: la línea lleva el motivo, no lleva distribution y bloquea la recepción", () => {
    const short = buildReceivePreview(
      { items: [assorted()] },
      { distribution: { "item-surtida": { ...adjusted, "prod-naranja": 5 } } },
    );
    const over = buildReceivePreview(
      { items: [assorted()] },
      { distribution: { "item-surtida": { ...adjusted, "prod-naranja": 8 } } },
    );

    expect(short[0]?.disassemble?.distributionError).toBe(
      "Faltan 1 unidad(es) por repartir: el reparto debe sumar 18.",
    );
    expect(short[0]?.disassemble).not.toHaveProperty("distribution");
    // Los efectos siguen a lo tecleado, para que el usuario vea qué está repartiendo.
    expect(quantities(short[0])?.map(([, quantityIn]) => quantityIn)).toEqual([7, 5, 5]);
    expect(findReceiveDistributionError(short)).toBe(
      "Caja surtida: Faltan 1 unidad(es) por repartir: el reparto debe sumar 18.",
    );
    expect(findReceiveDistributionError(over)).toBe(
      "Caja surtida: Sobran 2 unidad(es): el reparto debe sumar 18.",
    );
  });

  it("cantidades negativas, con decimales o que no son un número: reparto inválido", () => {
    for (const bad of [-1, 2.5, Number.NaN]) {
      const lines = buildReceivePreview(
        { items: [assorted()] },
        { distribution: { "item-surtida": { ...adjusted, "prod-cola": bad } } },
      );

      expect(lines[0]?.disassemble?.distributionError).toBe(
        "Las unidades del reparto deben ser enteros mayores o iguales a cero.",
      );
      expect(lines[0]?.disassemble).not.toHaveProperty("distribution");
    }
  });

  it("línea desmarcada: su reparto se ignora y no bloquea", () => {
    const lines = buildReceivePreview(
      { items: [assorted()] },
      {
        disassemble: { "item-surtida": false },
        distribution: { "item-surtida": { ...adjusted, "prod-naranja": 1 } },
      },
    );

    expect(lines[0]).not.toHaveProperty("disassemble");
    expect(lines[0]).toMatchObject({ canDisassemble: true, stockAfter: 3 });
    expect(findReceiveDistributionError(lines)).toBeNull();
    expect(buildReceiveDisassembleRequest(lines)).toEqual([]);
  });

  it("receta simple (un componente): no se puede ajustar y un reparto enviado se ignora", () => {
    const simple = assorted({
      packRecipe: {
        components: [assortedRecipe.components[0]!],
        conversionId: "rec-simple",
        totalUnits: 2,
      },
    });
    const [line] = buildReceivePreview(
      { items: [simple] },
      { distribution: { "item-surtida": { "prod-cola": 1 } } },
    );

    expect(line?.disassemble).not.toHaveProperty("canAdjustDistribution");
    expect(line?.disassemble).not.toHaveProperty("distribution");
    expect(line?.disassemble).not.toHaveProperty("distributionError");
    expect(quantities(line)).toEqual([["Cola", 6, 4, 10]]);
  });

  it("el stock encadenado sigue al reparto: el componente que además se compra aparte acumula lo ajustado", () => {
    const lines = buildReceivePreview(
      {
        items: [
          assorted(),
          item({ id: "item-cola", product: { currentStock: 4, isActive: true, name: "Cola" }, productId: "prod-cola", quantity: 10 }),
        ],
      },
      { distribution: { "item-surtida": adjusted } },
    );

    expect(lines[1]).toMatchObject({ stockAfter: 21, stockBefore: 11 });
  });
});

describe("parseReceiveDistribution (COM-14)", () => {
  const recipe = {
    components: [
      { currentStock: 0, isActive: true, name: "Cola", unitProductId: "prod-cola", unitsPerPack: 2 },
      { currentStock: 0, isActive: true, name: "Manzana", unitProductId: "prod-manzana", unitsPerPack: 2 },
    ],
    conversionId: "rec",
    totalUnits: 4,
  };
  const purchase = {
    items: [
      item({ disassembleOnReceive: true, id: "a", packRecipe: recipe, quantity: 3 }),
      item({ id: "b", productId: "prod-b" }),
    ],
  };

  it("lo tecleado pasa a unidades: vacío = 0, sin tocar = receta × empaques, texto no entero = NaN", () => {
    expect(parseReceiveDistribution(purchase, { a: { "prod-cola": "7" } })).toEqual({
      a: { "prod-cola": 7, "prod-manzana": 6 },
    });
    expect(parseReceiveDistribution(purchase, { a: { "prod-cola": "", "prod-manzana": "12" } })).toEqual({
      a: { "prod-cola": 0, "prod-manzana": 12 },
    });
    expect(parseReceiveDistribution(purchase, { a: { "prod-cola": "2.5" } }).a?.["prod-cola"]).toBeNaN();
  });

  it("sin nada tecleado, o en una línea sin receta, no hay reparto", () => {
    expect(parseReceiveDistribution(purchase, {})).toEqual({});
    expect(parseReceiveDistribution(purchase, { a: {}, b: { "prod-cola": "1" } })).toEqual({});
  });
});
