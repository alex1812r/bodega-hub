/**
 * @jest-environment node
 */

import { POST } from "./route";

describe("/api/inventory/conversions", () => {
  it("converts pack stock into unit stock", async () => {
    const response = await POST(
      new Request("http://localhost/api/inventory/conversions", {
        body: JSON.stringify({
          packProductId: "prod-cigar-pack",
          packQuantity: 1,
          reason: "Abrir caja para venta suelta",
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
    expect(body.data.unitsPerPack).toBe(10);
    expect(body.data.unitQuantity).toBe(10);
    expect(body.data.packMovement.type).toBe("conversion_salida");
    expect(body.data.unitMovement.type).toBe("conversion_entrada");
    expect(body.data.packMovement.conversionId).toBe(body.data.conversionId);
    expect(body.data.unitMovement.conversionId).toBe(body.data.conversionId);
  });

  it("rejects zero pack quantity", async () => {
    const response = await POST(
      new Request("http://localhost/api/inventory/conversions", {
        body: JSON.stringify({
          packProductId: "prod-cigar-pack",
          packQuantity: 0,
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

  it("rejects products without pack conversion", async () => {
    const response = await POST(
      new Request("http://localhost/api/inventory/conversions", {
        body: JSON.stringify({
          packProductId: "prod-cable",
          packQuantity: 1,
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
});
