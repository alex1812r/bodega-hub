/**
 * @jest-environment node
 */
/**
 * STK-517 · R4 en modo mock: paridad con `adjust_stock` cuando la devolucion va
 * ligada a su venta o compra (documento de la tienda, producto del documento y
 * tope "vendido/recibido − ya devuelto").
 */

import { mockProducts, mockStockMovements } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { createStockAdjustment } from "./inventory.mock-server";

function stockOf(productId: string) {
  return mockProducts.find((product) => product.id === productId)?.currentStock ?? Number.NaN;
}

// Semilla: sale-001 (pagada) vendio 1 `prod-drill`; purchase-001 (recibido)
// recibio 10 `prod-cable`; purchase-002 sigue en `pedido`.
describe("inventory.mock-server · devolucion ligada a su documento (R4)", () => {
  it("rechaza con 400 un vinculo que no corresponde al tipo", () => {
    expect(() =>
      createStockAdjustment(
        { productId: "prod-drill", quantityDelta: 1, saleId: "sale-001", type: "ajuste_entrada" },
        DEFAULT_STORE_ID,
      ),
    ).toThrow(expect.objectContaining({ code: "BAD_REQUEST", status: 400 }));

    expect(() =>
      createStockAdjustment(
        { productId: "prod-cable", purchaseId: "purchase-001", quantityDelta: 1, type: "devolucion_cliente" },
        DEFAULT_STORE_ID,
      ),
    ).toThrow(expect.objectContaining({ code: "BAD_REQUEST", status: 400 }));
  });

  it("responde 404 si la venta no existe en la tienda", () => {
    expect(() =>
      createStockAdjustment(
        { productId: "prod-drill", quantityDelta: 1, saleId: "sale-no-existe", type: "devolucion_cliente" },
        DEFAULT_STORE_ID,
      ),
    ).toThrow(expect.objectContaining({ code: "NOT_FOUND", status: 404 }));

    // `sale-sur-001` existe, pero es de la otra tienda.
    expect(() =>
      createStockAdjustment(
        { productId: "prod-drill", quantityDelta: 1, saleId: "sale-sur-001", type: "devolucion_cliente" },
        DEFAULT_STORE_ID,
      ),
    ).toThrow(expect.objectContaining({ code: "NOT_FOUND", status: 404 }));
  });

  it("rechaza con 400 un producto que no pertenece a la venta", () => {
    expect(() =>
      createStockAdjustment(
        { productId: "prod-cable", quantityDelta: 1, saleId: "sale-001", type: "devolucion_cliente" },
        DEFAULT_STORE_ID,
      ),
    ).toThrow(expect.objectContaining({ code: "BAD_REQUEST", status: 400 }));
  });

  it("liga el movimiento a la venta y aplica el tope vendido − ya devuelto", () => {
    const before = stockOf("prod-drill");
    const input = {
      productId: "prod-drill",
      quantityDelta: 1,
      saleId: "sale-001",
      type: "devolucion_cliente" as const,
    };

    expect(() => createStockAdjustment({ ...input, quantityDelta: 2 }, DEFAULT_STORE_ID)).toThrow(
      expect.objectContaining({ code: "CONFLICT", status: 409 }),
    );
    expect(stockOf("prod-drill")).toBe(before);

    const movement = createStockAdjustment(input, DEFAULT_STORE_ID);

    expect(movement).toMatchObject({ saleId: "sale-001", type: "devolucion_cliente" });
    expect(mockStockMovements[0]).toBe(movement);
    expect(stockOf("prod-drill")).toBe(before + 1);

    // Ya se devolvio la unica unidad vendida: la segunda es el duplicado de C15.
    expect(() => createStockAdjustment(input, DEFAULT_STORE_ID)).toThrow(
      expect.objectContaining({ code: "CONFLICT", status: 409 }),
    );
    expect(stockOf("prod-drill")).toBe(before + 1);
  });

  it("liga el movimiento a la compra y aplica el tope recibido − ya devuelto", () => {
    // Stock de sobra: aqui se prueba el tope del documento, no el stock negativo.
    createStockAdjustment({ productId: "prod-cable", quantityDelta: 20 }, DEFAULT_STORE_ID);
    const before = stockOf("prod-cable");
    const input = {
      productId: "prod-cable",
      purchaseId: "purchase-001",
      quantityDelta: -4,
      type: "devolucion_proveedor" as const,
    };

    expect(() => createStockAdjustment({ ...input, quantityDelta: -11 }, DEFAULT_STORE_ID)).toThrow(
      expect.objectContaining({ code: "CONFLICT", status: 409 }),
    );

    const movement = createStockAdjustment(input, DEFAULT_STORE_ID);

    expect(movement).toMatchObject({ purchaseId: "purchase-001", type: "devolucion_proveedor" });
    expect(stockOf("prod-cable")).toBe(before - 4);

    // Recibido 10, devuelto 4: quedan 6.
    expect(() => createStockAdjustment({ ...input, quantityDelta: -7 }, DEFAULT_STORE_ID)).toThrow(
      expect.objectContaining({ code: "CONFLICT", status: 409 }),
    );
    createStockAdjustment({ ...input, quantityDelta: -6 }, DEFAULT_STORE_ID);

    expect(stockOf("prod-cable")).toBe(before - 10);
  });

  it("responde 409 si la compra no esta recibida", () => {
    expect(() =>
      createStockAdjustment(
        { productId: "prod-hammer", purchaseId: "purchase-002", quantityDelta: -1, type: "devolucion_proveedor" },
        DEFAULT_STORE_ID,
      ),
    ).toThrow(expect.objectContaining({ code: "CONFLICT", status: 409 }));
  });

  it.each([
    [
      "devolucion_cliente sin saleId",
      { productId: "prod-drill", quantityDelta: 3, type: "devolucion_cliente" as const },
      /debe indicar la venta/i,
    ],
    [
      "devolucion_proveedor sin purchaseId",
      { productId: "prod-drill", quantityDelta: -1, type: "devolucion_proveedor" as const },
      /debe indicar la compra/i,
    ],
  ])("%s responde 400 y no mueve stock", (_caso, input, message) => {
    const before = stockOf("prod-drill");
    const movementsBefore = mockStockMovements.length;

    expect(() => createStockAdjustment(input, DEFAULT_STORE_ID)).toThrow(
      expect.objectContaining({
        code: "BAD_REQUEST",
        message: expect.stringMatching(message),
        status: 400,
      }),
    );
    expect(stockOf("prod-drill")).toBe(before);
    expect(mockStockMovements).toHaveLength(movementsBefore);
  });

  it("un ajuste que no es devolucion sigue sin exigir documento", () => {
    const before = stockOf("prod-drill");

    const movement = createStockAdjustment(
      { productId: "prod-drill", quantityDelta: 3, type: "ajuste_entrada" },
      DEFAULT_STORE_ID,
    );

    expect(movement).not.toHaveProperty("saleId");
    expect(stockOf("prod-drill")).toBe(before + 3);
  });
});
