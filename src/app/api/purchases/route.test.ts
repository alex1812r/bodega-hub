/**
 * @jest-environment node
 */

import { GET, POST } from "./route";

describe("/api/purchases", () => {
  it("returns purchases for warehouse role", async () => {
    const response = await GET(
      new Request("http://localhost/api/purchases", {
        headers: { "x-demo-role": "almacen" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items).toEqual(expect.any(Array));
  });

  it("creates a simulated purchase", async () => {
    const response = await POST(
      new Request("http://localhost/api/purchases", {
        body: JSON.stringify({
          items: [{ entryMode: "unit", productId: "prod-cable", quantity: 2, unitCostRef: 2 }],
          supplierId: "cont-supplier",
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
    expect(body.data.status).toBe("recibido");
  });

  it("creates a purchase in pedido status", async () => {
    const response = await POST(
      new Request("http://localhost/api/purchases", {
        body: JSON.stringify({
          items: [{ entryMode: "unit", productId: "prod-cable", quantity: 2, unitCostRef: 2 }],
          status: "pedido",
          supplierId: "cont-supplier",
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
    expect(body.data.status).toBe("pedido");
  });

  it("filters purchases by supplier and date range", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/purchases?supplierId=cont-supplier&from=2026-05-17&to=2026-05-17",
        {
          headers: { "x-demo-role": "almacen" },
        },
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.total).toBe(1);
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0].supplierId).toBe("cont-supplier");
  });
});
