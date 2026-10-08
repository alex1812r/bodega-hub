/** INV-05 · reglas puras de la reposición: cantidad sugerida, proveedor y agrupación. */
import {
  getRestockGroupLabel,
  groupRestockLines,
  isValidRestockQuantity,
  pickRestockSupplier,
  RESTOCK_NO_SUPPLIER_KEY,
  suggestRestockQuantity,
  type RestockLine,
  type RestockSupplierLink,
} from "./restockPlan";

function link(
  supplierId: string,
  name: string,
  overrides: Partial<RestockSupplierLink> = {},
): RestockSupplierLink {
  return {
    isActive: true,
    isPreferred: false,
    lastCostRef: 0,
    supplier: { id: supplierId, isActive: true, name },
    supplierId,
    ...overrides,
  };
}

function line(productId: string, suggestedQuantity: number): RestockLine {
  return {
    currentStock: 0,
    minStock: 5,
    name: productId,
    productId,
    sku: productId.toUpperCase(),
    suggestedQuantity,
  };
}

describe("suggestRestockQuantity", () => {
  it.each([
    // [mínimo, stock, sugerida]
    [5, 2, 8],
    [5, 0, 10],
    [5, 5, 5],
    [10, 3, 17],
  ])("mínimo %p y stock %p → %p", (minStock, currentStock, expected) => {
    expect(suggestRestockQuantity(minStock, currentStock)).toBe(expected);
  });

  it("el stock negativo cuenta como es", () => {
    expect(suggestRestockQuantity(5, -3)).toBe(13);
    expect(suggestRestockQuantity(0, -4)).toBe(4);
  });

  it("con mínimo 0 sugiere 1", () => {
    expect(suggestRestockQuantity(0, 0)).toBe(1);
  });

  it("nunca sugiere menos de 1", () => {
    expect(suggestRestockQuantity(2, 4)).toBe(1);
    expect(suggestRestockQuantity(2, 50)).toBe(1);
  });

  it("devuelve un entero: los decimales se redondean hacia arriba", () => {
    expect(suggestRestockQuantity(2.5, 1.2)).toBe(4);
    expect(suggestRestockQuantity(1, 1.5)).toBe(1);
  });

  it("con datos no numéricos sugiere 1", () => {
    expect(suggestRestockQuantity(Number.NaN, 2)).toBe(1);
    expect(suggestRestockQuantity(5, Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe("isValidRestockQuantity", () => {
  it("solo acepta enteros de 1 en adelante", () => {
    expect(isValidRestockQuantity(1)).toBe(true);
    expect(isValidRestockQuantity(250)).toBe(true);
    expect(isValidRestockQuantity(0)).toBe(false);
    expect(isValidRestockQuantity(-2)).toBe(false);
    expect(isValidRestockQuantity(1.5)).toBe(false);
    expect(isValidRestockQuantity(null)).toBe(false);
    expect(isValidRestockQuantity(undefined)).toBe(false);
  });
});

describe("pickRestockSupplier", () => {
  it("elige el habitual aunque otro haya vendido más reciente", () => {
    expect(
      pickRestockSupplier([
        link("s-1", "Alfa", { lastPurchasedAt: "2026-10-07T10:00:00.000Z" }),
        link("s-2", "Beta", {
          isPreferred: true,
          lastCostRef: 2.5,
          lastPurchasedAt: "2026-01-01T10:00:00.000Z",
        }),
      ]),
    ).toEqual({ id: "s-2", lastCostRef: 2.5, name: "Beta" });
  });

  it("sin habitual elige el de la compra más reciente", () => {
    expect(
      pickRestockSupplier([
        link("s-1", "Alfa", { lastCostRef: 1, lastPurchasedAt: "2026-09-01T10:00:00.000Z" }),
        link("s-2", "Beta", { lastCostRef: 3, lastPurchasedAt: "2026-10-01T10:00:00.000Z" }),
        link("s-3", "Gamma"),
      ]),
    ).toEqual({ id: "s-2", lastCostRef: 3, name: "Beta" });
  });

  it("sin habitual ni compras previas no elige ninguno", () => {
    expect(pickRestockSupplier([link("s-1", "Alfa"), link("s-2", "Beta")])).toBeNull();
    expect(pickRestockSupplier([])).toBeNull();
  });

  it("ignora vínculos inactivos, proveedores inactivos y filas sin proveedor", () => {
    expect(
      pickRestockSupplier([
        link("s-1", "Alfa", { isActive: false, isPreferred: true }),
        link("s-2", "Beta", {
          lastPurchasedAt: "2026-10-05T10:00:00.000Z",
          supplier: { id: "s-2", isActive: false, name: "Beta" },
        }),
        link("s-3", "Gamma", { lastPurchasedAt: "2026-10-06T10:00:00.000Z", supplier: null }),
        link("s-4", "Delta", { lastPurchasedAt: "2026-08-01T10:00:00.000Z" }),
      ]),
    ).toEqual({ id: "s-4", name: "Delta" });
  });

  it("no lleva costo si el vínculo no tiene (0 = sin costo)", () => {
    expect(pickRestockSupplier([link("s-1", "Alfa", { isPreferred: true })])).toEqual({
      id: "s-1",
      name: "Alfa",
    });
  });

  it("a igual fecha decide el nombre, sin depender del orden de llegada", () => {
    const sameDay = "2026-10-01T10:00:00.000Z";
    const a = link("s-9", "Alfa", { lastPurchasedAt: sameDay });
    const b = link("s-1", "Beta", { lastPurchasedAt: sameDay });

    expect(pickRestockSupplier([a, b])?.id).toBe("s-9");
    expect(pickRestockSupplier([b, a])?.id).toBe("s-9");
  });

  it("una fecha ilegible no cuenta como compra", () => {
    expect(pickRestockSupplier([link("s-1", "Alfa", { lastPurchasedAt: "ayer" })])).toBeNull();
  });
});

describe("groupRestockLines", () => {
  const alfa = { id: "s-1", name: "Alfa" };
  const beta = { id: "s-2", name: "Beta" };

  it("agrupa por proveedor, suma unidades y deja 'Sin proveedor' al final", () => {
    const groups = groupRestockLines([
      { line: line("p-1", 4), supplier: null },
      { line: line("p-2", 10), supplier: beta },
      { line: line("p-3", 3), supplier: alfa },
      { line: line("p-4", 2), supplier: beta },
      { line: line("p-5", 1), supplier: null },
    ]);

    expect(groups.map((group) => [group.key, getRestockGroupLabel(group), group.totalUnits])).toEqual(
      [
        ["s-1", "Alfa", 3],
        ["s-2", "Beta", 12],
        [RESTOCK_NO_SUPPLIER_KEY, "Sin proveedor", 5],
      ],
    );
    expect(groups[1].lines.map((item) => item.productId)).toEqual(["p-2", "p-4"]);
    expect(groups[2].supplier).toBeNull();
  });

  it("nunca mezcla dos proveedores en un grupo aunque se llamen igual", () => {
    const groups = groupRestockLines([
      { line: line("p-1", 1), supplier: { id: "s-1", name: "Distribuidora" } },
      { line: line("p-2", 1), supplier: { id: "s-2", name: "Distribuidora" } },
    ]);

    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.lines.length)).toEqual([1, 1]);
  });

  it("sin productos no hay grupos", () => {
    expect(groupRestockLines([])).toEqual([]);
  });
});
