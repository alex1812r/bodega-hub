/**
 * @jest-environment node
 */
/** STK-511 · C6 / C12: clave de idempotencia opcional y cuerpo invalido → 400. */

import { mockProducts } from "@/shared/mocks/erp-data";

import { POST } from "./route";

const CLIENT_REQUEST_ID = "7a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d";

function post(body: string | undefined) {
  return POST(
    new Request("http://localhost/api/inventory/adjustments", {
      body,
      headers: { "content-type": "application/json", "x-demo-role": "almacen" },
      method: "POST",
    }),
  );
}

function cableStock() {
  return mockProducts.find((product) => product.id === "prod-cable")?.currentStock;
}

describe("/api/inventory/adjustments · idempotencia y cuerpo invalido", () => {
  it.each([
    ["JSON malformado", "{ esto no es json"],
    ["cuerpo vacio", undefined],
  ])("responde 400 con %s", async (_caso, body) => {
    const response = await post(body);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("BAD_REQUEST");
  });

  it("rechaza con 400 una clave que no es uuid", async () => {
    const response = await post(
      JSON.stringify({ clientRequestId: "no-es-uuid", productId: "prod-cable", quantityDelta: 1 }),
    );

    expect(response.status).toBe(400);
  });

  it("dos POST con la misma clave devuelven el mismo movimiento y mueven stock una vez", async () => {
    const before = cableStock() ?? 0;
    const body = JSON.stringify({
      clientRequestId: CLIENT_REQUEST_ID,
      productId: "prod-cable",
      quantityDelta: 2,
    });

    const first = await post(body);
    const second = await post(body);
    const firstPayload = await first.json();
    const secondPayload = await second.json();

    expect([first.status, second.status]).toEqual([201, 201]);
    expect(secondPayload.data).toEqual(firstPayload.data);
    expect(cableStock()).toBe(before + 2);
  });
});
