/**
 * @jest-environment node
 */
/**
 * STK-511 · C6 en modo mock: la misma clave devuelve el mismo resultado y el
 * stock se mueve una sola vez (paridad con `adjust_stock` / `convert_pack_to_units`).
 */

import { mockProducts, mockStockMovements } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { convertPackToUnits, createStockAdjustment } from "./inventory.mock-server";

const KEY_A = "6f1a2b3c-4d5e-4f60-8a71-92b3c4d5e6f7";
const KEY_B = "0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d";

function stockOf(productId: string) {
  return mockProducts.find((product) => product.id === productId)?.currentStock ?? Number.NaN;
}

describe("inventory.mock-server · clave de idempotencia (C6)", () => {
  it("un ajuste repetido con la misma clave no mueve stock dos veces", () => {
    const before = stockOf("prod-cable");
    const movementsBefore = mockStockMovements.length;
    const input = { clientRequestId: KEY_A, productId: "prod-cable", quantityDelta: 2 };

    const first = createStockAdjustment(input, DEFAULT_STORE_ID);
    const second = createStockAdjustment(input, DEFAULT_STORE_ID);

    expect(second).toBe(first);
    expect(stockOf("prod-cable")).toBe(before + 2);
    expect(mockStockMovements.length).toBe(movementsBefore + 1);
  });

  it("una clave distinta o ninguna clave si crean otro ajuste", () => {
    const before = stockOf("prod-cable");

    createStockAdjustment(
      { clientRequestId: KEY_B, productId: "prod-cable", quantityDelta: 1 },
      DEFAULT_STORE_ID,
    );
    createStockAdjustment({ productId: "prod-cable", quantityDelta: 1 }, DEFAULT_STORE_ID);
    createStockAdjustment({ productId: "prod-cable", quantityDelta: 1 }, DEFAULT_STORE_ID);

    expect(stockOf("prod-cable")).toBe(before + 3);
  });

  it("la clave es por tienda: otra tienda no recibe el resultado ajeno", () => {
    expect(() =>
      createStockAdjustment(
        { clientRequestId: KEY_A, productId: "prod-cable", quantityDelta: 2 },
        "99999999-9999-4999-8999-999999999999",
      ),
    ).toThrow();
  });

  it("una conversion repetida con la misma clave no abre el empaque dos veces", () => {
    const packBefore = stockOf("prod-cigar-pack");
    const unitBefore = stockOf("prod-cigar-unit");
    const movementsBefore = mockStockMovements.length;
    const input = { clientRequestId: KEY_A, packProductId: "prod-cigar-pack", packQuantity: 1 };

    const first = convertPackToUnits(input, DEFAULT_STORE_ID);
    const second = convertPackToUnits(input, DEFAULT_STORE_ID);

    expect(second).toBe(first);
    expect(stockOf("prod-cigar-pack")).toBe(packBefore - 1);
    expect(stockOf("prod-cigar-unit")).toBe(unitBefore + 10);
    expect(mockStockMovements.length).toBe(movementsBefore + 2);
  });

  it("un intento rechazado no ocupa la clave", () => {
    const input = { clientRequestId: KEY_B, packProductId: "prod-cigar-pack", packQuantity: 999 };

    expect(() => convertPackToUnits(input, DEFAULT_STORE_ID)).toThrow();

    const packBefore = stockOf("prod-cigar-pack");
    convertPackToUnits({ ...input, packQuantity: 1 }, DEFAULT_STORE_ID);

    expect(stockOf("prod-cigar-pack")).toBe(packBefore - 1);
  });
});
