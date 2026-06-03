/**
 * @jest-environment node
 */

import { GET } from "./route";

describe("/api/reports/gross-profit", () => {
  it("returns gross profit report", async () => {
    const response = await GET(
      new Request("http://localhost/api/reports/gross-profit", {
        headers: { "x-demo-role": "contador" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items[0]).toEqual(expect.objectContaining({ grossProfitRef: expect.any(Number) }));
  });
});
