/**
 * @jest-environment node
 */

import { GET, POST } from "./route";

describe("/api/sales", () => {
  it("returns sales for seller role", async () => {
    const response = await GET(
      new Request("http://localhost/api/sales", {
        headers: { "x-demo-role": "vendedor" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items).toEqual(expect.any(Array));
  });

  it("creates a simulated sale", async () => {
    const response = await POST(
      new Request("http://localhost/api/sales", {
        body: JSON.stringify({
          customerId: "cont-customer",
          items: [{ productId: "prod-drill", quantity: 1 }],
        }),
        headers: {
          "content-type": "application/json",
          "x-demo-role": "vendedor",
        },
        method: "POST",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.status).toBe("pendiente_pago");
    expect(body.data.totalRef).toBeGreaterThan(0);
  });

  it("filters sales by customer and date range", async () => {
    const response = await GET(
      new Request("http://localhost/api/sales?customerId=cont-customer&from=2026-05-18&to=2026-05-18", {
        headers: { "x-demo-role": "vendedor" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.total).toBe(1);
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0].customerId).toBe("cont-customer");
  });

  it("blocks warehouse from listing sales", async () => {
    const response = await GET(
      new Request("http://localhost/api/sales", {
        headers: { "x-demo-role": "almacen" },
      }),
    );

    expect(response.status).toBe(403);
  });
});
