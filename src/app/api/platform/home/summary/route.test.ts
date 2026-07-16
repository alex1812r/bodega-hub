/**
 * @jest-environment node
 */

import { GET } from "./route";

describe("/api/platform/home/summary", () => {
  const originalDataSource = process.env.API_DATA_SOURCE;

  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
  });

  afterAll(() => {
    process.env.API_DATA_SOURCE = originalDataSource;
  });

  it("returns aggregated summary for superadmin", async () => {
    const response = await GET(
      new Request("http://localhost/api/platform/home/summary?storeScope=all", {
        headers: { "x-demo-role": "superadmin" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          lowStockCount: expect.any(Number),
          salesCount: expect.any(Number),
          totalRef: expect.any(Number),
        }),
      }),
    );
  });

  it("rejects store admin", async () => {
    const response = await GET(
      new Request("http://localhost/api/platform/home/summary?storeScope=all", {
        headers: { "x-demo-role": "admin" },
      }),
    );

    expect(response.status).toBe(403);
  });
});
