/**
 * @jest-environment node
 */
/**
 * COM-15a · un producto inactivo no recibe entradas libres: 409 con el mensaje
 * de `adjust_stock` (20261011b). Las salidas siguen respondiendo 201.
 */

import { mockProducts, mockStockMovements } from "@/shared/mocks/erp-data";

import { POST } from "./route";

const INACTIVE_MESSAGE = "El producto esta inactivo: reactivalo antes de registrar una entrada de stock";
const CLIENT_REQUEST_ID = "0c15a000-0000-4000-8000-000000000002";

function post(body: Record<string, unknown>) {
  return POST(
    new Request("http://localhost/api/inventory/adjustments", {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", "x-demo-role": "almacen" },
      method: "POST",
    }),
  );
}

function productOf(productId: string) {
  const product = mockProducts.find((item) => item.id === productId);

  if (!product) {
    throw new Error(`La semilla no tiene el producto ${productId}`);
  }

  return product;
}

// Semilla: `prod-latex` esta inactivo; `prod-pipe` esta activo y tiene stock.
describe("/api/inventory/adjustments · producto inactivo (COM-15a)", () => {
  afterEach(() => {
    productOf("prod-latex").isActive = false;
    productOf("prod-pipe").isActive = true;
  });

  it("entrada a un inactivo: 409 CONFLICT con el mensaje de la base y sin movimiento", async () => {
    const product = productOf("prod-latex");
    const stock = product.currentStock;
    const movements = mockStockMovements.length;

    const response = await post({ productId: "prod-latex", quantityDelta: 5, type: "ajuste_entrada" });
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.error).toMatchObject({ code: "CONFLICT", message: INACTIVE_MESSAGE });
    expect(product.currentStock).toBe(stock);
    expect(mockStockMovements).toHaveLength(movements);
  });

  it("la clave del intento rechazado sirve tras reactivar el producto", async () => {
    const product = productOf("prod-latex");
    const stock = product.currentStock;
    const body = { clientRequestId: CLIENT_REQUEST_ID, productId: "prod-latex", quantityDelta: 2 };

    const rejected = await post(body);
    product.isActive = true;
    const accepted = await post(body);
    const repeated = await post(body);

    expect([rejected.status, accepted.status, repeated.status]).toEqual([409, 201, 201]);
    expect((await repeated.json()).data).toEqual((await accepted.json()).data);
    expect(product.currentStock).toBe(stock + 2);
  });

  it("salida de un inactivo con stock: 201 y el stock baja", async () => {
    const product = productOf("prod-pipe");
    const stock = product.currentStock;
    product.isActive = false;

    const response = await post({ productId: "prod-pipe", quantityDelta: -1, type: "ajuste_salida" });
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.data).toMatchObject({ quantityDelta: -1, stockAfter: stock - 1, type: "ajuste_salida" });
    expect(product.currentStock).toBe(stock - 1);
  });
});
