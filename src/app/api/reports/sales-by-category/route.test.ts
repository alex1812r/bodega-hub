/**
 * @jest-environment node
 */

jest.mock("../../../../lib/api/dataSource", () => ({
  resolveDataSource: jest.fn(() => "mock"),
}));
jest.mock("../../../../modules/reports/services/moneyReports.server");

import { resolveDataSource } from "@/lib/api/dataSource";
import { getSalesByCategoryReport as getSalesByCategoryReportServer } from "@/modules/reports/services/moneyReports.server";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { GET } from "./route";

const VALID_QUERY = "from=2026-05-01&to=2026-05-31";

function get(query: string, role = "contador", headers: Record<string, string> = {}) {
  return GET(
    new Request(`http://localhost/api/reports/sales-by-category?${query}`, {
      headers: { "x-demo-role": role, ...headers },
    }),
  );
}

describe("/api/reports/sales-by-category", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (resolveDataSource as jest.Mock).mockReturnValue("mock");
  });

  it.each(["admin", "contador"])("responde el reporte al rol %s", async (role) => {
    const response = await get(VALID_QUERY, role);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items).toEqual(expect.any(Array));
    expect(body.data.totals).toEqual(expect.objectContaining({ revenueRef: expect.any(Number), units: expect.any(Number) }));
    expect(body.data.range).toEqual({ from: "2026-05-01", to: "2026-05-31" });
  });

  it.each(["vendedor", "almacen", "superadmin"])("bloquea al rol %s", async (role) => {
    const response = await get(VALID_QUERY, role);

    expect(response.status).toBe(403);
    expect(getSalesByCategoryReportServer).not.toHaveBeenCalled();
  });

  it("delega en el servidor de Supabase con los parámetros validados y la tienda de la sesión", async () => {
    (resolveDataSource as jest.Mock).mockReturnValue("supabase");
    (getSalesByCategoryReportServer as jest.Mock).mockResolvedValue({ marker: "server" });

    // `storeId` / `store_id` del cliente se ignoran: la tienda sale del contexto de autenticación.
    const response = await get(`${VALID_QUERY}&storeId=otra-tienda&store_id=otra-tienda`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({ marker: "server" });
    expect(getSalesByCategoryReportServer).toHaveBeenCalledTimes(1);
    expect(getSalesByCategoryReportServer).toHaveBeenCalledWith({ from: "2026-05-01", to: "2026-05-31" }, DEFAULT_STORE_ID);
  });

  it("un error del servicio sale con el formato de error de la API", async () => {
    (resolveDataSource as jest.Mock).mockReturnValue("supabase");
    (getSalesByCategoryReportServer as jest.Mock).mockRejectedValue(new Error("boom"));

    const response = await get(VALID_QUERY);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error.code).toEqual(expect.any(String));
  });
});

describe("/api/reports/sales-by-category: validación de parámetros", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (resolveDataSource as jest.Mock).mockReturnValue("supabase");
  });

  it.each([
    ["", /Indica las fechas/],
    ["from=2026-05-01", /Indica las fechas/],
    ["from=2026-13-40&to=2026-05-31", /"desde" no es válida/],
    ["from=2026-05-01&to=ayer", /"hasta" no es válida/],
    ["from=2026-05-19&to=2026-05-18", /no puede ser posterior/],
    ["from=2000-01-01&to=2026-05-18", /demasiado amplio/],
  ])("responde 400 en español con \"%s\" y no consulta", async (query, message) => {
    const response = await get(query);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("BAD_REQUEST");
    expect(body.error.message).toMatch(message);
    expect(getSalesByCategoryReportServer).not.toHaveBeenCalled();
  });
});
