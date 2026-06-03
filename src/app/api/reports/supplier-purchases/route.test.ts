/**
 * @jest-environment node
 */

import { GET } from "./route";

describe("/api/reports/supplier-purchases", () => {
  it("returns supplier purchase summary", async () => {
    const response = await GET(
      new Request("http://localhost/api/reports/supplier-purchases", {
        headers: { "x-demo-role": "contador" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items).toEqual(expect.arrayContaining([expect.objectContaining({ supplierId: "cont-supplier" })]),
    );
  });
});
