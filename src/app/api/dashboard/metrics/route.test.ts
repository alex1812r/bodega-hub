/**
 * @jest-environment node
 */

import { GET } from "./route";

describe("/api/dashboard/metrics", () => {
  it("returns dashboard metrics for date range", async () => {
    const response = await GET(
      new Request("http://localhost/api/dashboard/metrics?from=2026-05-18&to=2026-05-18"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual(
      expect.objectContaining({
        salesCount: 2,
        totalRef: expect.any(Number),
        unitsSold: expect.any(Number),
      }),
    );
  });
});
