/**
 * STK-514: `POST /api/sales` exige `clientRequestId` (uuid). Todo intento de
 * venta del e2e debe llevar una clave propia. Sin red: cliente falso que
 * acepta cualquier petición y registra los cuerpos.
 */
import type { ApiClient, ApiResponse } from "./client";
import { createEmptyManifest, type E2eManifest } from "./manifest";
import { phase10Sales, phase11SalePayments, phase12Exceptions, phase13Prices } from "./phases";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type Call = { path: string; method: string; body: Record<string, unknown> | null };

function fakeClient(): { client: ApiClient; calls: Call[] } {
  const calls: Call[] = [];
  let counter = 0;
  const respond = (path: string, init?: RequestInit): ApiResponse => {
    const raw = typeof init?.body === "string" ? init.body : null;
    calls.push({ path, method: init?.method ?? "GET", body: raw ? (JSON.parse(raw) as Record<string, unknown>) : null });
    counter += 1;
    const data = { id: `id-${counter}`, rateVes: 52, totalVes: 104, totalRef: 2, status: "pendiente_pago", items: [], payments: [] };
    return { ok: true, status: 200, body: { data } } as unknown as ApiResponse;
  };
  const client = {
    request: async (path: string, init?: RequestInit) => respond(path, init),
    requestBinary: async (path: string, init?: RequestInit) => respond(path, init),
    login: async () => ({ ok: true, status: 200, body: { data: {} } }),
    logout: async () => undefined,
    step: async (_phase: string, _label: string, fn: () => Promise<ApiResponse>) => fn(),
    data: (res: ApiResponse) => (res.body as { data?: unknown } | null)?.data,
  };
  return { client: client as unknown as ApiClient, calls };
}

function manifest(): E2eManifest {
  const m = createEmptyManifest("http://localhost:3000");
  m.exchangeRateIds.push("rate-1");
  for (const key of ["oreo", "coca", "chicle", "arroz", "aceite", "harina", "pasta", "azucar", "cafe", "leche", "pepsi", "agua"]) {
    m.productIds[key] = `prod-${key}`;
  }
  for (const key of ["cli_maria", "cli_jose", "cli_ana", "cli_roberto", "cli_carmen", "cli_luis"]) {
    m.contactIds[key] = `contact-${key}`;
  }
  return m;
}

describe("e2e-bodegon: POST /api/sales lleva clientRequestId", () => {
  let log: jest.SpyInstance;

  beforeEach(() => {
    log = jest.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    log.mockRestore();
  });

  it("cada venta de las fases 10–13 envía un uuid distinto", async () => {
    const { client, calls } = fakeClient();
    const m = manifest();
    await phase10Sales(client, m);
    await phase11SalePayments(client, m);
    await phase12Exceptions(client, m);
    await phase13Prices(client, m);

    const sales = calls.filter((call) => call.path === "/api/sales" && call.method === "POST");
    // Fase 10: snacks, despensa, stock insuficiente, almacén (403). Fase 12: cancelar y devolver. Fase 13: post-reprecio.
    expect(sales.length).toBeGreaterThanOrEqual(7);
    const keys = sales.map((call) => call.body?.clientRequestId);
    for (const key of keys) expect(key).toMatch(UUID);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
