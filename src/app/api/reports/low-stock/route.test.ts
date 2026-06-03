/**
 * @jest-environment node
 */

import { GET } from "./route";

describe("/api/reports/low-stock", () => {
  it("returns low stock report", async () => {
    const response = await GET(
      new Request("http://localhost/api/reports/low-stock", {
        headers: { "x-demo-role": "contador" },
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
