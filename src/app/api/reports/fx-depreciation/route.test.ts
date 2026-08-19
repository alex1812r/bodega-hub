/**
 * @jest-environment node
 */

jest.mock("../../../../lib/api/dataSource", () => ({
  resolveDataSource: jest.fn(() => "mock"),
}));

import { GET } from "./route";

describe("/api/reports/fx-depreciation", () => {
  it("returns fx depreciation report for accountant", async () => {
    const response = await GET(
      new Request("http://localhost/api/reports/fx-depreciation?from=2026-05-18&to=2026-05-18", {
        headers: { "x-demo-role": "contador" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items).toEqual(expect.any(Array));
    expect(body.data.summary).toEqual(
      expect.objectContaining({
        vesLossRef: expect.any(Number),
      }),
    );
  });

  it("blocks seller from reports", async () => {
    const response = await GET(
      new Request("http://localhost/api/reports/fx-depreciation", {
        headers: { "x-demo-role": "vendedor" },
      }),
    );

    expect(response.status).toBe(403);
  });
});
