/**
 * @jest-environment node
 */

import { GET } from "./route";

describe("/api/dashboard/daily-close", () => {
  const originalDataSource = process.env.API_DATA_SOURCE;

  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
  });

  afterAll(() => {
    process.env.API_DATA_SOURCE = originalDataSource;
  });

  it("returns composed daily close for the operational day", async () => {
    const response = await GET(
      new Request("http://localhost/api/dashboard/daily-close?from=2026-05-18&to=2026-05-18"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.sales).toEqual(
      expect.objectContaining({
        salesCount: expect.any(Number),
        totalRef: expect.any(Number),
        totalVes: expect.any(Number),
      }),
    );
    expect(body.data.payments).toEqual(expect.any(Array));
    expect(body.data.fx).toEqual(
      expect.objectContaining({
        vesLossRef: expect.any(Number),
      }),
    );
  });
});
