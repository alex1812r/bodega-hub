/**
 * @jest-environment node
 */
/**
 * INV-F2 · paridad con `stock_request_replay` (20261006c): misma clave + mismo
 * contenido = el resultado original; misma clave + otro contenido = 409.
 */

import { ApiError } from "@/lib/api/apiError";
import { mockProducts, mockStockMovements } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { convertPackToUnits, createStockAdjustment } from "./inventory.mock-server";

const KEY_ADJUSTMENT = "11111111-2222-4333-8444-555555555555";
const KEY_CONVERSION = "66666666-7777-4888-8999-aaaaaaaaaaaa";
// Texto de `stock_request_replay` en supabase/patches/20261006c-purchases-inventory-rpc-hardening.sql.
const CONFLICT_MESSAGE =
  "La clave de idempotencia ya se uso en otro movimiento de inventario. Revisa el movimiento registrado antes de reintentar.";

function stockOf(productId: string) {
  return mockProducts.find((product) => product.id === productId)?.currentStock ?? Number.NaN;
}

function captureError(run: () => unknown) {
  try {
    run();
  } catch (error) {
    return error;
  }

  return null;
}

describe("inventory.mock-server · misma clave con otro contenido (INV-F2)", () => {
  it("ajuste: mismo contenido devuelve el original; otro producto, cantidad, tipo o motivo = 409 sin mover stock", () => {
    const input = {
      clientRequestId: KEY_ADJUSTMENT,
      productId: "prod-cable",
      quantityDelta: 1,
      reason: "conteo",
      type: "ajuste_entrada" as const,
    };
    const first = createStockAdjustment(input, DEFAULT_STORE_ID);
    const cableStock = stockOf("prod-cable");
    const chargerStock = stockOf("prod-drill");
    const movements = mockStockMovements.length;

    expect(createStockAdjustment({ ...input }, DEFAULT_STORE_ID)).toBe(first);

    for (const changed of [
      { productId: "prod-drill", quantityDelta: 7 },
      { quantityDelta: 5 },
      { type: "inventario_inicial" as const },
      { reason: "otro motivo" },
    ]) {
      const error = captureError(() =>
        createStockAdjustment({ ...input, ...changed }, DEFAULT_STORE_ID),
      );

      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ code: "CONFLICT", message: CONFLICT_MESSAGE, status: 409 });
    }

    expect(stockOf("prod-cable")).toBe(cableStock);
    expect(stockOf("prod-drill")).toBe(chargerStock);
    expect(mockStockMovements.length).toBe(movements);
  });

  it("conversion: mismo contenido devuelve el original; otra cantidad = 409 con el mensaje de la base", () => {
    const input = { clientRequestId: KEY_CONVERSION, packProductId: "prod-cigar-pack", packQuantity: 1 };
    const first = convertPackToUnits(input, DEFAULT_STORE_ID);
    const packStock = stockOf("prod-cigar-pack");

    expect(convertPackToUnits({ ...input }, DEFAULT_STORE_ID)).toBe(first);

    const error = captureError(() =>
      convertPackToUnits({ ...input, packQuantity: 2 }, DEFAULT_STORE_ID),
    );

    expect(error).toMatchObject({ code: "CONFLICT", message: CONFLICT_MESSAGE, status: 409 });
    expect(stockOf("prod-cigar-pack")).toBe(packStock);
  });
});
