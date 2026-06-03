/**
 * @jest-environment node
 */

import { POST } from "./route";

describe("/api/inventory/adjustments", () => {
  it("creates a simulated stock adjustment", async () => {
    const response = await POST(
      new Request("http://localhost/api/inventory/adjustments", {
        body: JSON.stringify({
          productId: "prod-cable",
          quantityDelta: 3,
          reason: "Conteo fisico",
        }),
        headers: {
          "content-type": "application/json",
          "x-demo-role": "almacen",
        },
        method: "POST",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.type).toBe("ajuste_entrada");
  });

  it("validates non-zero quantity", async () => {
    const response = await POST(
      new Request("http://localhost/api/inventory/adjustments", {
        body: JSON.stringify({
          productId: "prod-cable",
          quantityDelta: 0,
        }),
        headers: {
          "content-type": "application/json",
          "x-demo-role": "almacen",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
  });

  it("validates negative stock", async () => {
    const response = await POST(
      new Request("http://localhost/api/inventory/adjustments", {
        body: JSON.stringify({
          productId: "prod-cable",
          quantityDelta: -99,
        }),
        headers: {
          "content-type": "application/json",
          "x-demo-role": "almacen",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
  });

  it("accepts documented adjustment types", async () => {
    const response = await POST(
      new Request("http://localhost/api/inventory/adjustments", {
        body: JSON.stringify({
          productId: "prod-cable",
          quantityDelta: 1,
          type: "inventario_inicial",
        }),
        headers: {
          "content-type": "application/json",
          "x-demo-role": "almacen",
        },
        method: "POST",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.type).toBe("inventario_inicial");
  });
});
