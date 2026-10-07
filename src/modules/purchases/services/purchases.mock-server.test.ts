/**
 * @jest-environment node
 */
/**
 * STK-511 · C6 en modo mock: la misma clave devuelve la misma compra (paridad
 * con `create_purchase`).
 */

import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { createPurchase } from "./purchases.mock-server";

const KEY_A = "6f1a2b3c-4d5e-4f60-8a71-92b3c4d5e6f7";
const KEY_B = "0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d";

const input = {
  discountRef: 0,
  refRateVes: 510,
  subtotalRef: 4,
  supplierId: "cont-supplier",
  taxRef: 0,
};

describe("purchases.mock-server · clave de idempotencia (C6)", () => {
  it("la misma clave devuelve la compra original", () => {
    const first = createPurchase({ ...input, clientRequestId: KEY_A }, DEFAULT_STORE_ID);
    const second = createPurchase({ ...input, clientRequestId: KEY_A }, DEFAULT_STORE_ID);

    expect(second).toBe(first);
  });

  it("otra clave, otra tienda o ninguna clave crean una compra distinta", () => {
    const first = createPurchase({ ...input, clientRequestId: KEY_A }, DEFAULT_STORE_ID);

    expect(createPurchase({ ...input, clientRequestId: KEY_B }, DEFAULT_STORE_ID)).not.toBe(first);
    expect(createPurchase({ ...input, clientRequestId: KEY_A }, "otra-tienda")).not.toBe(first);
    expect(createPurchase(input, DEFAULT_STORE_ID)).not.toBe(first);
    expect(createPurchase(input, DEFAULT_STORE_ID)).not.toBe(createPurchase(input, DEFAULT_STORE_ID));
  });
});
