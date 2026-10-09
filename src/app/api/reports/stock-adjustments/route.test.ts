/**
 * @jest-environment node
 */

jest.mock("../../../../lib/api/dataSource", () => ({
  resolveDataSource: jest.fn(() => "mock"),
}));
jest.mock("../../../../modules/reports/services/inventoryReports.server");

import { resolveDataSource } from "@/lib/api/dataSource";
import { getStockAdjustmentsReport as getStockAdjustmentsReportServer } from "@/modules/reports/services/inventoryReports.server";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { GET } from "./route";

const VALID_QUERY = "from=2026-05-01&to=2026-05-31";

function get(query: string, role = "admin", headers: Record<string, string> = {}) {
  return GET(
    new Request(`http://localhost/api/reports/stock-adjustments?${query}`, {
      headers: { "x-demo-role": role, ...headers },
    }),
  );
}

describe("/api/reports/stock-adjustments", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (resolveDataSource as jest.Mock).mockReturnValue("mock");
  });

  it("responde el reporte al admin: resumen por motivo, serie sin huecos, totales y filas", async () => {
    const response = await get(`${VALID_QUERY}&groupBy=day`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual(
      expect.objectContaining({
        byReason: expect.any(Array),
        costBasis: "current_cost",
        groupBy: "day",
        items: expect.any(Array),
        limit: 10,
        range: { from: "2026-05-01", to: "2026-05-31" },
        skip: 0,
        total: expect.any(Number),
      }),
    );
    expect(body.data.series).toHaveLength(31);
    expect(body.data.totals).toEqual({
      movementsCount: body.data.total,
      netUnits: expect.any(Number),
      netValueRef: expect.any(Number),
      unitsIn: expect.any(Number),
      unitsOut: expect.any(Number),
      valueInRef: expect.any(Number),
      valueOutRef: expect.any(Number),
    });
    for (const item of body.data.items) {
      expect(item.product.href).toBe(`/products/${item.product.id}`);
      expect(item.reason.trim().length).toBeGreaterThan(0);
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
    expect(getStockAdjustmentsReportServer).not.toHaveBeenCalled();
  });

  it("delega en el servidor de Supabase con los parámetros validados y la tienda de la sesión", async () => {
    (resolveDataSource as jest.Mock).mockReturnValue("supabase");
    (getStockAdjustmentsReportServer as jest.Mock).mockResolvedValue({ marker: "server" });

    // `storeId` / `store_id` del cliente se ignoran: la tienda sale del contexto de autenticación.
    const response = await get(
      `${VALID_QUERY}&groupBy=month&limit=25&skip=50&storeId=otra-tienda&store_id=otra-tienda`,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({ marker: "server" });
    expect(getStockAdjustmentsReportServer).toHaveBeenCalledTimes(1);
    expect(getStockAdjustmentsReportServer).toHaveBeenCalledWith(
      { from: "2026-05-01", groupBy: "month", limit: 25, skip: 50, to: "2026-05-31" },
      DEFAULT_STORE_ID,
    );
  });

  it.each(["", "&groupBy=auto"])("sin agrupación explícita (\"%s\") el servicio la decide", async (suffix) => {
    (resolveDataSource as jest.Mock).mockReturnValue("supabase");
    (getStockAdjustmentsReportServer as jest.Mock).mockResolvedValue({ marker: "server" });

    await get(`${VALID_QUERY}${suffix}`);

    expect(getStockAdjustmentsReportServer).toHaveBeenCalledWith(
      expect.objectContaining({ groupBy: null }),
      DEFAULT_STORE_ID,
    );
  });

  it("un error del servicio sale con el formato de error de la API", async () => {
    (resolveDataSource as jest.Mock).mockReturnValue("supabase");
    (getStockAdjustmentsReportServer as jest.Mock).mockRejectedValue(new Error("boom"));

    const response = await get(VALID_QUERY);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error.code).toEqual(expect.any(String));
  });

  it.each([
    ["", /Indica las fechas/],
    ["to=2026-05-31", /Indica las fechas/],
    ["from=2026-13-40&to=2026-05-31", /"desde" no es válida/],
    ["from=2026-05-19&to=2026-05-18", /no puede ser posterior/],
    ["from=2000-01-01&to=2026-05-18", /demasiado amplio/],
    [`${VALID_QUERY}&groupBy=category`, /La agrupación no es válida\. Usa day, week, month o auto\./],
  ])("responde 400 en español con \"%s\" y no consulta", async (query, message) => {
    (resolveDataSource as jest.Mock).mockReturnValue("supabase");

    const response = await get(query);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("BAD_REQUEST");
    expect(body.error.message).toMatch(message);
    expect(getStockAdjustmentsReportServer).not.toHaveBeenCalled();
  });
});
