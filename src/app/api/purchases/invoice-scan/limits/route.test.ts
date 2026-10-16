/**
 * @jest-environment node
 */

jest.mock("../../../../../modules/invoice-scan/server/scans.mock-server", () => {
  const actual = jest.requireActual("../../../../../modules/invoice-scan/server/scans.mock-server");

  return { ...actual, getDailyUsage: jest.fn(actual.getDailyUsage) };
});

import * as mockRepo from "@/modules/invoice-scan/server/scans.mock-server";
import { INVOICE_SCAN_REAL_SESSION_MESSAGE } from "@/modules/invoice-scan/server/requireScanSession";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { GET } from "./route";

function request(query = "", headers: Record<string, string> = { "x-demo-role": "almacen" }) {
  return new Request(`http://localhost/api/purchases/invoice-scan/limits${query}`, { headers });
}

describe("GET /api/purchases/invoice-scan/limits", () => {
  const originalDataSource = process.env.API_DATA_SOURCE;
  const originalDemoAuth = process.env.ALLOW_DEMO_AUTH;
  const originalLimit = process.env.INVOICE_SCAN_DAILY_LIMIT;

  afterEach(() => {
    process.env.API_DATA_SOURCE = originalDataSource;
    process.env.ALLOW_DEMO_AUTH = originalDemoAuth;
    process.env.INVOICE_SCAN_DAILY_LIMIT = originalLimit;
  });

  it("responde 401 sin sesión", async () => {
    process.env.ALLOW_DEMO_AUTH = "false";

    expect((await GET(request())).status).toBe(401);
  });

  it("responde 403 sin purchases.create", async () => {
    expect((await GET(request("", { "x-demo-role": "contador" }))).status).toBe(403);
  });

  it("en mock devuelve el uso del día con la cuota configurada", async () => {
    process.env.INVOICE_SCAN_DAILY_LIMIT = "7";

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ data: { limit: 7, remaining: 7, used: 0 } });
  });

  it("pregunta por la tienda de la sesión e ignora un storeId del cliente", async () => {
    const spy = jest.mocked(mockRepo.getDailyUsage);
    spy.mockResolvedValueOnce({ limit: 50, remaining: 47, used: 3 });

    const response = await GET(request("?storeId=otra-tienda"));

    expect((await response.json()).data).toEqual({ limit: 50, remaining: 47, used: 3 });
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ storeId: DEFAULT_STORE_ID }),
      50,
      expect.any(Date),
    );
  });

  it("en supabase, anon con cabeceras demo responde 401 (caos-4 M2)", async () => {
    process.env.API_DATA_SOURCE = "supabase";
    process.env.ALLOW_DEMO_AUTH = "true";

    const response = await GET(
      request("", { "x-demo-role": "admin", "x-demo-store-id": "00000000-0000-4000-8000-000000000001" }),
    );

    expect(response.status).toBe(401);
    expect((await response.json()).error.message).toBe(INVOICE_SCAN_REAL_SESSION_MESSAGE);
  });
});
