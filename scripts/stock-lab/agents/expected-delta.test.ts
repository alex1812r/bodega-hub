import { expectedDelta, expectedDeltaFor } from "./expected-delta";

describe("expectedDelta", () => {
  it("sale_create: −q por línea y suma líneas repetidas", () => {
    expect(
      expectedDelta("sale_create", {
        items: [
          { productId: "a", quantity: 2 },
          { productId: "b", quantity: 1 },
          { productId: "a", quantity: 3 },
        ],
      }),
    ).toEqual({ a: -5, b: -1 });
  });

  it("sale_cancel y sale_return: +q (devolución total)", () => {
    const items = [
      { productId: "a", quantity: 2 },
      { productId: "b", quantity: 4 },
    ];
    expect(expectedDelta("sale_cancel", { items })).toEqual({ a: 2, b: 4 });
    expect(expectedDelta("sale_return", { items })).toEqual({ a: 2, b: 4 });
  });

  it("purchase_create recibido: +q en modo unidad y +packCount×unitsPerPack en modo empaque", () => {
    expect(
      expectedDelta("purchase_create", {
        status: "recibido",
        items: [
          { productId: "u", quantity: 10 },
          { productId: "p", packCount: 3, unitsPerPack: 12 },
          { productId: "u", packCount: 1, unitsPerPack: 6 },
        ],
      }),
    ).toEqual({ u: 16, p: 36 });
  });

  it("purchase_create pedido: {} aunque tenga líneas", () => {
    expect(
      expectedDelta("purchase_create", {
        status: "pedido",
        items: [{ productId: "u", quantity: 10 }],
      }),
    ).toEqual({});
  });

  it("purchase_receive: +q (×upp) de las líneas", () => {
    expect(
      expectedDelta("purchase_receive", {
        items: [
          { productId: "u", quantity: 5 },
          { productId: "p", packCount: 2, unitsPerPack: 24 },
        ],
      }),
    ).toEqual({ u: 5, p: 48 });
  });

  it("purchase_cancel / purchase_return sobre recibido: −q (×upp); sobre pedido: {}", () => {
    const items = [
      { productId: "u", quantity: 5 },
      { productId: "p", packCount: 2, unitsPerPack: 6 },
    ];
    expect(expectedDelta("purchase_cancel", { status: "recibido", items })).toEqual({ u: -5, p: -12 });
    expect(expectedDelta("purchase_return", { status: "recibido", items })).toEqual({ u: -5, p: -12 });
    expect(expectedDelta("purchase_cancel", { status: "pedido", items })).toEqual({});
    expect(expectedDelta("purchase_return", { status: "pedido", items })).toEqual({});
  });

  it("adjustment: delta con signo; 0 → {}", () => {
    expect(expectedDelta("adjustment", { productId: "a", quantityDelta: -7 })).toEqual({ a: -7 });
    expect(expectedDelta("adjustment", { productId: "a", quantityDelta: 4 })).toEqual({ a: 4 });
    expect(expectedDelta("adjustment", { productId: "a", quantityDelta: 0 })).toEqual({});
  });

  it("conversion: −packQuantity en el empaque y +packQuantity×unitsPerPack en la unidad", () => {
    expect(
      expectedDelta("conversion", {
        packProductId: "pack",
        unitProductId: "unit",
        packQuantity: 2,
        unitsPerPack: 12,
      }),
    ).toEqual({ pack: -2, unit: 24 });
  });

  it("product_create: +initialStock; 0 → {}", () => {
    expect(expectedDelta("product_create", { productId: "new", initialStock: 30 })).toEqual({ new: 30 });
    expect(expectedDelta("product_create", { productId: "new", initialStock: 0 })).toEqual({});
  });

  it("noop: {}", () => {
    expect(expectedDelta("noop", undefined)).toEqual({});
    expect(expectedDelta("noop", {})).toEqual({});
  });

  it("líneas con quantity 0 o sin cantidad no aparecen en el resultado", () => {
    expect(
      expectedDelta("sale_create", {
        items: [
          { productId: "a", quantity: 0 },
          { productId: "b", quantity: 1 },
        ],
      }),
    ).toEqual({ b: -1 });
    expect(expectedDelta("purchase_receive", { items: [{ productId: "x" }] })).toEqual({});
  });

  it("expectedDeltaFor acepta la unión discriminada", () => {
    expect(
      expectedDeltaFor({ op: "sale_create", input: { items: [{ productId: "a", quantity: 1 }] } }),
    ).toEqual({ a: -1 });
    expect(expectedDeltaFor({ op: "noop", input: undefined })).toEqual({});
  });
});
