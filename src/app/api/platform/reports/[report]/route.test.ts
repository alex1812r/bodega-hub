/**
 * @jest-environment node
 */

import { GET } from "./route";

describe("/api/platform/reports/[report]", () => {
  const originalDataSource = process.env.API_DATA_SOURCE;

  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
  });

  afterAll(() => {
    process.env.API_DATA_SOURCE = originalDataSource;
  });

  it("returns daily sales for all stores as superadmin", async () => {
    const response = await GET(
      new Request("http://localhost/api/platform/reports/daily-sales?storeScope=all", {
        headers: { "x-demo-role": "superadmin" },
      }),
      { params: Promise.resolve({ report: "daily-sales" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        data: expect.objectContaining({ items: expect.any(Array) }),
      }),
    );
  });

  it("rejects store admin", async () => {
    const response = await GET(
      new Request("http://localhost/api/platform/reports/daily-sales?storeScope=all", {
        headers: { "x-demo-role": "admin" },
      }),
      { params: Promise.resolve({ report: "daily-sales" }) },
    );

    expect(response.status).toBe(403);
  });

  it("requires a store when scope is one", async () => {
    const response = await GET(
      new Request("http://localhost/api/platform/reports/low-stock?storeScope=one", {
        headers: { "x-demo-role": "superadmin" },
      }),
      { params: Promise.resolve({ report: "low-stock" }) },
    );

    expect(response.status).toBe(400);
  });

  it("filters by a single store", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/platform/reports/low-stock?storeScope=one&storeIds=00000000-0000-4000-8000-000000000001",
        { headers: { "x-demo-role": "superadmin" } },
      ),
      { params: Promise.resolve({ report: "low-stock" }) },
    );

    expect(response.status).toBe(200);
  });
});
