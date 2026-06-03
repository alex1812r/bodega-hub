/**
 * @jest-environment node
 */

jest.mock("../../../../lib/api/dataSource", () => ({
  resolveDataSource: jest.fn(() => "mock"),
}));
jest.mock("../../../../modules/dashboard/services/dashboard.server");

import { resolveDataSource } from "@/lib/api/dataSource";
import { getDashboardSummary as getDashboardSummaryServer } from "@/modules/dashboard/services/dashboard.server";

import { GET } from "./route";

describe("/api/dashboard/summary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (resolveDataSource as jest.Mock).mockReturnValue("mock");
  });

  it("returns dashboard summary", async () => {
    const response = await GET(new Request("http://localhost/api/dashboard/summary"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual(
      expect.objectContaining({
        lowStockCount: expect.any(Number),
        totalRef: expect.any(Number),
      }),
    );
  });

  it("delegates to supabase server when configured", async () => {
    (resolveDataSource as jest.Mock).mockReturnValue("supabase");
    (getDashboardSummaryServer as jest.Mock).mockResolvedValue({
      lowStockCount: 1,
      pendingSalesCount: 0,
      salesCount: 2,
      totalRef: 40,
      totalVes: 20000,
    });

    const response = await GET(new Request("http://localhost/api/dashboard/summary"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.totalRef).toBe(40);
    expect(getDashboardSummaryServer).toHaveBeenCalled();
  });
});
