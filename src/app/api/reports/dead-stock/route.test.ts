/**
 * @jest-environment node
 */

jest.mock("../../../../lib/api/dataSource", () => ({
  resolveDataSource: jest.fn(() => "mock"),
}));
jest.mock("../../../../modules/reports/services/inventoryReports.server");

import { resolveDataSource } from "@/lib/api/dataSource";
import { getDeadStockReport as getDeadStockReportServer } from "@/modules/reports/services/inventoryReports.server";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { GET } from "./route";

const VALID_QUERY = "days=45";

function get(query: string, role = "admin", headers: Record<string, string> = {}) {
  return GET(
    new Request(`http://localhost/api/reports/dead-stock?${query}`, {
      headers: { "x-demo-role": role, ...headers },
    }),
  );
}

describe("/api/reports/dead-stock", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (resolveDataSource as jest.Mock).mockReturnValue("mock");
  });

  it("responde el reporte al admin, con 30 días por defecto", async () => {
    const response = await get("");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual(
      expect.objectContaining({
        asOf: "2026-05-18",
        days: 30,
        items: expect.any(Array),
        limit: 10,
        skip: 0,
        total: expect.any(Number),
      }),
    );
    expect(body.data.summary).toEqual(
      expect.objectContaining({
        idleValueRef: expect.any(Number),
        inventoryValueRef: expect.any(Number),
        productsCount: body.data.total,
      }),
    );
    expect(body.data.summary).toHaveProperty("idleValuePct");
    // Nada por usuario ni por vendedor.
    expect(JSON.stringify(body.data)).not.toMatch(/userId|createdBy|seller|vendedor/i);
  });

  // contador tiene reports.view sin inventory.view; almacén, al revés; vendedor, ninguno.
  it.each(["contador", "almacen", "vendedor", "superadmin"])("bloquea al rol %s", async (role) => {
    (resolveDataSource as jest.Mock).mockReturnValue("supabase");

    const response = await get(VALID_QUERY, role);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
    expect(getDeadStockReportServer).not.toHaveBeenCalled();
  });

  it("delega en el servidor de Supabase con los parámetros validados y la tienda de la sesión", async () => {
    (resolveDataSource as jest.Mock).mockReturnValue("supabase");
    (getDeadStockReportServer as jest.Mock).mockResolvedValue({ marker: "server" });

    // `storeId` / `store_id` del cliente se ignoran: la tienda sale del contexto de autenticación.
    const response = await get("days=45&categoryId=cat-1&skip=20&limit=50&storeId=otra-tienda&store_id=otra-tienda");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({ marker: "server" });
    expect(getDeadStockReportServer).toHaveBeenCalledTimes(1);
    expect(getDeadStockReportServer).toHaveBeenCalledWith(
      { categoryId: "cat-1", days: 45, limit: 50, skip: 20 },
      DEFAULT_STORE_ID,
    );
  });

  it("un error del servicio sale con el formato de error de la API", async () => {
    (resolveDataSource as jest.Mock).mockReturnValue("supabase");
    (getDeadStockReportServer as jest.Mock).mockRejectedValue(new Error("boom"));

    const response = await get(VALID_QUERY);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error.code).toEqual(expect.any(String));
  });

  it.each([
    ["days=0", /número entero entre 1 y 3650/],
    ["days=3651", /número entero entre 1 y 3650/],
    ["days=1.5", /número entero entre 1 y 3650/],
    ["days=treinta", /número entero entre 1 y 3650/],
    [`categoryId=${"x".repeat(121)}`, /La categoría no es válida/],
  ])("responde 400 en español con \"%s\" y no consulta", async (query, message) => {
    (resolveDataSource as jest.Mock).mockReturnValue("supabase");

    const response = await get(query);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("BAD_REQUEST");
    expect(body.error.message).toMatch(message);
    expect(getDeadStockReportServer).not.toHaveBeenCalled();
  });
});
