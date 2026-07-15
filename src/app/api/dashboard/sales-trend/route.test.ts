/**
 * @jest-environment node
 */

import { GET } from "./route";

describe("/api/dashboard/sales-trend", () => {
  it("returns sales trend for dashboard viewer", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/dashboard/sales-trend?from=2026-05-01&to=2026-05-18",
        {
          headers: { "x-demo-role": "admin" },
        },
      ),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body.data.items)).toBe(true);
  });
});
