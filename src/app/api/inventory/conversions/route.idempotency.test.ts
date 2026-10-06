/**
 * @jest-environment node
 */
/** STK-511 · C6 / C12: clave de idempotencia opcional y cuerpo invalido → 400. */

import { mockProducts } from "@/shared/mocks/erp-data";

import { POST } from "./route";

const CLIENT_REQUEST_ID = "7a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d";

function post(body: string | undefined) {
  return POST(
    new Request("http://localhost/api/inventory/conversions", {
      body,
      headers: { "content-type": "application/json", "x-demo-role": "almacen" },
      method: "POST",
    }),
  );
}

function stockOf(productId: string) {
  return mockProducts.find((product) => product.id === productId)?.currentStock ?? Number.NaN;
}

describe("/api/inventory/conversions · idempotencia y cuerpo invalido", () => {
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
      JSON.stringify({ clientRequestId: "no-es-uuid", packProductId: "prod-cigar-pack", packQuantity: 1 }),
    );

    expect(response.status).toBe(400);
  });

  it("dos POST con la misma clave devuelven la misma conversion y abren el empaque una vez", async () => {
    const packBefore = stockOf("prod-cigar-pack");
    const unitBefore = stockOf("prod-cigar-unit");
    const body = JSON.stringify({
      clientRequestId: CLIENT_REQUEST_ID,
      packProductId: "prod-cigar-pack",
      packQuantity: 1,
    });

    const first = await post(body);
    const second = await post(body);
    const firstPayload = await first.json();
    const secondPayload = await second.json();

    expect([first.status, second.status]).toEqual([201, 201]);
    expect(secondPayload.data.conversionId).toBe(firstPayload.data.conversionId);
    expect(stockOf("prod-cigar-pack")).toBe(packBefore - 1);
    expect(stockOf("prod-cigar-unit")).toBe(unitBefore + 10);
  });
});
