/**
 * @jest-environment node
 */

jest.mock("../../../../lib/api/dataSource", () => ({
  resolveDataSource: jest.fn(() => "mock"),
}));
jest.mock("../../../../lib/api/requirePermission", () => {
  const actual = jest.requireActual("../../../../lib/api/requirePermission");

  return { ...actual, requireStorePermission: jest.fn(actual.requireStorePermission) };
});
jest.mock("../../../../modules/reports/services/moneyReports.server");

import { resolveDataSource } from "@/lib/api/dataSource";
import { requireStorePermission } from "@/lib/api/requirePermission";
import { getCashCloseDifferencesReport as getCashCloseDifferencesReportServer } from "@/modules/reports/services/moneyReports.server";
import type { Permission, UserRole } from "@/shared/auth/permissions";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { GET } from "./route";

const VALID_QUERY = "from=2026-05-01&to=2026-05-31&currency=ves&skip=10&limit=20";

function get(query: string, role = "contador", headers: Record<string, string> = {}) {
  return GET(
    new Request(`http://localhost/api/reports/cash-close-differences?${query}`, {
      headers: { "x-demo-role": role, ...headers },
    }),
  );
}

describe("/api/reports/cash-close-differences", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (resolveDataSource as jest.Mock).mockReturnValue("mock");
  });

  it.each(["admin", "contador"])("responde el reporte al rol %s", async (role) => {
    const response = await get(VALID_QUERY, role);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items).toEqual(expect.any(Array));
    expect(body.data.totals.map((row: { currency: string }) => row.currency)).toEqual(["ves", "ref"]);
    expect(body.data.range).toEqual({ from: "2026-05-01", to: "2026-05-31" });
    expect(body.data).toEqual(expect.objectContaining({ limit: 20, skip: 10, total: expect.any(Number) }));
  });

  it.each(["vendedor", "almacen", "superadmin"])("bloquea al rol %s", async (role) => {
    const response = await get(VALID_QUERY, role);

    expect(response.status).toBe(403);
    expect(getCashCloseDifferencesReportServer).not.toHaveBeenCalled();
  });

  it("delega en el servidor de Supabase con los parámetros validados y la tienda de la sesión", async () => {
    (resolveDataSource as jest.Mock).mockReturnValue("supabase");
    (getCashCloseDifferencesReportServer as jest.Mock).mockResolvedValue({ marker: "server" });

    // `storeId` / `store_id` del cliente se ignoran: la tienda sale del contexto de autenticación.
    const response = await get(`${VALID_QUERY}&storeId=otra-tienda&store_id=otra-tienda`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({ marker: "server" });
    expect(getCashCloseDifferencesReportServer).toHaveBeenCalledTimes(1);
    expect(getCashCloseDifferencesReportServer).toHaveBeenCalledWith({ currency: "ves", from: "2026-05-01", limit: 20, skip: 10, to: "2026-05-31" }, DEFAULT_STORE_ID);
  });

  it("un error del servicio sale con el formato de error de la API", async () => {
    (resolveDataSource as jest.Mock).mockReturnValue("supabase");
    (getCashCloseDifferencesReportServer as jest.Mock).mockRejectedValue(new Error("boom"));

    const response = await get(VALID_QUERY);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error.code).toEqual(expect.any(String));
  });
});

describe("/api/reports/cash-close-differences: validación de parámetros", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (resolveDataSource as jest.Mock).mockReturnValue("supabase");
  });

  it.each([
    ["currency=usd", /moneda no es válida/],
    ["from=ayer", /"desde" no es válida/],
    ["from=2026-05-19&to=2026-05-18", /no puede ser posterior/],
  ])("responde 400 en español con \"%s\" y no consulta", async (query, message) => {
    const response = await get(query);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("BAD_REQUEST");
    expect(body.error.message).toMatch(message);
    expect(getCashCloseDifferencesReportServer).not.toHaveBeenCalled();
  });
});

describe("/api/reports/cash-close-differences: permisos propios del reporte", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (resolveDataSource as jest.Mock).mockReturnValue("mock");
  });

  function getAs(permissions: Permission[], role: UserRole) {
    (requireStorePermission as jest.Mock).mockResolvedValueOnce({
      isSuperadmin: false,
      permissions,
      role,
      storeId: DEFAULT_STORE_ID,
      userId: "user-custom",
    });

    return GET(new Request("http://localhost/api/reports/cash-close-differences?from=2026-05-01&to=2026-05-31&currency=ves&skip=10&limit=20"));
  }

  it.each<[Permission[], UserRole]>([
    [["reports.view"], "contador"],
    [["reports.view", "payments.manage"], "contador"],
  ])("exige además cash.view (como el historial de turnos de /api/cash/registers/[id]/sessions): 403 con %j y rol %s", async (permissions, role) => {
    const response = await getAs(permissions, role);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it.each<[Permission[], UserRole]>([
    [["reports.view", "cash.view"], "contador"],
  ])("responde 200 con %j y rol %s", async (permissions, role) => {
    const response = await getAs(permissions, role);

    expect(response.status).toBe(200);
  });
});
