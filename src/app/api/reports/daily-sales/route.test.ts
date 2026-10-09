/**
 * @jest-environment node
 */

jest.mock("../../../../lib/api/dataSource", () => ({
  resolveDataSource: jest.fn(() => "mock"),
}));
jest.mock("../../../../modules/reports/services/reports.server");

import { resolveDataSource } from "@/lib/api/dataSource";
import { getDailySalesReport as getDailySalesReportServer } from "@/modules/reports/services/reports.server";

import { GET } from "./route";

describe("/api/reports/daily-sales", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (resolveDataSource as jest.Mock).mockReturnValue("mock");
  });

  it("returns daily sales report for accountant", async () => {
    const response = await GET(
      new Request("http://localhost/api/reports/daily-sales", {
        headers: { "x-demo-role": "contador" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items).toEqual(expect.any(Array));
  });

  it("blocks seller from reports", async () => {
    const response = await GET(
      new Request("http://localhost/api/reports/daily-sales", {
        headers: { "x-demo-role": "vendedor" },
      }),
    );

    expect(response.status).toBe(403);
  });

  it("delegates to supabase server when configured", async () => {
    (resolveDataSource as jest.Mock).mockReturnValue("supabase");
    (getDailySalesReportServer as jest.Mock).mockResolvedValue({
      items: [{ saleDate: "2026-05-18", salesCount: 1, totalRef: 10, totalVes: 5000, paidVes: 0 }],
      limit: 10,
      skip: 0,
      total: 1,
    });

    const response = await GET(
      new Request("http://localhost/api/reports/daily-sales?from=2026-05-18&to=2026-05-18", {
        headers: { "x-demo-role": "contador" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items).toHaveLength(1);
    expect(getDailySalesReportServer).toHaveBeenCalled();
  });
});

describe("/api/reports/daily-sales: validación de parámetros (REP-05)", () => {
  function get(query: string) {
    return GET(
      new Request(`http://localhost/api/reports/daily-sales?${query}`, {
        headers: { "x-demo-role": "contador" },
      }),
    );
  }

  it.each([
    ["from=2026-13-40", /"desde" no es válida/],
    ["to=ayer", /"hasta" no es válida/],
    ["from=2026-05-19&to=2026-05-18", /no puede ser posterior/],
    ["from=2026-05-01&to=2026-05-31&groupBy=anual", /agrupación no es válida/],
  ])("responde 400 en español con %s", async (query, message) => {
    const response = await get(query);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("BAD_REQUEST");
    expect(body.error.message).toMatch(message);
  });

  it("acepta un rango válido con groupBy y compare", async () => {
    const response = await get("from=2026-05-01&to=2026-05-31&groupBy=week&compare=1");

    expect(response.status).toBe(200);
  });
});
