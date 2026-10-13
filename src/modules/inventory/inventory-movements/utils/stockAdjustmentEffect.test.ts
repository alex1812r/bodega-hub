import { computeStockAdjustmentEffect } from "./stockAdjustmentEffect";

describe("computeStockAdjustmentEffect", () => {
  it("entrada: suma al stock", () => {
    expect(computeStockAdjustmentEffect({ currentStock: 12, delta: 5 })).toEqual({
      delta: 5,
      stockAfter: 17,
      stockBefore: 12,
      wouldBeNegative: false,
    });
  });

  it("salida: resta del stock", () => {
    expect(computeStockAdjustmentEffect({ currentStock: 12, delta: -5 })).toEqual({
      delta: -5,
      stockAfter: 7,
      stockBefore: 12,
      wouldBeNegative: false,
    });
  });

  it("salida de todo el stock: queda en 0, no es negativo", () => {
    expect(computeStockAdjustmentEffect({ currentStock: 5, delta: -5 })).toMatchObject({
      stockAfter: 0,
      wouldBeNegative: false,
    });
  });

  it("salida mayor que el stock: quedaría negativo", () => {
    expect(computeStockAdjustmentEffect({ currentStock: 5, delta: -6 })).toEqual({
      delta: -6,
      stockAfter: -1,
      stockBefore: 5,
      wouldBeNegative: true,
    });
  });

  it("sin stock, cualquier salida quedaría negativa y una entrada no", () => {
    expect(computeStockAdjustmentEffect({ currentStock: 0, delta: -1 }).wouldBeNegative).toBe(true);
    expect(computeStockAdjustmentEffect({ currentStock: 0, delta: 1 }).wouldBeNegative).toBe(false);
  });

  it("delta 0: el stock no cambia", () => {
    expect(computeStockAdjustmentEffect({ currentStock: 8, delta: 0 })).toEqual({
      delta: 0,
      stockAfter: 8,
      stockBefore: 8,
      wouldBeNegative: false,
    });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])("delta %p: cuenta como 0", (delta) => {
    expect(computeStockAdjustmentEffect({ currentStock: 8, delta })).toEqual({
      delta: 0,
      stockAfter: 8,
      stockBefore: 8,
      wouldBeNegative: false,
    });
  });
});
