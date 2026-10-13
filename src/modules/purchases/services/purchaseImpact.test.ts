import {
  computePurchaseImpact,
  type PurchaseImpactInputs,
  type PurchaseImpactRecipe,
} from "./purchaseImpact";

type Product = PurchaseImpactInputs["products"][number];
type Item = PurchaseImpactInputs["items"][number];
type Payment = PurchaseImpactInputs["payments"][number];

function product(id: string, overrides: Partial<Product> = {}): Product {
  return {
    currentCostRef: 1,
    currentStock: 10,
    id,
    isActive: true,
    name: `Producto ${id}`,
    sku: `sku-${id}`,
    ...overrides,
  };
}

function item(id: string, productId: string, quantity: number, overrides: Partial<Item> = {}): Item {
  return {
    disassembled: false,
    disassembleOnReceive: false,
    id,
    productId,
    quantity,
    taxRate: 0,
    unitCostRef: 2,
    ...overrides,
  };
}

function payment(id: string, overrides: Partial<Payment> = {}): Payment {
  return {
    amount: 1000,
    amountRef: 2,
    amountVes: 1000,
    createdAt: "2026-10-01T10:00:00.000Z",
    currency: "VES",
    id,
    method: "transferencia",
    status: "activo",
    ...overrides,
  };
}

function recipe(
  packProductId: string,
  components: PurchaseImpactRecipe["components"],
  totalUnits = components.reduce((total, part) => total + part.unitsPerPack, 0),
): PurchaseImpactRecipe {
  return { components, conversionId: `rec-${packProductId}`, packProductId, totalUnits };
}

function inputs(overrides: Partial<PurchaseImpactInputs>): PurchaseImpactInputs {
  return {
    action: "receive",
    canViewPayments: true,
    disassemble: null,
    items: [],
    payments: [],
    products: [],
    purchase: { id: "pur-1", purchaseNumber: "C-000009", status: "pedido", supplierName: "Proveedor" },
    recipes: [],
    returnedByProduct: {},
    ...overrides,
  };
}

describe("computePurchaseImpact · recibir", () => {
  it("pedido simple: suma el stock por producto y fija el último costo con IVA", () => {
    const impact = computePurchaseImpact(
      inputs({
        items: [
          item("i1", "b", 5, { taxRate: 16, unitCostRef: 3.25 }),
          item("i2", "a", 4, { unitCostRef: 2 }),
          // Mismo producto en otra línea: manda la última por (producto, id).
          item("i3", "b", 2, { taxRate: 8, unitCostRef: 4.8 }),
        ],
        products: [product("a", { isActive: false }), product("b", { currentCostRef: null, currentStock: 0 })],
      }),
    );

    expect(impact).toMatchObject({
      action: "receive",
      allowed: true,
      blockingProducts: [],
      disassemble: [],
      document: { contactName: "Proveedor", number: "C-000009", status: "pedido", statusAfter: "recibido" },
      inexact: null,
      payments: [],
      paymentsRestricted: false,
      reason: null,
    });
    expect(impact.stock).toEqual([
      expect.objectContaining({
        componentsIn: 0,
        disassembledOut: 0,
        productId: "b",
        purchasedIn: 7,
        quantityDelta: 7,
        stockAfter: 7,
        stockBefore: 0,
      }),
      expect.objectContaining({ isActive: false, productId: "a", quantityDelta: 4, stockAfter: 14, stockBefore: 10 }),
    ]);
    expect(impact.costs).toEqual([
      // 4.80 × 1.08 = 5.184 → 5.18
      expect.objectContaining({ costRefAfter: 5.18, costRefBefore: null, productId: "b", source: "purchase_line" }),
      expect.objectContaining({ costRefAfter: 2, costRefBefore: 1, isActive: false, productId: "a" }),
    ]);
  });

  it("redondea el costo con IVA como Postgres (la mitad se aleja de cero)", () => {
    const impact = computePurchaseImpact(
      inputs({
        // 0.05 × 1.10 = 0.055 → 0.06 (en coma flotante saldría 0.05).
        items: [item("i1", "a", 1, { taxRate: 10, unitCostRef: 0.05 })],
        products: [product("a")],
      }),
    );

    expect(impact.costs[0].costRefAfter).toBe(0.06);
  });

  it("línea marcada: el empaque entra y vuelve a salir; el componente sube y queda con costo promedio", () => {
    const impact = computePurchaseImpact(
      inputs({
        items: [item("i1", "pack", 2, { disassembleOnReceive: true, taxRate: 16, unitCostRef: 10 })],
        products: [
          product("pack", { currentCostRef: 9, currentStock: 3 }),
          product("unit", { currentCostRef: 1, currentStock: 20 }),
        ],
        recipes: [recipe("pack", [{ costWeight: 1, unitProductId: "unit", unitsPerPack: 10 }])],
      }),
    );

    expect(impact.allowed).toBe(true);
    expect(impact.stock).toEqual([
      expect.objectContaining({
        disassembledOut: 2,
        productId: "pack",
        purchasedIn: 2,
        quantityDelta: 0,
        stockAfter: 3,
        stockBefore: 3,
      }),
      expect.objectContaining({ componentsIn: 20, productId: "unit", quantityDelta: 20, stockAfter: 40, stockBefore: 20 }),
    ]);
    expect(impact.disassemble).toEqual([
      {
        components: [
          expect.objectContaining({ productId: "unit", stockAfter: 40, stockBefore: 20, unitsIn: 20 }),
        ],
        packProductId: "pack",
        packProductName: "Producto pack",
        packsOut: 2,
        purchaseItemId: "i1",
      },
    ]);
    expect(impact.costs).toEqual([
      // Empaque: 10 × 1.16 = 11.60.
      expect.objectContaining({ costRefAfter: 11.6, costRefBefore: 9, productId: "pack", source: "purchase_line" }),
      // Unidad: (20 × 1.00 + 2 × 11.60) / 40 = 1.08.
      expect.objectContaining({ costRefAfter: 1.08, costRefBefore: 1, productId: "unit", source: "disassemble" }),
    ]);
  });

  it("surtido: reparte el valor por unidades × peso y el de mayor peso se queda el residuo", () => {
    const impact = computePurchaseImpact(
      inputs({
        items: [item("i1", "pack", 1, { disassembleOnReceive: true, unitCostRef: 10 })],
        products: [
          product("pack", { currentStock: 0 }),
          product("c1", { currentStock: 0 }),
          product("c2", { currentStock: 0 }),
          product("c3", { currentStock: 0 }),
        ],
        recipes: [
          recipe("pack", [
            { costWeight: 1, unitProductId: "c1", unitsPerPack: 1 },
            { costWeight: 1, unitProductId: "c2", unitsPerPack: 1 },
            { costWeight: 1, unitProductId: "c3", unitsPerPack: 1 },
          ]),
        ],
      }),
    );

    // 10 / 3 = 3.3333 a c1 y c2; c3 (empate, mayor id) se queda 3.3334. Todos 3.33.
    expect(impact.costs.map((line) => [line.productId, line.costRefAfter])).toEqual([
      ["pack", 10],
      ["c1", 3.33],
      ["c2", 3.33],
      ["c3", 3.33],
    ]);
    expect(impact.stock.map((line) => [line.productId, line.quantityDelta])).toEqual([
      ["pack", 0],
      ["c1", 1],
      ["c2", 1],
      ["c3", 1],
    ]);
  });

  it("un componente que también es línea de la compra acumula y parte del costo que fijó su línea", () => {
    const impact = computePurchaseImpact(
      inputs({
        items: [
          item("i1", "pack", 1, { disassembleOnReceive: true, unitCostRef: 12 }),
          item("i2", "unit", 5, { unitCostRef: 2 }),
        ],
        products: [product("pack", { currentStock: 0 }), product("unit", { currentCostRef: 9, currentStock: 5 })],
        recipes: [recipe("pack", [{ costWeight: 1, unitProductId: "unit", unitsPerPack: 10 }])],
      }),
    );

    expect(impact.stock).toEqual([
      expect.objectContaining({ productId: "pack", quantityDelta: 0 }),
      expect.objectContaining({
        componentsIn: 10,
        productId: "unit",
        purchasedIn: 5,
        quantityDelta: 15,
        stockAfter: 20,
        stockBefore: 5,
      }),
    ]);
    expect(impact.disassemble[0].components[0]).toMatchObject({ stockAfter: 20, stockBefore: 10 });
    // (10 × 2.00 + 12.00) / 20 = 1.60
    expect(impact.costs[1]).toMatchObject({ costRefAfter: 1.6, costRefBefore: 9, source: "disassemble" });
  });

  it("la lista enviada manda sobre las marcas: [] recibe sin desarmar", () => {
    const base = {
      items: [item("i1", "pack", 2, { disassembleOnReceive: true })],
      products: [product("pack"), product("unit")],
      recipes: [recipe("pack", [{ costWeight: 1, unitProductId: "unit", unitsPerPack: 6 }])],
    };

    const none = computePurchaseImpact(inputs({ ...base, disassemble: [] }));

    expect(none.disassemble).toEqual([]);
    expect(none.stock).toEqual([expect.objectContaining({ productId: "pack", quantityDelta: 2 })]);
  });

  it("reparto ajustado de un surtido: cada componente sube lo enviado y el que recibe 0 no cambia", () => {
    const impact = computePurchaseImpact(
      inputs({
        disassemble: [
          {
            distribution: [
              { unitProductId: "c1", units: 4 },
              { unitProductId: "c2", units: 0 },
            ],
            purchaseItemId: "i1",
          },
        ],
        items: [item("i1", "pack", 2, { unitCostRef: 8 })],
        products: [product("pack"), product("c1", { currentStock: 0 }), product("c2")],
        recipes: [
          recipe("pack", [
            { costWeight: 1, unitProductId: "c1", unitsPerPack: 1 },
            { costWeight: 1, unitProductId: "c2", unitsPerPack: 1 },
          ]),
        ],
      }),
    );

    expect(impact.allowed).toBe(true);
    expect(impact.disassemble[0].components).toEqual([
      expect.objectContaining({ productId: "c1", unitsIn: 4 }),
    ]);
    expect(impact.stock.map((line) => line.productId)).toEqual(["pack", "c1"]);
    // 2 × 8.00 / 4 = 4.00; c2 no recibe nada: ni stock ni costo.
    expect(impact.costs.map((line) => [line.productId, line.costRefAfter])).toEqual([
      ["pack", 8],
      ["c1", 4],
    ]);
  });

  it.each([
    [
      "repite una línea",
      [{ purchaseItemId: "i1" }, { purchaseItemId: "i1" }],
      "La lista de lineas a desarmar repite una linea",
    ],
    ["línea ajena", [{ purchaseItemId: "otra" }], "Una linea a desarmar no pertenece a la compra"],
    [
      "componente ajeno a la receta",
      [{ distribution: [{ unitProductId: "x", units: 12 }], purchaseItemId: "i1" }],
      "Un producto de la distribucion no es componente de la receta del empaque",
    ],
    [
      "componente repetido",
      [
        {
          distribution: [
            { unitProductId: "unit", units: 6 },
            { unitProductId: "unit", units: 6 },
          ],
          purchaseItemId: "i1",
        },
      ],
      "La distribucion repite un componente de la receta",
    ],
    [
      "no suma",
      [{ distribution: [{ unitProductId: "unit", units: 5 }], purchaseItemId: "i1" }],
      "La distribucion debe sumar 12 unidades (2 empaques x 6) y suma 5",
    ],
  ])("lista inválida (%s): PT400 de la RPC y nada proyectado", (_name, disassemble, reason) => {
    const impact = computePurchaseImpact(
      inputs({
        disassemble,
        items: [item("i1", "pack", 2)],
        products: [product("pack"), product("unit")],
        recipes: [recipe("pack", [{ costWeight: 1, unitProductId: "unit", unitsPerPack: 6 }])],
      }),
    );

    expect(impact).toMatchObject({ allowed: false, costs: [], disassemble: [], reason, reasonCode: "BAD_REQUEST" });
    expect(impact.document.statusAfter).toBe("pedido");
    expect(impact.stock).toEqual([
      expect.objectContaining({ productId: "pack", quantityDelta: 0, stockAfter: 10, stockBefore: 10 }),
    ]);
  });

  it("línea marcada sin receta activa: PT409 nombrando el producto", () => {
    const impact = computePurchaseImpact(
      inputs({
        items: [item("i1", "pack", 2, { disassembleOnReceive: true })],
        products: [product("pack", { name: "Caja x12" })],
      }),
    );

    expect(impact).toMatchObject({
      allowed: false,
      inexact: null,
      reason:
        "Sin receta de apertura activa: Caja x12. Desmarca «Desarmar al recibir» en esas líneas o activa su receta",
      reasonCode: "CONFLICT",
    });
    expect(impact.blockingProducts).toEqual([expect.objectContaining({ productId: "pack", productName: "Caja x12" })]);
  });

  it("varias líneas sin receta: el orden de los nombres queda declarado inexacto", () => {
    const impact = computePurchaseImpact(
      inputs({
        items: [
          item("i1", "p2", 1, { disassembleOnReceive: true }),
          item("i2", "p1", 1, { disassembleOnReceive: true }),
        ],
        products: [product("p1", { name: "Bulto" }), product("p2", { name: "Caja" })],
      }),
    );

    expect(impact.reason).toContain("Sin receta de apertura activa: Bulto, Caja.");
    expect(impact.inexact?.reason).toContain("orden de los nombres");
  });

  it("no es un pedido: PT409 de receive_purchase antes de mirar la lista", () => {
    const impact = computePurchaseImpact(
      inputs({
        disassemble: [{ purchaseItemId: "otra" }],
        items: [item("i1", "a", 2)],
        products: [product("a")],
        purchase: { id: "pur-1", purchaseNumber: "C-1", status: "recibido", supplierName: null },
      }),
    );

    expect(impact).toMatchObject({
      allowed: false,
      reason: "Solo se pueden recibir compras en estado pedido",
      reasonCode: "CONFLICT",
    });
    expect(impact.document).toMatchObject({ status: "recibido", statusAfter: "recibido" });
  });

  it("producto que ya no existe en la tienda: PT404 con su id", () => {
    const impact = computePurchaseImpact(
      inputs({ items: [item("i1", "b", 1), item("i2", "a", 1)], products: [product("b")] }),
    );

    expect(impact).toMatchObject({ allowed: false, reason: "Producto no encontrado: a", reasonCode: "NOT_FOUND" });
    expect(impact.stock).toEqual([
      expect.objectContaining({ productId: "b", quantityDelta: 0 }),
      expect.objectContaining({ inexact: { reason: expect.any(String) }, productId: "a", stockBefore: null }),
    ]);
    expect(impact.blockingProducts).toEqual([expect.objectContaining({ available: null, productId: "a" })]);
  });

  it("receta incompleta, componente inexistente o empaque sin stock suficiente: rechazos de convert_pack_to_units", () => {
    const base = {
      items: [item("i1", "pack", 2, { disassembleOnReceive: true })],
      products: [product("pack"), product("unit")],
    };

    expect(
      computePurchaseImpact(
        inputs({ ...base, recipes: [recipe("pack", [{ costWeight: 1, unitProductId: "unit", unitsPerPack: 6 }], 12)] }),
      ),
    ).toMatchObject({
      allowed: false,
      reason: "La receta del empaque esta incompleta: sus componentes no suman las unidades del empaque",
      reasonCode: "CONFLICT",
    });
    expect(
      computePurchaseImpact(
        inputs({ ...base, recipes: [recipe("pack", [{ costWeight: 1, unitProductId: "ido", unitsPerPack: 6 }])] }),
      ),
    ).toMatchObject({ allowed: false, reason: "Producto unidad no encontrado", reasonCode: "NOT_FOUND" });
    // Empaque con saldo negativo heredado: tras entrar 2 quedan 1 < 2.
    expect(
      computePurchaseImpact(
        inputs({
          ...base,
          products: [product("pack", { currentStock: -1 }), product("unit")],
          recipes: [recipe("pack", [{ costWeight: 1, unitProductId: "unit", unitsPerPack: 6 }])],
        }),
      ),
    ).toMatchObject({
      allowed: false,
      blockingProducts: [expect.objectContaining({ available: 1, productId: "pack", required: 2 })],
      reason: "Stock insuficiente de empaque",
      reasonCode: "CONFLICT",
    });
  });

  it("saldo que seguiría negativo tras entrar: PT409 del libro de stock", () => {
    const impact = computePurchaseImpact(
      inputs({ items: [item("i1", "a", 2)], products: [product("a", { currentStock: -5 })] }),
    );

    expect(impact).toMatchObject({ allowed: false, reason: "Stock insuficiente", reasonCode: "CONFLICT" });
  });

  it("costo o peso ilegible: el stock se predice y el costo queda inexacto, sin cifra", () => {
    const impact = computePurchaseImpact(
      inputs({
        items: [item("i1", "pack", 1, { disassembleOnReceive: true, unitCostRef: 10 })],
        products: [product("pack"), product("unit")],
        recipes: [recipe("pack", [{ costWeight: Number.NaN, unitProductId: "unit", unitsPerPack: 4 }])],
      }),
    );

    expect(impact.allowed).toBe(true);
    expect(impact.stock[1]).toMatchObject({ productId: "unit", stockAfter: 14 });
    expect(impact.costs[1]).toMatchObject({ costRefAfter: null, inexact: { reason: expect.any(String) } });
    expect(impact.inexact).not.toBeNull();
  });
});

describe.each([
  ["cancel", "cancelado", "cancela", "cancelar"],
  ["return", "devuelto", "devuelve", "devolver"],
] as const)("computePurchaseImpact · %s", (action, statusAfter, imperative, infinitive) => {
  const received = { id: "pur-1", purchaseNumber: "C-000009", status: "recibido" as const, supplierName: "Proveedor" };

  it("recibida sin pagos: salen las unidades (menos lo ya devuelto) y no toca costos", () => {
    const impact = computePurchaseImpact(
      inputs({
        action,
        items: [item("i1", "b", 3), item("i2", "a", 4), item("i3", "b", 2)],
        products: [product("a", { isActive: false }), product("b")],
        purchase: received,
        returnedByProduct: { a: 1 },
      }),
    );

    expect(impact).toMatchObject({
      action,
      allowed: true,
      blockingProducts: [],
      costs: [],
      disassemble: [],
      document: { status: "recibido", statusAfter },
      inexact: null,
      payments: [],
    });
    expect(impact.stock).toEqual([
      expect.objectContaining({ productId: "b", quantityDelta: -5, stockAfter: 5, stockBefore: 10 }),
      expect.objectContaining({ isActive: false, productId: "a", quantityDelta: -3, stockAfter: 7, stockBefore: 10 }),
    ]);
  });

  it("con pagos activos: PT409 con el número, la cuenta y la suma; cada pago bloquea", () => {
    const impact = computePurchaseImpact(
      inputs({
        action,
        items: [item("i1", "a", 4)],
        payments: [
          payment("p2", { amountVes: 250.5, createdAt: "2026-10-02T10:00:00.000Z", method: "efectivo_ves" }),
          payment("p1", { amountVes: 1000 }),
          payment("p0", { createdAt: "2026-09-30T10:00:00.000Z", status: "anulado" }),
        ],
        products: [product("a")],
        purchase: received,
      }),
    );

    expect(impact).toMatchObject({
      allowed: false,
      reason: `La compra C-000009 tiene 2 pago(s) activo(s) por Bs 1250.50. Anula primero los pagos y luego ${imperative} la compra.`,
      reasonCode: "CONFLICT",
    });
    expect(impact.document.statusAfter).toBe("recibido");
    expect(impact.payments.map((line) => [line.paymentId, line.outcome, line.statusAfter])).toEqual([
      ["p0", "already_cancelled", "anulado"],
      ["p1", "blocks_action", "activo"],
      ["p2", "blocks_action", "activo"],
    ]);
    expect(impact.payments[1]).toMatchObject({
      changeVes: 0,
      description: `Sigue activo: hay que anularlo antes de ${infinitive} la compra.`,
      effects: [],
      netVes: 1000,
    });
    // Sin proyección y sin productos culpables: la RPC no llegó a mirar el stock.
    expect(impact.stock).toEqual([expect.objectContaining({ quantityDelta: 0, stockAfter: 10, stockBefore: 10 })]);
    expect(impact.blockingProducts).toEqual([]);
  });

  it("quien no ve pagos de compras recibe el mismo veredicto, sin líneas de pago", () => {
    const impact = computePurchaseImpact(
      inputs({
        action,
        canViewPayments: false,
        items: [item("i1", "a", 4)],
        payments: [payment("p1")],
        products: [product("a")],
        purchase: received,
      }),
    );

    expect(impact).toMatchObject({ allowed: false, payments: [], paymentsRestricted: true, reasonCode: "CONFLICT" });
    expect(impact.reason).toContain("1 pago(s) activo(s) por Bs 1000.00");
  });

  it("con el pago ya anulado: pasa y el pago no cambia", () => {
    const impact = computePurchaseImpact(
      inputs({
        action,
        items: [item("i1", "a", 4)],
        payments: [payment("p1", { status: "anulado" })],
        products: [product("a")],
        purchase: received,
      }),
    );

    expect(impact.allowed).toBe(true);
    expect(impact.payments).toEqual([
      expect.objectContaining({ effects: [], outcome: "already_cancelled", status: "anulado", statusAfter: "anulado" }),
    ]);
  });

  it("stock ya vendido: PT409 exacto, sin proyección y con todos los productos que no alcanzan", () => {
    const impact = computePurchaseImpact(
      inputs({
        action,
        items: [item("i1", "c", 4), item("i2", "a", 6), item("i3", "b", 2)],
        products: [product("a", { currentStock: 5 }), product("b"), product("c", { currentStock: 0 })],
        purchase: received,
      }),
    );

    expect(impact).toMatchObject({
      allowed: false,
      reason: "No hay stock suficiente para revertir la compra",
      reasonCode: "CONFLICT",
    });
    expect(impact.blockingProducts).toEqual([
      { available: 5, productId: "a", productName: "Producto a", required: 6, sku: "sku-a" },
      { available: 0, productId: "c", productName: "Producto c", required: 4, sku: "sku-c" },
    ]);
    expect(impact.stock.every((line) => line.quantityDelta === 0 && line.stockAfter === line.stockBefore)).toBe(true);
    expect(impact.document.statusAfter).toBe("recibido");
  });

  it("todo ya devuelto con ajustes: no mueve nada aunque el stock esté en cero", () => {
    const impact = computePurchaseImpact(
      inputs({
        action,
        items: [item("i1", "a", 4)],
        products: [product("a", { currentStock: 0 })],
        purchase: received,
        returnedByProduct: { a: 4 },
      }),
    );

    expect(impact.allowed).toBe(true);
    expect(impact.stock).toEqual([expect.objectContaining({ quantityDelta: 0, stockAfter: 0, stockBefore: 0 })]);
  });

  it("producto que ya no existe: PT404 si va antes (por id) que el que no alcanza", () => {
    const impact = computePurchaseImpact(
      inputs({
        action,
        items: [item("i1", "b", 20), item("i2", "a", 1)],
        products: [product("b")],
        purchase: received,
      }),
    );

    expect(impact).toMatchObject({
      allowed: false,
      reason: "Producto no encontrado en tu tienda (a): no se puede revertir el stock de la compra C-000009",
      reasonCode: "NOT_FOUND",
    });
  });

  it.each(["cancelado", "devuelto"] as const)("ya %s: PT409 y los pagos activos no se tocan", (status) => {
    const impact = computePurchaseImpact(
      inputs({
        action,
        items: [item("i1", "a", 4)],
        payments: [payment("p1")],
        products: [product("a")],
        purchase: { ...received, status },
      }),
    );

    expect(impact).toMatchObject({
      allowed: false,
      reason: "La compra ya fue cancelada o devuelta",
      reasonCode: "CONFLICT",
      stock: [],
    });
    expect(impact.payments[0]).toMatchObject({ outcome: "unchanged" });
    expect(impact.document.statusAfter).toBe(status);
  });
});

describe("computePurchaseImpact · pedido", () => {
  const ordered = {
    items: [item("i1", "a", 4)],
    products: [product("a")],
  };

  it("cancelar un pedido: cambia el estado y no mueve stock", () => {
    const impact = computePurchaseImpact(inputs({ ...ordered, action: "cancel" }));

    expect(impact).toMatchObject({ allowed: true, costs: [], stock: [] });
    expect(impact.document).toMatchObject({ status: "pedido", statusAfter: "cancelado" });
  });

  it("devolver un pedido: PT409, solo se devuelve lo recibido", () => {
    const impact = computePurchaseImpact(inputs({ ...ordered, action: "return" }));

    expect(impact).toMatchObject({
      allowed: false,
      reason: "Solo se pueden devolver compras recibidas",
      reasonCode: "CONFLICT",
      stock: [],
    });
  });

  it("devolver un pedido con pago activo: gana el rechazo de los pagos, como en la RPC", () => {
    const impact = computePurchaseImpact(
      inputs({ ...ordered, action: "return", payments: [payment("p1")] }),
    );

    expect(impact.reason).toContain("1 pago(s) activo(s)");
  });
});
