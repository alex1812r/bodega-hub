/**
 * Contrato de las peticiones de e2e-bodegon contra el BFF actual. Sin red:
 * cliente falso que registra cada petición con el rol que la envía.
 *
 * - STK-514: `POST /api/sales` exige `clientRequestId` (uuid) propio por venta.
 * - POS-H11: compras con el cuerpo completo que valida `POST /api/purchases`,
 *   tasa = última fila de la tienda, turno de caja abierto antes de vender,
 *   baúl con fondos antes de pagar compras en efectivo, ventas / anulaciones /
 *   devoluciones como vendedor (el admin no vende) y devolución por ajuste
 *   ligada a su venta.
 */
import type { ApiClient, ApiResponse } from "./client";
import { USERS } from "./data";
import { createEmptyManifest, type E2eManifest } from "./manifest";
import {
  phase10Sales,
  phase11SalePayments,
  phase12Exceptions,
  phase13Prices,
  phase15Users,
  phase4Products,
  phase6SupplierProducts,
  phase8Purchases,
  phase9PurchasePayments,
} from "./phases";
import { buildPurchaseBody, splitAmount } from "./requests";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const STORE_RATE = { id: "rate-latest", rateVes: 875.6505 };
const SELLER_ID = "seller-from-api";

type Body = Record<string, unknown>;
type Call = { path: string; method: string; body: Body | null; role: string | null };
type Route = (call: Call) => unknown | undefined;

const ROLE_BY_EMAIL = Object.fromEntries(
  Object.entries(USERS).map(([role, user]) => [user.email, role]),
) as Record<string, string>;

/** Respuestas con forma real para las rutas de las que las fases leen algo. */
const defaultRoutes: Route = ({ path, method, body }) => {
  if (method === "GET" && path === "/api/exchange-rates?limit=1") return { items: [STORE_RATE] };
  if (method === "GET" && path === "/api/cash/session") return null;
  if (method === "GET" && path === "/api/cash/registers") return [];
  if (method === "GET" && path === "/api/auth/me") return { user: { id: SELLER_ID } };
  if (method === "GET" && path.startsWith("/api/users")) {
    return { items: [{ email: USERS.admin.email, id: "admin-id" }, { email: USERS.vendedor.email, id: SELLER_ID }] };
  }
  if (method === "POST" && path === "/api/purchases" && body) {
    const subtotalRef = Number(body.subtotalRef);
    return { id: undefined, totalRef: subtotalRef, totalVes: Number(body.subtotalVes) };
  }
  return undefined;
};

function fakeClient(routes: Route = defaultRoutes): { client: ApiClient; calls: Call[] } {
  const calls: Call[] = [];
  const purchases = new Map<string, unknown>();
  let counter = 0;
  let role: string | null = null;
  const respond = (path: string, init?: RequestInit): ApiResponse => {
    const raw = typeof init?.body === "string" ? init.body : null;
    const call: Call = { path, method: init?.method ?? "GET", body: raw ? (JSON.parse(raw) as Body) : null, role };
    calls.push(call);
    counter += 1;
    const id = `id-${counter}`;
    const generic = { id, rateVes: 52, totalVes: 104, totalRef: 2, status: "pendiente_pago", items: [], payments: [] };
    const purchaseDetail = /^\/api\/purchases\/(id-\d+)$/.exec(path);
    if (call.method === "GET" && purchaseDetail && purchases.has(purchaseDetail[1] ?? "")) {
      return { ok: true, status: 200, body: { data: purchases.get(purchaseDetail[1] ?? "") } } as unknown as ApiResponse;
    }
    const routed = routes(call);
    const data = routed === undefined ? generic : routed === null ? null : Array.isArray(routed) ? routed : { ...generic, ...(routed as object), id };
    if (call.method === "POST" && path === "/api/purchases") purchases.set(id, data);
    return { ok: true, status: 200, body: { data } } as unknown as ApiResponse;
  };
  const client = {
    request: async (path: string, init?: RequestInit) => respond(path, init),
    requestBinary: async (path: string, init?: RequestInit) => respond(path, init),
    login: async (email: string) => {
      role = ROLE_BY_EMAIL[email] ?? email;
      return { ok: true, status: 200, body: { data: {} } };
    },
    logout: async () => {
      role = null;
      return undefined;
    },
    step: async (_phase: string, _label: string, fn: () => Promise<ApiResponse>) => fn(),
    data: (res: ApiResponse) => (res.body as { data?: unknown } | null)?.data,
  };
  return { client: client as unknown as ApiClient, calls };
}

function manifest(): E2eManifest {
  const m = createEmptyManifest("http://localhost:3000");
  m.exchangeRateIds.push("rate-1");
  for (const key of [
    "oreo", "coca", "chicle", "arroz", "aceite", "harina", "pasta", "azucar", "cafe", "leche", "pepsi", "agua",
    "paleta", "helado_pote", "papas", "malta", "queso", "detergente",
  ]) {
    m.productIds[key] = `prod-${key}`;
  }
  for (const key of ["cli_maria", "cli_jose", "cli_ana", "cli_roberto", "cli_carmen", "cli_luis", "cli_pedro"]) {
    m.contactIds[key] = `contact-${key}`;
  }
  for (const key of ["prov_despensa", "prov_helados", "prov_refrescos", "prov_snacks"]) {
    m.contactIds[key] = `contact-${key}`;
  }
  return m;
}

const posts = (calls: Call[], path: string) => calls.filter((call) => call.path === path && call.method === "POST");
const indexOf = (calls: Call[], match: (call: Call) => boolean) => calls.findIndex(match);

describe("e2e-bodegon: contrato de las peticiones", () => {
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

    const sales = posts(calls, "/api/sales");
    // Fase 10: snacks, despensa, stock insuficiente, descuento (403), almacén (403). Fase 11: 4 ventas.
    // Fase 12: anular, devolver y devolución parcial. Fase 13: post-reprecio.
    expect(sales.length).toBeGreaterThanOrEqual(13);
    const keys = sales.map((call) => call.body?.clientRequestId);
    for (const key of keys) expect(key).toMatch(UUID);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("las ventas y las compras van con la última tasa registrada de la tienda, no con una fija", async () => {
    const { client, calls } = fakeClient();
    const m = manifest();
    await phase8Purchases(client, m);
    await phase10Sales(client, m);
    await phase12Exceptions(client, m);
    await phase13Prices(client, m);

    const documents = [...posts(calls, "/api/sales"), ...posts(calls, "/api/purchases")];
    expect(documents.length).toBeGreaterThan(8);
    for (const call of documents) {
      expect(call.body).toMatchObject({ exchangeRateId: STORE_RATE.id, refRateVes: STORE_RATE.rateVes });
    }
  });

  it("sin la lista de tasas cae a la última tasa del manifiesto", async () => {
    const { client, calls } = fakeClient(() => undefined);
    const m = manifest();
    await phase13Prices(client, m);

    expect(posts(calls, "/api/sales")[0]?.body).toMatchObject({ exchangeRateId: "rate-1", refRateVes: 52 });
  });

  it("cada compra lleva líneas por unidad con su alícuota y los totales de cabecera que exige el servidor", async () => {
    const { client, calls } = fakeClient();
    const m = manifest();
    await phase8Purchases(client, m);
    await phase9PurchasePayments(client, m);

    const purchases = posts(calls, "/api/purchases");
    // Fase 8: despensa, helados, cancelar, devolver, vendedor (403). Fase 9: una por método de pago.
    expect(purchases).toHaveLength(10);
    for (const { body } of purchases) {
      const items = body?.items as Body[];
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        expect(item).toMatchObject({ entryMode: "unit", costCurrency: "ref", taxRate: 0, taxRef: 0, taxVes: 0 });
        expect(item.subtotalRef).toBeCloseTo(Number(item.quantity) * Number(item.unitCostRef), 2);
        expect(item.subtotalVes).toBeCloseTo(Number(item.subtotalRef) * STORE_RATE.rateVes, 2);
        expect(item.unitCostVes).toBeCloseTo(Number(item.unitCostRef) * STORE_RATE.rateVes, 2);
      }
      expect(body).toMatchObject({ taxRef: 0, taxVes: 0, discountRef: 0, discountVes: 0 });
      expect(body?.subtotalRef).toBeCloseTo(items.reduce((sum, item) => sum + Number(item.subtotalRef), 0), 2);
      expect(body?.subtotalVes).toBeCloseTo(items.reduce((sum, item) => sum + Number(item.subtotalVes), 0), 2);
      expect(["pedido", "recibido"]).toContain(body?.status);
      expect(typeof body?.supplierId).toBe("string");
    }
  });

  it("fase 10: abre el turno de caja del vendedor (caja creada y asignada por el admin) antes de la primera venta", async () => {
    const { client, calls } = fakeClient();
    const m = manifest();
    await phase10Sales(client, m);

    const createRegister = indexOf(calls, (call) => call.path === "/api/cash/registers" && call.method === "POST");
    const assign = indexOf(calls, (call) => call.method === "PATCH" && call.path.startsWith("/api/cash/registers/"));
    const open = indexOf(calls, (call) => call.path === "/api/cash/session/open");
    const firstSale = indexOf(calls, (call) => call.path === "/api/sales" && call.method === "POST");

    expect(createRegister).toBeGreaterThan(-1);
    expect(calls[createRegister]?.role).toBe("admin");
    expect(calls[assign]).toMatchObject({ role: "admin", body: { assignedUserId: SELLER_ID } });
    expect(calls[open]).toMatchObject({ role: "vendedor", body: { openingVes: 0, openingRef: 0 } });
    expect(calls[open]?.body?.registerId).toBe(m.cashRegisterId);
    expect(createRegister).toBeLessThan(assign);
    expect(assign).toBeLessThan(open);
    expect(open).toBeLessThan(firstSale);
    expect(calls[firstSale]?.role).toBe("vendedor");
  });

  it("fase 10: con el turno ya abierto no crea caja ni abre otro", async () => {
    const { client, calls } = fakeClient((call) =>
      call.method === "GET" && call.path === "/api/cash/session" ? { status: "open" } : defaultRoutes(call),
    );
    const m = manifest();
    await phase10Sales(client, m);

    expect(calls.filter((call) => call.path.startsWith("/api/cash/registers"))).toEqual([]);
    expect(calls.filter((call) => call.path === "/api/cash/session/open")).toEqual([]);
    expect(m.cashSessionId).toMatch(/^id-\d+$/);
  });

  it("fase 10: el descuento de un vendedor se prueba como rechazo y las notas se editan sin pasar por el admin", async () => {
    const { client, calls } = fakeClient();
    await phase10Sales(client, manifest());

    const discounted = posts(calls, "/api/sales").filter((call) => Number(call.body?.discountRef ?? 0) > 0);
    expect(discounted).toHaveLength(1);
    expect(discounted[0]?.role).toBe("vendedor");
    const notes = calls.filter((call) => call.method === "PATCH" && /^\/api\/sales\/[^/]+$/.test(call.path));
    expect(notes.map((call) => call.role)).toEqual(["vendedor"]);
  });

  it("fase 6: el duplicado (409) repite un vínculo que sigue activo, no el que la fase desactivó", async () => {
    const { client, calls } = fakeClient();
    await phase6SupplierProducts(client, manifest());

    const creates = posts(calls, "/api/supplier-products");
    const deactivated = calls.find((call) => call.path.endsWith("/deactivate"))?.path.split("/")[3];
    // Las altas reciben ids correlativos: el vínculo desactivado es el de la primera.
    expect(deactivated).toBe("id-1");
    const duplicate = creates.find((call) => call.body?.supplierSku === "SNK-DUP")?.body;
    expect(duplicate).toBeDefined();
    const original = creates.findIndex(
      (call) => call.body?.productId === duplicate?.productId && call.body?.supplierId === duplicate?.supplierId,
    );
    // Recrear un vínculo inactivo lo reactiva (201); el 409 solo vale para uno activo.
    expect(original).toBeGreaterThan(0);
  });

  it("fases 10, 11 y 13: ninguna venta va por debajo del precio de lista que dejó la fase 4 (C19)", async () => {
    const { client, calls } = fakeClient();
    const m = manifest();
    await phase4Products(client, m);
    const repriced = new Map<string, number>();
    for (const call of calls) {
      const id = /^\/api\/products\/([^/]+)$/.exec(call.path)?.[1];
      if (call.method === "PATCH" && id && typeof call.body?.salePriceRef === "number") repriced.set(id, call.body.salePriceRef);
    }
    expect(repriced.size).toBeGreaterThan(0);

    calls.length = 0;
    await phase10Sales(client, m);
    await phase11SalePayments(client, m);
    await phase13Prices(client, m);

    const sold = posts(calls, "/api/sales").flatMap((call) => (call.body?.items as Body[]) ?? []);
    const checked = sold.filter((item) => repriced.has(String(item.productId)) && item.unitPriceRef !== undefined);
    expect(checked.length).toBeGreaterThan(1);
    for (const item of checked) {
      expect(Number(item.unitPriceRef)).toBeGreaterThanOrEqual(repriced.get(String(item.productId)) ?? 0);
    }
  });

  it("fase 11: los dos abonos de una venta suman su total al céntimo y los dólares no pasan del total", async () => {
    const { client, calls } = fakeClient((call) =>
      call.method === "POST" && call.path === "/api/sales" ? { totalRef: 3.2, totalVes: 2802.08 } : defaultRoutes(call),
    );
    await phase11SalePayments(client, manifest());

    const payments = posts(calls, "/api/payments");
    const bySale = new Map<string, Body[]>();
    for (const { body } of payments) bySale.set(String(body?.saleId), [...(bySale.get(String(body?.saleId)) ?? []), body ?? {}]);
    const split = [...bySale.values()].find((group) => group.length === 2) ?? [];
    expect(split.map((body) => body.method)).toEqual(["pago_movil", "transferencia"]);
    expect(Number(split[0]?.amount) + Number(split[1]?.amount)).toBeCloseTo(2802.08, 2);
    const usd = payments.find((call) => call.body?.method === "efectivo_usd")?.body;
    expect(usd).toMatchObject({ amount: 3.2, currency: "USD" });
    for (const call of payments) expect(call.role).toBe("contador");
  });

  it("fase 9: el admin deposita en el baúl antes del primer pago y ningún abono supera el total de su compra", async () => {
    const { client, calls } = fakeClient();
    await phase9PurchasePayments(client, manifest());

    const deposit = indexOf(calls, (call) => call.path === "/api/vault/deposits");
    const firstPayment = indexOf(calls, (call) => call.path === "/api/payments" && call.method === "POST");
    const totalRef = 15.6;
    const totalVes = Math.round(totalRef * STORE_RATE.rateVes * 100) / 100;

    expect(calls[deposit]?.role).toBe("admin");
    expect(calls[deposit]?.body).toMatchObject({ amountVes: totalVes, amountRef: 10 });
    expect(deposit).toBeLessThan(firstPayment);

    const payments = posts(calls, "/api/payments").filter((call) => call.body?.phone !== undefined || call.body?.method !== "pago_movil");
    const byMethod = Object.fromEntries(payments.map((call) => [String(call.body?.method), call.body]));
    expect(byMethod.efectivo_ves).toMatchObject({ amount: totalVes, currency: "VES" });
    expect(byMethod.efectivo_usd).toMatchObject({ amount: 10, currency: "USD" });
    // Abonos parciales redondeados al céntimo (±0,01 del porcentaje exacto).
    for (const [method, share] of [["pago_movil", 0.5], ["transferencia", 0.3], ["punto_venta", 0.2]] as const) {
      const amount = Number(byMethod[method]?.amount);
      expect(Math.abs(amount - totalVes * share)).toBeLessThan(0.0051);
      expect(Number(amount.toFixed(2))).toBe(amount);
    }
    for (const call of payments) expect(call.role).toBe("contador");
  });

  it("fase 12: vende, anula y devuelve como vendedor; la devolución por ajuste va ligada a una venta sin devolver", async () => {
    const { client, calls } = fakeClient();
    await phase12Exceptions(client, manifest());

    const sales = posts(calls, "/api/sales");
    expect(sales.map((call) => call.role)).toEqual(["vendedor", "vendedor", "vendedor"]);
    const cancel = calls.find((call) => /\/api\/sales\/[^/]+\/cancel$/.test(call.path));
    const saleReturn = calls.find((call) => /\/api\/sales\/[^/]+\/return$/.test(call.path));
    expect(cancel).toMatchObject({ role: "vendedor", method: "PATCH" });
    expect(saleReturn).toMatchObject({ role: "vendedor", method: "POST" });

    const adjustments = posts(calls, "/api/inventory/adjustments");
    expect(adjustments.map((call) => call.role)).toEqual(["admin", "admin"]);
    expect(adjustments[0]?.body).toMatchObject({ type: "devolucion_cliente", quantityDelta: 2 });
    expect(adjustments[0]?.body).not.toHaveProperty("saleId");
    const linked = String(adjustments[1]?.body?.saleId);
    expect(adjustments[1]?.body).toMatchObject({ type: "devolucion_cliente", quantityDelta: 2, productId: "prod-oreo" });
    expect(linked).toMatch(/^id-\d+$/);
    // No es la venta anulada ni la devuelta entera.
    expect(cancel?.path).not.toContain(`/${linked}/`);
    expect(saleReturn?.path).not.toContain(`/${linked}/`);
  });

  it("fase 13: el precio lo cambia el admin y la venta al precio nuevo la registra el vendedor", async () => {
    const { client, calls } = fakeClient();
    await phase13Prices(client, manifest());

    expect(calls.find((call) => call.path.endsWith("/price") && call.method === "POST")?.role).toBe("admin");
    expect(posts(calls, "/api/sales").map((call) => call.role)).toEqual(["vendedor"]);
  });

  it("fase 15: los permisos se conceden al vendedor que devuelve /api/users, no a un id fijo", async () => {
    const { client, calls } = fakeClient();
    const m = manifest();
    await phase15Users(client, m);

    expect(calls.find((call) => call.method === "PATCH" && call.path.startsWith("/api/users/"))?.path).toBe(`/api/users/${SELLER_ID}`);
    expect(m.vendedorUserId).toBe(SELLER_ID);
  });
});

describe("e2e-bodegon: cuerpos puros", () => {
  it("buildPurchaseBody cuadra subtotales en REF y Bs con una tasa de cuatro decimales", () => {
    const body = buildPurchaseBody({
      supplierId: "sup",
      status: "pedido",
      lines: [
        { productId: "a", quantity: 30, unitCostRef: 0.45 },
        { productId: "b", quantity: 30, unitCostRef: 3.8 },
      ],
      rate: { exchangeRateId: "rate", refRateVes: 875.6505 },
    });

    expect(body.items.map((item) => item.subtotalRef)).toEqual([13.5, 114]);
    expect(body.items.map((item) => item.subtotalVes)).toEqual([11821.28, 99824.16]);
    expect(body).toMatchObject({ subtotalRef: 127.5, subtotalVes: 111645.44, exchangeRateId: "rate", refRateVes: 875.6505 });
    expect(body).not.toHaveProperty("notes");
  });

  it("buildPurchaseBody no envía exchangeRateId si no hay fila de tasa", () => {
    const body = buildPurchaseBody({
      supplierId: "sup",
      status: "recibido",
      lines: [{ productId: "a", quantity: 1, unitCostRef: 1 }],
      rate: { refRateVes: 52 },
      notes: "nota",
    });

    expect(body).not.toHaveProperty("exchangeRateId");
    expect(body).toMatchObject({ notes: "nota", status: "recibido", subtotalVes: 52 });
  });

  it("splitAmount: el segundo abono es el resto exacto", () => {
    expect(splitAmount(8931.64, 0.4)).toEqual([3572.66, 5358.98]);
    const [first, rest] = splitAmount(6129.55, 0.4);
    expect(Math.round((first + rest) * 100)).toBe(612955);
  });
});
