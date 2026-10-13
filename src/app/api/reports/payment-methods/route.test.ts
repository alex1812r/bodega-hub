/**
 * @jest-environment node
 */

jest.mock("../../../../lib/api/dataSource", () => ({
  resolveDataSource: jest.fn(() => "mock"),
}));
jest.mock("../../../../modules/reports/services/paymentMethodsReport.server");

import { resolveDataSource } from "@/lib/api/dataSource";
import { getPaymentMethodsReport as getPaymentMethodsReportServer } from "@/modules/reports/services/paymentMethodsReport.server";

import { GET } from "./route";

describe("/api/reports/payment-methods", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (resolveDataSource as jest.Mock).mockReturnValue("mock");
  });

  it("returns payment methods report for accountant", async () => {
    const response = await GET(
      new Request("http://localhost/api/reports/payment-methods", {
        headers: { "x-demo-role": "contador" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items).toEqual(expect.any(Array));
    expect(body.data.items).toHaveLength(5);
    expect(body.data.summary).toEqual(
      expect.objectContaining({
        paymentCount: expect.any(Number),
        totalRef: expect.any(Number),
        totalVes: expect.any(Number),
      }),
    );
  });

  it("blocks seller from reports", async () => {
    const response = await GET(
      new Request("http://localhost/api/reports/payment-methods", {
        headers: { "x-demo-role": "vendedor" },
      }),
    );

    expect(response.status).toBe(403);
  });

  it("delegates to supabase server when configured", async () => {
    (resolveDataSource as jest.Mock).mockReturnValue("supabase");
    (getPaymentMethodsReportServer as jest.Mock).mockResolvedValue({
      items: [
        { amountRef: 10, amountVes: 5000, method: "efectivo_ves", paymentCount: 1 },
      ],
      limit: 10,
      skip: 0,
      summary: { paymentCount: 1, totalRef: 10, totalVes: 5000 },
      total: 5,
    });

    const response = await GET(
      new Request("http://localhost/api/reports/payment-methods?from=2026-05-18&to=2026-05-18", {
        headers: { "x-demo-role": "contador" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items).toHaveLength(1);
    expect(getPaymentMethodsReportServer).toHaveBeenCalled();
  });
});

describe("/api/reports/payment-methods: validación de parámetros (REP-05)", () => {
  function get(query: string) {
    return GET(
      new Request(`http://localhost/api/reports/payment-methods?${query}`, {
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
