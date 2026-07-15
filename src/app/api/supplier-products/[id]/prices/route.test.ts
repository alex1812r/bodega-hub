/**
 * @jest-environment node
 */

import { POST } from "./route";

const context = (id: string) => ({
  params: Promise.resolve({ id }),
});

describe("/api/supplier-products/[id]/prices", () => {
  it("registers a supplier price and returns variation", async () => {
    const response = await POST(
      new Request("http://localhost/api/supplier-products/supp-prod-cable/prices", {
        body: JSON.stringify({ newCostRef: 2.2, notes: "Relevamiento", origin: "cotizacion" }),
        headers: {
          "content-type": "application/json",
          "x-demo-role": "almacen",
        },
        method: "POST",
      }),
      context("supp-prod-cable"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.supplierProduct.lastCostRef).toBe(2.2);
    expect(body.data.variationPercent).toEqual(expect.any(Number));
  });

  it("rejects price registration on inactive relation", async () => {
    const response = await POST(
      new Request("http://localhost/api/supplier-products/supp-prod-pipe/prices", {
        body: JSON.stringify({ newCostRef: 5, origin: "cotizacion" }),
        headers: {
          "content-type": "application/json",
          "x-demo-role": "almacen",
        },
        method: "POST",
      }),
      context("supp-prod-pipe"),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("BAD_REQUEST");
  });
});
