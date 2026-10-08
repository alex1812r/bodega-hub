/**
 * @jest-environment node
 */
/**
 * COM-15a · paridad con `adjust_stock` (20261011b): un producto inactivo no
 * recibe entradas libres (409); las salidas y las devoluciones ligadas a su
 * documento no cambian.
 */

import { mockProducts, mockStockMovements } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { createStockAdjustment } from "./inventory.mock-server";

// Texto de `adjust_stock` en supabase/patches/20261011b-adjust-stock-inactive.sql.
const INACTIVE_MESSAGE = "El producto esta inactivo: reactivalo antes de registrar una entrada de stock";
const KEY = "0c15a000-0000-4000-8000-000000000001";

function productOf(productId: string) {
  const product = mockProducts.find((item) => item.id === productId);

  if (!product) {
    throw new Error(`La semilla no tiene el producto ${productId}`);
  }

  return product;
}

function captureError(run: () => unknown) {
  try {
    run();
  } catch (error) {
    return error;
  }

  return null;
}

// Semilla: `prod-latex` esta inactivo (stock 0); `prod-pipe` tiene stock 12; sale-001 (pagada) vendio 1
// `prod-drill`; purchase-001 (recibido) recibio 10 `prod-cable`.
describe("inventory.mock-server · ajuste sobre un producto inactivo (COM-15a)", () => {
  const original = new Map<string, boolean>();

  /** Desactiva un producto de la semilla solo durante el test. */
  function deactivate(productId: string) {
    const product = productOf(productId);
    original.set(productId, product.isActive);
    product.isActive = false;
    return product;
  }

  afterEach(() => {
    for (const [productId, isActive] of original) {
      productOf(productId).isActive = isActive;
    }
    original.clear();
  });

  it.each([
    ["ajuste_entrada", { type: "ajuste_entrada" as const }],
    ["inventario_inicial", { type: "inventario_inicial" as const }],
    ["sin tipo (entrada por defecto)", {}],
  ])("entrada %s a un inactivo: 409 con el mensaje de la base, sin movimiento ni stock", (_caso, extra) => {
    const product = productOf("prod-latex");
    const stock = product.currentStock;
    const movements = mockStockMovements.length;

    const error = captureError(() =>
      createStockAdjustment({ productId: "prod-latex", quantityDelta: 5, ...extra }, DEFAULT_STORE_ID),
    );

    expect(error).toMatchObject({ code: "CONFLICT", message: INACTIVE_MESSAGE, status: 409 });
    expect(product.isActive).toBe(false);
    expect(product.currentStock).toBe(stock);
    expect(mockStockMovements).toHaveLength(movements);
  });

  it("el rechazo no consume la clave: tras reactivar, la misma clave registra el ajuste una sola vez", () => {
    const product = deactivate("prod-latex");
    const stock = product.currentStock;
    const input = {
      clientRequestId: KEY,
      productId: "prod-latex",
      quantityDelta: 4,
      type: "ajuste_entrada" as const,
    };

    expect(captureError(() => createStockAdjustment(input, DEFAULT_STORE_ID))).toMatchObject({ status: 409 });

    product.isActive = true;
    const movement = createStockAdjustment(input, DEFAULT_STORE_ID);

    expect(movement).toMatchObject({ quantityDelta: 4, stockAfter: stock + 4, type: "ajuste_entrada" });
    expect(createStockAdjustment(input, DEFAULT_STORE_ID)).toBe(movement);
    expect(product.currentStock).toBe(stock + 4);

    // Un ajuste ya registrado se sigue devolviendo aunque el producto se desactive despues.
    product.isActive = false;
    expect(createStockAdjustment(input, DEFAULT_STORE_ID)).toBe(movement);
    expect(product.currentStock).toBe(stock + 4);
  });

  it("salida de un inactivo con stock: se registra, y puede dejarlo en cero", () => {
    const product = deactivate("prod-pipe");
    const stock = product.currentStock;

    expect(stock).toBeGreaterThan(2);

    const movement = createStockAdjustment(
      { productId: "prod-pipe", quantityDelta: -2, type: "ajuste_salida" },
      DEFAULT_STORE_ID,
    );

    expect(movement).toMatchObject({ quantityDelta: -2, stockAfter: stock - 2, type: "ajuste_salida" });
    expect(mockStockMovements[0]).toBe(movement);

    createStockAdjustment(
      { productId: "prod-pipe", quantityDelta: -(stock - 2), type: "ajuste_salida" },
      DEFAULT_STORE_ID,
    );

    expect(product.currentStock).toBe(0);
    expect(product.isActive).toBe(false);
  });

  it("salida mayor que el stock de un inactivo: el rechazo de siempre, sin mover stock", () => {
    const product = deactivate("prod-drill");
    const stock = product.currentStock;
    const movements = mockStockMovements.length;

    const error = captureError(() =>
      createStockAdjustment(
        { productId: "prod-drill", quantityDelta: -(stock + 1), type: "ajuste_salida" },
        DEFAULT_STORE_ID,
      ),
    );

    expect(error).toMatchObject({ message: "El ajuste no puede dejar stock negativo." });
    expect(product.currentStock).toBe(stock);
    expect(mockStockMovements).toHaveLength(movements);
  });

  it("devolucion de cliente LIGADA a su venta sobre un inactivo: entra como antes, con su tope", () => {
    const product = deactivate("prod-drill");
    const stock = product.currentStock;
    const input = {
      productId: "prod-drill",
      quantityDelta: 1,
      saleId: "sale-001",
      type: "devolucion_cliente" as const,
    };

    const movement = createStockAdjustment(input, DEFAULT_STORE_ID);

    expect(movement).toMatchObject({ saleId: "sale-001", stockAfter: stock + 1, type: "devolucion_cliente" });
    // Tope vendido − ya devuelto (C15), no el rechazo de inactivo.
    expect(captureError(() => createStockAdjustment(input, DEFAULT_STORE_ID))).toMatchObject({
      message: expect.stringMatching(/^La devolucion supera lo vendido/),
      status: 409,
    });
    expect(product.currentStock).toBe(stock + 1);
  });

  it("devolucion a proveedor LIGADA a su compra sobre un inactivo: sale como antes", () => {
    // Stock de sobra mientras sigue activo: aqui se prueba la devolucion, no el stock negativo.
    createStockAdjustment({ productId: "prod-cable", quantityDelta: 5 }, DEFAULT_STORE_ID);
    const product = deactivate("prod-cable");
    const stock = product.currentStock;

    const movement = createStockAdjustment(
      { productId: "prod-cable", purchaseId: "purchase-001", quantityDelta: -1, type: "devolucion_proveedor" },
      DEFAULT_STORE_ID,
    );

    expect(movement).toMatchObject({ purchaseId: "purchase-001", stockAfter: stock - 1, type: "devolucion_proveedor" });
    expect(product.currentStock).toBe(stock - 1);
  });

  it("devolucion de cliente SIN venta sobre un inactivo: sigue siendo el 400 de R4", () => {
    deactivate("prod-drill");

    expect(
      captureError(() =>
        createStockAdjustment(
          { productId: "prod-drill", quantityDelta: 1, type: "devolucion_cliente" },
          DEFAULT_STORE_ID,
        ),
      ),
    ).toMatchObject({ code: "BAD_REQUEST", status: 400 });
  });

  it("producto activo: la entrada y la salida no cambian", () => {
    const product = productOf("prod-hammer");
    const stock = product.currentStock;

    expect(product.isActive).toBe(true);

    const entry = createStockAdjustment({ productId: "prod-hammer", quantityDelta: 3 }, DEFAULT_STORE_ID);
    const exit = createStockAdjustment(
      { productId: "prod-hammer", quantityDelta: -1, type: "ajuste_salida" },
      DEFAULT_STORE_ID,
    );

    expect([entry.stockAfter, exit.stockAfter, product.currentStock]).toEqual([stock + 3, stock + 2, stock + 2]);
  });
});
