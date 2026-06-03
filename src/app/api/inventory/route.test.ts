/**
 * @jest-environment node
 */

import { GET } from "./route";

describe("/api/inventory", () => {
  it("returns current inventory", async () => {
    const response = await GET(
      new Request("http://localhost/api/inventory", {
        headers: { "x-demo-role": "almacen" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items).toEqual(expect.arrayContaining([expect.objectContaining({ id: "prod-cable" })]));
  });

  it("filters low stock inventory", async () => {
    const response = await GET(
      new Request("http://localhost/api/inventory?lowStock=true", {
        headers: { "x-demo-role": "almacen" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(
      body.data.items.every(
        (product: { currentStock: number; minStock: number }) =>
          product.currentStock <= product.minStock,
      ),
    ).toBe(true);
  });
});
