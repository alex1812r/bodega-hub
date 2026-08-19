/**
 * @jest-environment node
 */

import { GET } from "./route";

describe("/api/reports/daily-close", () => {
  const originalDataSource = process.env.API_DATA_SOURCE;

  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
  });

  afterAll(() => {
    process.env.API_DATA_SOURCE = originalDataSource;
  });

  it("returns composed daily close numbers for the store", async () => {
    const response = await GET(
      new Request("http://localhost/api/reports/daily-close?from=2026-05-18&to=2026-05-18", {
        headers: { "x-demo-role": "admin" },
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
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
    expect(body.data.vault).toEqual(
      expect.objectContaining({
        balanceRef: expect.any(Number),
      }),
    );
  });

  it("rejects users without reports.view", async () => {
    const response = await GET(
      new Request("http://localhost/api/reports/daily-close", {
        headers: { "x-demo-role": "vendedor" },
      }),
    );

    expect(response.status).toBe(403);
  });
});
