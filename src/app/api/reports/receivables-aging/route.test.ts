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
import { getReceivablesAgingReport as getReceivablesAgingReportServer } from "@/modules/reports/services/moneyReports.server";
import type { Permission, UserRole } from "@/shared/auth/permissions";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { GET } from "./route";

const VALID_QUERY = "bucket=30%2B&contactId=cont-1&skip=20&limit=50";

function get(query: string, role = "contador", headers: Record<string, string> = {}) {
  return GET(
    new Request(`http://localhost/api/reports/receivables-aging?${query}`, {
      headers: { "x-demo-role": role, ...headers },
    }),
  );
}

describe("/api/reports/receivables-aging", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (resolveDataSource as jest.Mock).mockReturnValue("mock");
  });

  it.each(["admin", "contador"])("responde el reporte al rol %s", async (role) => {
    const response = await get(VALID_QUERY, role);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items).toEqual(expect.any(Array));
    expect(body.data.summary.buckets.map((row: { bucket: string }) => row.bucket)).toEqual(["0-7", "8-30", "30+"]);
    expect(body.data).toEqual(expect.objectContaining({ limit: 50, skip: 20, total: expect.any(Number) }));
  });

  it.each(["vendedor", "almacen", "superadmin"])("bloquea al rol %s", async (role) => {
    const response = await get(VALID_QUERY, role);

    expect(response.status).toBe(403);
    expect(getReceivablesAgingReportServer).not.toHaveBeenCalled();
  });

  it("delega en el servidor de Supabase con los parámetros validados y la tienda de la sesión", async () => {
    (resolveDataSource as jest.Mock).mockReturnValue("supabase");
    (getReceivablesAgingReportServer as jest.Mock).mockResolvedValue({ marker: "server" });

    // `storeId` / `store_id` del cliente se ignoran: la tienda sale del contexto de autenticación.
    const response = await get(`${VALID_QUERY}&storeId=otra-tienda&store_id=otra-tienda`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({ marker: "server" });
    expect(getReceivablesAgingReportServer).toHaveBeenCalledTimes(1);
    expect(getReceivablesAgingReportServer).toHaveBeenCalledWith({ bucket: "30+", contactId: "cont-1", limit: 50, skip: 20 }, DEFAULT_STORE_ID);
  });

  it("un error del servicio sale con el formato de error de la API", async () => {
    (resolveDataSource as jest.Mock).mockReturnValue("supabase");
    (getReceivablesAgingReportServer as jest.Mock).mockRejectedValue(new Error("boom"));

    const response = await get(VALID_QUERY);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error.code).toEqual(expect.any(String));
  });
});

describe("/api/reports/receivables-aging: validación de parámetros", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (resolveDataSource as jest.Mock).mockReturnValue("supabase");
  });

  it.each([
    ["bucket=90", /tramo de antigüedad no es válido/],
    ["bucket=0-30", /tramo de antigüedad no es válido/],
    ["contactId=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", /contacto no es válido/],
  ])("responde 400 en español con \"%s\" y no consulta", async (query, message) => {
    const response = await get(query);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("BAD_REQUEST");
    expect(body.error.message).toMatch(message);
    expect(getReceivablesAgingReportServer).not.toHaveBeenCalled();
  });
});

describe("/api/reports/receivables-aging: permisos propios del reporte", () => {
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

    return GET(new Request("http://localhost/api/reports/receivables-aging?bucket=30%2B&contactId=cont-1&skip=20&limit=50"));
  }

  it.each<[Permission[], UserRole]>([
    [["reports.view"], "contador"],
    [["reports.view", "payments.view", "cash.view"], "contador"],
  ])("exige además payments.manage o sales.create (como las ventas de /api/payments/open-documents): 403 con %j y rol %s", async (permissions, role) => {
    const response = await getAs(permissions, role);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it.each<[Permission[], UserRole]>([
    [["reports.view", "payments.manage"], "contador"],
    [["reports.view", "sales.create"], "vendedor"],
  ])("responde 200 con %j y rol %s", async (permissions, role) => {
    const response = await getAs(permissions, role);

    expect(response.status).toBe(200);
  });
});
