import { dedupeIdempotentReplays, expectedDelta, expectedDeltaFor } from "./expected-delta";
import type { LabEvent } from "./logger";

describe("dedupeIdempotentReplays (STK-514)", () => {
  const ev = (over: Partial<LabEvent>): LabEvent => ({
    ts: "2026-10-06T10:00:00.000Z",
    agent: "vendedor-1",
    op: "sale_create",
    payload: { clientRequestId: "k1" },
    status: 201,
    response_id: "sale-1",
    expected_delta: { p: -2 },
    ...over,
  });

  it("dos 2xx con la misma clave y el mismo response_id cuentan el descuento una sola vez", () => {
    const events = [ev({}), ev({ ts: "2026-10-06T10:00:01.000Z" }), ev({ agent: "caos", op: "chaos_double_sale", status: 200 })];
    const out = dedupeIdempotentReplays(events);
    expect(out.map((e) => e.expected_delta)).toEqual([{ p: -2 }, {}, {}]);
    expect(out.map((e) => e.status)).toEqual([201, 201, 200]);
    // No muta la entrada.
    expect(events[1]?.expected_delta).toEqual({ p: -2 });
  });

  it("misma clave con ids distintos (venta duplicada) conserva ambos esperados: es el bug a detectar", () => {
    const out = dedupeIdempotentReplays([ev({}), ev({ response_id: "sale-2" })]);
    expect(out.map((e) => e.expected_delta)).toEqual([{ p: -2 }, { p: -2 }]);
  });

  it("no toca cancelaciones/devoluciones (mismo response_id, sin clave) ni eventos sin id o no-2xx", () => {
    const cancel = ev({ op: "sale_cancel", payload: { saleId: "sale-1" }, status: 200, expected_delta: { p: 2 } });
    const rejected = ev({ status: 409, expected_delta: {} });
    const noId = ev({ response_id: null });
    const out = dedupeIdempotentReplays([ev({}), cancel, cancel, rejected, noId, noId]);
    expect(out.map((e) => e.expected_delta)).toEqual([{ p: -2 }, { p: 2 }, { p: 2 }, {}, { p: -2 }, { p: -2 }]);
  });

  it("claves distintas no se mezclan aunque el payload no sea un objeto", () => {
    const out = dedupeIdempotentReplays([ev({ payload: null }), ev({ payload: "x" }), ev({ payload: { clientRequestId: " " } })]);
    expect(out.every((e) => e.expected_delta.p === -2)).toBe(true);
  });
});

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

  it("STK-519 (C13): modo empaque sobre el SKU EMPAQUE de un par ingresa packCount empaques, no packCount×unitsPerPack", () => {
    const items = [
      { productId: "caja", packCount: 3, unitsPerPack: 12, stockInPacks: true },
      { productId: "unidad", packCount: 2, unitsPerPack: 12 },
    ];
    expect(expectedDelta("purchase_create", { status: "recibido", items })).toEqual({ caja: 3, unidad: 24 });
    expect(expectedDelta("purchase_receive", { items })).toEqual({ caja: 3, unidad: 24 });
    expect(expectedDelta("purchase_cancel", { status: "recibido", items })).toEqual({ caja: -3, unidad: -24 });
    expect(expectedDelta("purchase_return", { status: "recibido", items })).toEqual({ caja: -3, unidad: -24 });
    expect(expectedDelta("purchase_create", { status: "pedido", items })).toEqual({});
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
