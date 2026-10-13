/**
 * @jest-environment node
 */

jest.mock("../../../../lib/api/dataSource", () => ({
  resolveDataSource: jest.fn(() => "mock"),
}));
jest.mock("../../../../modules/reports/services/inventoryReports.server");

import { resolveDataSource } from "@/lib/api/dataSource";
import { getStockTurnoverReport as getStockTurnoverReportServer } from "@/modules/reports/services/inventoryReports.server";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { GET } from "./route";

const VALID_QUERY = "from=2026-05-01&to=2026-05-31";

function get(query: string, role = "admin", headers: Record<string, string> = {}) {
  return GET(
    new Request(`http://localhost/api/reports/stock-turnover?${query}`, {
      headers: { "x-demo-role": role, ...headers },
    }),
  );
}

describe("/api/reports/stock-turnover", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (resolveDataSource as jest.Mock).mockReturnValue("mock");
  });

  it.each(["product", "category"])("responde el reporte al admin agrupado por %s", async (groupBy) => {
    const response = await get(`${VALID_QUERY}&groupBy=${groupBy}`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual(
      expect.objectContaining({
        groupBy,
        inventoryBasis: "average_opening_closing",
        items: expect.any(Array),
        range: { from: "2026-05-01", to: "2026-05-31" },
        rangeDays: 31,
      }),
    );
    expect(body.data.totals).toEqual(
      expect.objectContaining({
        cogsRef: expect.any(Number),
        soldUnits: expect.any(Number),
        stockValueRef: expect.any(Number),
      }),
    );
    // Un NaN o un Infinity saldrían como null en JSON: solo rotación y días pueden serlo.
    for (const row of [...body.data.items, body.data.totals]) {
      expect(typeof row.averageStockValueRef).toBe("number");
      expect(typeof row.cogsRef).toBe("number");
      expect(row.turnover === null || typeof row.turnover === "number").toBe(true);
      expect(row.daysOfInventory === null || row.daysOfInventory > 0).toBe(true);
    }
    expect(JSON.stringify(body.data)).not.toMatch(/userId|createdBy|seller|vendedor/i);
  });

  // contador tiene reports.view sin inventory.view; almacén, al revés; vendedor, ninguno.
  it.each(["contador", "almacen", "vendedor", "superadmin"])("bloquea al rol %s", async (role) => {
    (resolveDataSource as jest.Mock).mockReturnValue("supabase");

    const response = await get(VALID_QUERY, role);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
    expect(getStockTurnoverReportServer).not.toHaveBeenCalled();
  });

  it("delega en el servidor de Supabase con los parámetros validados y la tienda de la sesión", async () => {
    (resolveDataSource as jest.Mock).mockReturnValue("supabase");
    (getStockTurnoverReportServer as jest.Mock).mockResolvedValue({ marker: "server" });

    // `storeId` / `store_id` del cliente se ignoran: la tienda sale del contexto de autenticación.
    const response = await get(
      `${VALID_QUERY}&groupBy=category&limit=25&skip=50&storeId=otra-tienda&store_id=otra-tienda`,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({ marker: "server" });
    expect(getStockTurnoverReportServer).toHaveBeenCalledTimes(1);
    expect(getStockTurnoverReportServer).toHaveBeenCalledWith(
      { from: "2026-05-01", groupBy: "category", limit: 25, skip: 50, to: "2026-05-31" },
      DEFAULT_STORE_ID,
    );
  });

  it("sin groupBy agrupa por producto", async () => {
    (resolveDataSource as jest.Mock).mockReturnValue("supabase");
    (getStockTurnoverReportServer as jest.Mock).mockResolvedValue({ marker: "server" });

    await get(VALID_QUERY);

    expect(getStockTurnoverReportServer).toHaveBeenCalledWith(
      expect.objectContaining({ groupBy: "product" }),
      DEFAULT_STORE_ID,
    );
  });

  it("un error del servicio sale con el formato de error de la API", async () => {
    (resolveDataSource as jest.Mock).mockReturnValue("supabase");
    (getStockTurnoverReportServer as jest.Mock).mockRejectedValue(new Error("boom"));

    const response = await get(VALID_QUERY);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error.code).toEqual(expect.any(String));
  });

  it.each([
    ["", /Indica las fechas/],
    ["from=2026-05-01", /Indica las fechas/],
    ["from=2026-13-40&to=2026-05-31", /"desde" no es válida/],
    ["from=2026-05-01&to=ayer", /"hasta" no es válida/],
    ["from=2026-05-19&to=2026-05-18", /no puede ser posterior/],
    ["from=2000-01-01&to=2026-05-18", /demasiado amplio/],
    [`${VALID_QUERY}&groupBy=week`, /La agrupación no es válida\. Usa product o category\./],
    [`${VALID_QUERY}&groupBy=vendedor`, /La agrupación no es válida\. Usa product o category\./],
  ])("responde 400 en español con \"%s\" y no consulta", async (query, message) => {
    (resolveDataSource as jest.Mock).mockReturnValue("supabase");

    const response = await get(query);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("BAD_REQUEST");
    expect(body.error.message).toMatch(message);
    expect(getStockTurnoverReportServer).not.toHaveBeenCalled();
  });
});
