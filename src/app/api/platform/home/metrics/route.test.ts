/**
 * @jest-environment node
 */

import { GET } from "./route";

describe("/api/platform/home/metrics", () => {
  it("returns aggregated metrics for superadmin", async () => {
    const response = await GET(
      new Request("http://localhost/api/platform/home/metrics?storeScope=all", {
        headers: { "x-demo-role": "superadmin" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          salesCount: expect.any(Number),
          totalRef: expect.any(Number),
        }),
      }),
    );
  });

  it("rejects store admin", async () => {
    const response = await GET(
      new Request("http://localhost/api/platform/home/metrics?storeScope=all", {
        headers: { "x-demo-role": "admin" },
      }),
    );

    expect(response.status).toBe(403);
  });
});
