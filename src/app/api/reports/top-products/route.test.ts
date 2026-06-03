/**
 * @jest-environment node
 */

import { GET } from "./route";

describe("/api/reports/top-products", () => {
  it("returns top products for date range", async () => {
    const response = await GET(
      new Request("http://localhost/api/reports/top-products?from=2026-05-18&to=2026-05-18", {
        headers: { "x-demo-role": "contador" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items[0]).toEqual(expect.objectContaining({ unitsSold: expect.any(Number) }));
  });
});
