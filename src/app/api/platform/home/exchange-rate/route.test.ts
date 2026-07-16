/**
 * @jest-environment node
 */

import { GET } from "./route";

describe("/api/platform/home/exchange-rate", () => {
  const originalDataSource = process.env.API_DATA_SOURCE;

  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
  });

  afterAll(() => {
    process.env.API_DATA_SOURCE = originalDataSource;
  });

  it("returns the current rate for a superadmin", async () => {
    const response = await GET(
      new Request("http://localhost/api/platform/home/exchange-rate", {
        headers: { "x-demo-role": "superadmin" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual(
      expect.objectContaining({
        rateVes: expect.any(Number),
      }),
    );
  });

  it("rejects store admin", async () => {
    const response = await GET(
      new Request("http://localhost/api/platform/home/exchange-rate", {
        headers: { "x-demo-role": "admin" },
      }),
    );

    expect(response.status).toBe(403);
  });
});
