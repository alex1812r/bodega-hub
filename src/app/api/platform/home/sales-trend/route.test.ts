/**
 * @jest-environment node
 */

import { GET } from "./route";

describe("/api/platform/home/sales-trend", () => {
  it("returns sales trend for superadmin", async () => {
    const response = await GET(
      new Request("http://localhost/api/platform/home/sales-trend?storeScope=all", {
        headers: { "x-demo-role": "superadmin" },
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.items).toEqual(expect.any(Array));
  });

  it("rejects store admin", async () => {
    const response = await GET(
      new Request("http://localhost/api/platform/home/sales-trend?storeScope=all", {
        headers: { "x-demo-role": "admin" },
      }),
    );

    expect(response.status).toBe(403);
  });
});
