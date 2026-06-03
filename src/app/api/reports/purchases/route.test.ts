/**
 * @jest-environment node
 */

import { GET } from "./route";

describe("/api/reports/purchases", () => {
  it("returns purchases report filtered by supplier and date range", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/reports/purchases?supplierId=cont-supplier&from=2026-05-17&to=2026-05-17",
        {
          headers: { "x-demo-role": "contador" },
        },
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items).toEqual(expect.arrayContaining([expect.objectContaining({ supplierId: "cont-supplier" })]),
    );
  });
});
