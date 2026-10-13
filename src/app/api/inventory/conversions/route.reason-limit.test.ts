/**
 * @jest-environment node
 */

import { mockProducts } from "@/shared/mocks/erp-data";

import { POST } from "./route";

/** INV-F5 · M3: el motivo tiene tope; un texto enorme no llega a guardarse. */
describe("/api/inventory/conversions · tope del motivo (INV-F5 · M3)", () => {
  function post(reason: string) {
    return POST(
      new Request("http://localhost/api/inventory/conversions", {
        body: JSON.stringify({ packProductId: "prod-cigar-pack", packQuantity: 1, reason }),
        headers: { "content-type": "application/json", "x-demo-role": "almacen" },
        method: "POST",
      }),
    );
  }

  function packStock() {
    return mockProducts.find((item) => item.id === "prod-cigar-pack")?.currentStock;
  }

  it("rechaza con 400 y mensaje en español un motivo de más de 500 caracteres, sin abrir el empaque", async () => {
    const before = packStock();
    const response = await post("m".repeat(501));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatchObject({
      code: "BAD_REQUEST",
      message: "El motivo admite hasta 500 caracteres.",
    });
    expect(packStock()).toBe(before);
  });

  it("rechaza un motivo de 1 MB", async () => {
    expect((await post("m".repeat(1_000_000))).status).toBe(400);
  });

  it("acepta 500 caracteres", async () => {
    expect((await post("m".repeat(500))).status).toBe(201);
  });
});
