/**
 * @jest-environment node
 */

import { GET, POST } from "./route";

describe("/api/supplier-products", () => {
  it("returns supplier-product relations filtered by supplier", async () => {
    const response = await GET(
      new Request("http://localhost/api/supplier-products?supplierId=cont-supplier"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items).toEqual(expect.arrayContaining([expect.objectContaining({ supplierId: "cont-supplier" })]),
    );
  });

  it("creates a simulated supplier-product relation", async () => {
    const response = await POST(
      new Request("http://localhost/api/supplier-products", {
        body: JSON.stringify({
          lastCostRef: 3,
          productId: "prod-paint",
          supplierId: "cont-supplier",
          supplierSku: "SUP-PAINT",
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
    expect(body.data.productId).toBe("prod-paint");
  });
});
