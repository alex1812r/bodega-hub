/**
 * @jest-environment node
 */

import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { cancelSale, createSale, getSaleByClientRequestId } from "./sales.mock-server";

const seller = { role: "vendedor", userId: "user-vendedor" };

function saleInput(clientRequestId: string, quantity = 1) {
  return {
    clientRequestId,
    customerId: "cont-customer",
    items: [{ productId: "prod-drill", quantity }],
    refRateVes: 510,
  };
}

describe("sales.mock-server · clave de idempotencia", () => {
  it("rejects a sale without client request id", () => {
    expect(() =>
      createSale({ customerId: "cont-customer", items: [{ productId: "prod-drill", quantity: 1 }] }, DEFAULT_STORE_ID, seller),
    ).toThrow(expect.objectContaining({ code: "BAD_REQUEST", status: 400 }));
  });

  it("returns the same sale for the same key and the same content", () => {
    const key = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
    const first = createSale(saleInput(key), DEFAULT_STORE_ID, seller);
    const replay = createSale(saleInput(key), DEFAULT_STORE_ID, seller);

    expect(replay.id).toBe(first.id);
  });

  it("creates different sales for different keys", () => {
    const first = createSale(saleInput("b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e"), DEFAULT_STORE_ID, seller);
    const second = createSale(saleInput("c3d4e5f6-a7b8-4c9d-8e1f-2a3b4c5d6e7f"), DEFAULT_STORE_ID, seller);

    expect(second.id).not.toBe(first.id);
  });

  it("answers 409 when the key is reused with another cart", () => {
    const key = "d4e5f6a7-b8c9-4d0e-9f2a-3b4c5d6e7f8a";
    createSale(saleInput(key, 2), DEFAULT_STORE_ID, seller);

    expect(() => createSale(saleInput(key, 3), DEFAULT_STORE_ID, seller)).toThrow(
      expect.objectContaining({ code: "CONFLICT", status: 409 }),
    );
  });

  it("answers 409 when the key is reused by another seller", () => {
    const key = "e5f6a7b8-c9d0-4e1f-8a3b-4c5d6e7f8a9b";
    createSale(saleInput(key), DEFAULT_STORE_ID, seller);

    expect(() =>
      createSale(saleInput(key), DEFAULT_STORE_ID, { role: "vendedor", userId: "user-otro-vendedor" }),
    ).toThrow(expect.objectContaining({ code: "CONFLICT", status: 409 }));
  });

  it("answers 409 when the sale stored under the key was cancelled", () => {
    const key = "f6a7b8c9-d0e1-4f2a-9b4c-5d6e7f8a9b0c";
    const sale = createSale(saleInput(key), DEFAULT_STORE_ID, seller);

    expect(cancelSale(sale.id, DEFAULT_STORE_ID).status).toBe("cancelada");
    expect(() => createSale(saleInput(key), DEFAULT_STORE_ID, seller)).toThrow(
      expect.objectContaining({ code: "CONFLICT", status: 409 }),
    );
  });

  it("finds the sale by key only for its seller, an admin, and its store", () => {
    const key = "a7b8c9d0-e1f2-4a3b-8c5d-6e7f8a9b0c1d";
    const sale = createSale(saleInput(key, 2), DEFAULT_STORE_ID, seller);

    expect(getSaleByClientRequestId(key, DEFAULT_STORE_ID, seller)).toEqual(
      expect.objectContaining({
        id: sale.id,
        items: [expect.objectContaining({ productId: "prod-drill", quantity: 2, saleId: sale.id })],
        payments: [],
      }),
    );
    expect(getSaleByClientRequestId(key, DEFAULT_STORE_ID, { role: "admin", userId: "user-admin" }).id).toBe(sale.id);
    expect(() =>
      getSaleByClientRequestId(key, DEFAULT_STORE_ID, { role: "vendedor", userId: "user-otro-vendedor" }),
    ).toThrow(expect.objectContaining({ status: 404 }));
    expect(() => getSaleByClientRequestId(key, "store-otra", seller)).toThrow(
      expect.objectContaining({ status: 404 }),
    );
  });
});
