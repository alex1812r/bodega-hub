import { describe, expect, it } from "@jest/globals";

import {
  getInventoryAdjustmentDelta,
  getMovementTypeLabel,
} from "./movementTypeLabels";

describe("movementTypeLabels", () => {
  it("labels movement types in Spanish", () => {
    expect(getMovementTypeLabel("venta")).toBe("Venta");
    expect(getMovementTypeLabel("ajuste_entrada")).toBe("Ajuste entrada");
  });

  it("computes signed adjustment deltas", () => {
    expect(getInventoryAdjustmentDelta(5, "ajuste_entrada")).toBe(5);
    expect(getInventoryAdjustmentDelta(5, "ajuste_salida")).toBe(-5);
    expect(getInventoryAdjustmentDelta(3, "devolucion_proveedor")).toBe(-3);
    expect(getInventoryAdjustmentDelta(2, "devolucion_cliente")).toBe(2);
  });
});
