/**
 * @jest-environment node
 */

import { GET } from "./route";

describe("/api/platform/home/low-stock", () => {
  it("returns low stock for superadmin", async () => {
    const response = await GET(
      new Request("http://localhost/api/platform/home/low-stock?storeScope=all", {
        headers: { "x-demo-role": "superadmin" },
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.items).toEqual(expect.any(Array));
  });

  it("rejects store admin", async () => {
    const response = await GET(
      new Request("http://localhost/api/platform/home/low-stock?storeScope=all", {
        headers: { "x-demo-role": "admin" },
      }),
    );

    expect(response.status).toBe(403);
  });
});
