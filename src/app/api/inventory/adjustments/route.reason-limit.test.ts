/**
 * @jest-environment node
 */

import { mockProducts, mockStockMovements } from "@/shared/mocks/erp-data";

import { POST } from "./route";

/** INV-F5 · M3: el motivo tiene tope; un texto enorme no llega a guardarse. */
describe("/api/inventory/adjustments · tope del motivo (INV-F5 · M3)", () => {
  function post(body: Record<string, unknown>) {
    return POST(
      new Request("http://localhost/api/inventory/adjustments", {
        body: JSON.stringify(body),
        headers: { "content-type": "application/json", "x-demo-role": "almacen" },
        method: "POST",
      }),
    );
  }

  function snapshot() {
    return {
      movements: mockStockMovements.length,
      stock: mockProducts.find((item) => item.id === "prod-cable")?.currentStock,
    };
  }

  it("rechaza con 400 y mensaje en español un motivo de más de 500 caracteres, sin mover stock", async () => {
    const before = snapshot();
    const response = await post({
      productId: "prod-cable",
      quantityDelta: 1,
      reason: "m".repeat(501),
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatchObject({
      code: "BAD_REQUEST",
      message: "El motivo admite hasta 500 caracteres.",
    });
    expect(snapshot()).toEqual(before);
  });

  it("rechaza un motivo de 1 MB", async () => {
    const response = await post({
      productId: "prod-cable",
      quantityDelta: 1,
      reason: "m".repeat(1_000_000),
    });

    expect(response.status).toBe(400);
  });

  it("acepta 500 caracteres; los espacios de los extremos no cuentan", async () => {
    const response = await post({
      productId: "prod-cable",
      quantityDelta: 1,
      reason: `  ${"m".repeat(500)}  `,
    });

    expect(response.status).toBe(201);
  });

  it("rechaza con 400 una cantidad fuera del rango de un entero de la base", async () => {
    const before = snapshot();
    const response = await post({ productId: "prod-cable", quantityDelta: 2_147_483_648 });

    expect(response.status).toBe(400);
    expect(snapshot()).toEqual(before);
  });
});
