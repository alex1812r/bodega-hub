import { describe, expect, it } from "@jest/globals";

import {
  getInventoryAdjustmentDelta,
  getMovementTypeLabel,
  inventoryAdjustmentTypeOptions,
  movementTypeOptions,
} from "./movementTypeLabels";

describe("movementTypeLabels", () => {
  it("labels movement types in Spanish", () => {
    expect(getMovementTypeLabel("venta")).toBe("Venta");
    expect(getMovementTypeLabel("ajuste_entrada")).toBe("Ajuste entrada");
    expect(getMovementTypeLabel("conversion_salida")).toBe("Conversion salida");
    expect(getMovementTypeLabel("conversion_entrada")).toBe("Conversion entrada");
  });

  it("el ajuste libre no ofrece devoluciones, que exigen venta o compra (R4)", () => {
    expect(inventoryAdjustmentTypeOptions.map((option) => option.value)).toEqual([
      "ajuste_entrada",
      "ajuste_salida",
      "inventario_inicial",
    ]);
  });

  it("conserva las etiquetas de devolucion para mostrar y filtrar movimientos existentes", () => {
    expect(getMovementTypeLabel("devolucion_cliente")).toBe("Devolución cliente");
    expect(getMovementTypeLabel("devolucion_proveedor")).toBe("Devolución proveedor");
    expect(movementTypeOptions.map((option) => option.value)).toEqual(
      expect.arrayContaining(["devolucion_cliente", "devolucion_proveedor"]),
    );
  });

  it("computes signed adjustment deltas", () => {
    expect(getInventoryAdjustmentDelta(5, "ajuste_entrada")).toBe(5);
    expect(getInventoryAdjustmentDelta(5, "ajuste_salida")).toBe(-5);
    expect(getInventoryAdjustmentDelta(3, "devolucion_proveedor")).toBe(-3);
    expect(getInventoryAdjustmentDelta(2, "devolucion_cliente")).toBe(2);
  });
});
