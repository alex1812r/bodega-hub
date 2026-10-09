/**
 * @jest-environment node
 */

import { DEFAULT_STORE_ID } from "@/shared/stores/constants";
import { mockProducts } from "@/shared/mocks/erp-data";

import { createStockAdjustment } from "./inventory.mock-server";

/** INV-F5 · B2: paridad con `adjust_stock`, que cruza el signo con el tipo (PT400). */
describe("createStockAdjustment (mock) · signo y tipo (INV-F5 · B2)", () => {
  function stock() {
    return mockProducts.find((item) => item.id === "prod-cable")?.currentStock;
  }

  it("rechaza una salida con cantidad positiva, sin mover stock", () => {
    const before = stock();

    expect(() =>
      createStockAdjustment(
        { productId: "prod-cable", quantityDelta: 5, type: "ajuste_salida" },
        DEFAULT_STORE_ID,
      ),
    ).toThrow("ajuste_salida / devolucion_proveedor requiere quantity_delta negativo");
    expect(stock()).toBe(before);
  });

  it.each(["ajuste_entrada", "inventario_inicial"] as const)(
    "rechaza %s con cantidad negativa, sin mover stock",
    (type) => {
      const before = stock();

      expect(() =>
        createStockAdjustment({ productId: "prod-cable", quantityDelta: -1, type }, DEFAULT_STORE_ID),
      ).toThrow("Este tipo de ajuste requiere quantity_delta positivo");
      expect(stock()).toBe(before);
    },
  );

  it("sin tipo, el signo decide: negativo es una salida", () => {
    createStockAdjustment({ productId: "prod-cable", quantityDelta: 2 }, DEFAULT_STORE_ID);

    expect(
      createStockAdjustment({ productId: "prod-cable", quantityDelta: -1 }, DEFAULT_STORE_ID),
    ).toMatchObject({ quantityDelta: -1, type: "ajuste_salida" });
  });
});
