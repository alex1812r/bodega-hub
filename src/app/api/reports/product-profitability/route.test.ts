/**
 * @jest-environment node
 */

import { GET } from "./route";

describe("/api/reports/product-profitability", () => {
  it("returns product profitability report", async () => {
    const response = await GET(
      new Request("http://localhost/api/reports/product-profitability", {
        headers: { "x-demo-role": "contador" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items).toEqual(expect.arrayContaining([expect.objectContaining({ productId: "prod-drill" })]),
    );
  });
});
