import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ApiClient, ApiResponse, JsonRecord } from "../../e2e-bodegon/client";
import type { AgentContext } from "./base";
import { EventLogger, readEvents, type LabEvent } from "./logger";
import { createRng } from "./rng";
import { setup, step, teardown, vendedorRoleFor, vendedorState } from "./vendedor";

type MockClient = jest.Mocked<Pick<ApiClient, "request" | "login">>;

type HarnessOptions = {
  seed?: number;
  agent?: string;
  sessionOpen?: boolean;
  saleResponse?: (body: JsonRecord) => ApiResponse;
};

const USER_ID = "user-vendedor-1";
const HOT_IDS = ["hot-1", "hot-2", "hot-3", "hot-4", "hot-5"];

function json(status: number, body: JsonRecord | null): ApiResponse {
  return { ok: status >= 200 && status <= 299, status, body };
}

function catalogItems(): JsonRecord[] {
  const items: JsonRecord[] = HOT_IDS.map((id, i) => ({
    id,
    sku: `LAB-HOT-0${i + 1}`,
    name: `Hot ${i + 1}`,
    isActive: true,
    currentStock: 500,
    salePriceRef: 2,
  }));
  for (let i = 1; i <= 10; i += 1) {
    items.push({
      id: `prod-${i}`,
      sku: `LAB-${String(i).padStart(3, "0")}`,
      name: `Prod ${i}`,
      isActive: true,
      currentStock: 40,
      salePriceRef: 1.5,
    });
  }
  items.push({ id: "inact-1", sku: "LAB-INACT-01", name: "Inactivo", isActive: false, currentStock: 10, salePriceRef: 1 });
  items.push({ id: "zero-1", sku: "LAB-ZERO-01", name: "Sin stock", isActive: true, currentStock: 0, salePriceRef: 1 });
  return items;
}

function createHarness(dir: string, options: HarnessOptions = {}) {
  let saleCounter = 0;
  const calls: Array<{ method: string; path: string }> = [];
  const saleResponse =
    options.saleResponse ??
    ((body: JsonRecord) => {
      saleCounter += 1;
      const items = Array.isArray(body.items) ? (body.items as JsonRecord[]) : [];
      const totalRef = items.reduce((sum, item) => sum + Number(item.quantity) * Number(item.unitPriceRef), 0);
      return json(201, {
        data: {
          id: `sale-${saleCounter}`,
          status: body.payments ? "pagada" : "pendiente_pago",
          totalRef,
          totalVes: Math.round(totalRef * 50 * 100) / 100,
        },
      });
    });

  const client: MockClient = {
    login: jest.fn<Promise<ApiResponse>, [email: string, password: string]>(async () => json(200, { data: { role: "vendedor", user: { id: USER_ID } } })),
    request: jest.fn(async (path: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ method, path });
      const body = typeof init?.body === "string" ? (JSON.parse(init.body) as JsonRecord) : {};
      if (path.startsWith("/api/products")) {
        const items = catalogItems();
        return json(200, { data: { items, total: items.length, limit: 100, skip: 0 } });
      }
      if (path === "/api/inventory/pack-conversions") {
        return json(403, { error: { code: "FORBIDDEN", message: "Sin permiso" } });
      }
      if (path === "/api/cash/session") {
        return json(200, { data: options.sessionOpen ? { id: "sess-existing", status: "open" } : null });
      }
      if (path === "/api/cash/registers") {
        return json(200, {
          data: {
            items: [
              { id: "reg-2", name: "Caja Lab 2", assignedUserId: "otro" },
              { id: "reg-1", name: "Caja Lab 1", assignedUserId: USER_ID },
            ],
          },
        });
      }
      if (path === "/api/cash/session/open") {
        return json(201, { data: { id: "sess-new", registerId: body.registerId, status: "open" } });
      }
      if (path === "/api/cash/session/close") {
        return json(200, { data: { id: body.sessionId, status: "closed" } });
      }
      if (path === "/api/exchange-rates/current") {
        return json(200, { data: { id: "rate-1", rateVes: 50 } });
      }
      if (path.startsWith("/api/contacts")) {
        return json(200, {
          data: {
            items: [
              { id: "cli-final", name: "Consumidor final", isPosDefault: true },
              { id: "cli-1", name: "María" },
              { id: "cli-2", name: "Pedro" },
            ],
          },
        });
      }
      if (path === "/api/sales" && method === "POST") {
        return saleResponse(body);
      }
      if (/^\/api\/sales\/[^/]+\/cancel$/.test(path)) {
        return json(200, { data: { id: path.split("/")[3], status: "cancelada" } });
      }
      if (/^\/api\/sales\/[^/]+\/return$/.test(path)) {
        return json(200, { data: { id: path.split("/")[3], status: "devuelta" } });
      }
      if (path === "/api/payments") {
        return json(201, { data: { id: `pay-${calls.length}`, status: "activo" } });
      }
      return json(404, { error: { code: "NOT_FOUND", message: `sin ruta ${method} ${path}` } });
    }),
  };

  const ctx: AgentContext = {
    client: client as unknown as ApiClient,
    logger: new EventLogger("run-test", options.agent ?? "vendedor", dir),
    rng: createRng(options.seed ?? 7),
    catalog: [],
    state: {},
  };
  return { ctx, client, calls };
}

function events(ctx: AgentContext): LabEvent[] {
  return readEvents(ctx.logger.filePath);
}

async function runSteps(ctx: AgentContext, count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await step(ctx);
  }
}

describe("vendedor agent", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "stock-lab-vendedor-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("elige vendedor2 solo si el nombre del agente termina en 2", () => {
    expect(vendedorRoleFor("vendedor")).toBe("vendedor1");
    expect(vendedorRoleFor("vendedor-1")).toBe("vendedor1");
    expect(vendedorRoleFor("vendedor-2")).toBe("vendedor2");
    expect(vendedorRoleFor("vendedor2")).toBe("vendedor2");
  });

  it("con semilla fija la secuencia de 20 steps es determinista", async () => {
    const first = createHarness(join(dir, "a"), { seed: 42 });
    await setup(first.ctx);
    await runSteps(first.ctx, 20);
    const second = createHarness(join(dir, "b"), { seed: 42 });
    await setup(second.ctx);
    await runSteps(second.ctx, 20);

    const project = (list: LabEvent[]) => list.map((event) => ({ op: event.op, payload: event.payload, status: event.status }));
    const firstEvents = events(first.ctx);
    expect(firstEvents.length).toBeGreaterThanOrEqual(21);
    expect(project(firstEvents)).toEqual(project(events(second.ctx)));
    expect(first.calls).toEqual(second.calls);
    const ops = new Set(firstEvents.map((event) => event.op));
    expect(ops.has("sale_create")).toBe(true);
  });

  it("una venta 201 registra expected_delta negativo por producto; una 400 registra {} y error", async () => {
    const okHarness = createHarness(join(dir, "ok"), { seed: 3 });
    await setup(okHarness.ctx);
    await step(okHarness.ctx);
    const okEvent = events(okHarness.ctx).find((event) => event.op === "sale_create");
    expect(okEvent).toBeDefined();
    expect(okEvent?.status).toBe(201);
    const payload = okEvent?.payload as JsonRecord;
    const items = payload.items as Array<{ productId: string; quantity: number }>;
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(okEvent?.expected_delta[item.productId]).toBe(-item.quantity);
    }
    expect(Object.keys(okEvent?.expected_delta ?? {})).toHaveLength(items.length);
    expect(okEvent?.error).toBeUndefined();
    expect(typeof payload.clientRequestId).toBe("string");
    expect(payload.exchangeRateId).toBe("rate-1");
    expect(payload.refRateVes).toBe(50);
    expect(vendedorState(okHarness.ctx).sales).toHaveLength(1);
    const sold = vendedorState(okHarness.ctx).sales[0];
    const localStock = okHarness.ctx.catalog.find((p) => p.id === items[0]?.productId);
    expect(localStock?.currentStock).toBe(
      (items[0]?.productId.startsWith("hot") ? 500 : 40) - (items[0]?.quantity ?? 0),
    );
    expect(sold?.items).toEqual(items.map(({ productId, quantity }) => ({ productId, quantity })));

    const failHarness = createHarness(join(dir, "fail"), {
      seed: 3,
      saleResponse: () => json(400, { error: { code: "BAD_REQUEST", message: "Stock insuficiente" } }),
    });
    await setup(failHarness.ctx);
    await step(failHarness.ctx);
    const failEvent = events(failHarness.ctx).find((event) => event.op === "sale_create");
    expect(failEvent?.status).toBe(400);
    expect(failEvent?.expected_delta).toEqual({});
    expect(failEvent?.response_id).toBeNull();
    expect(failEvent?.error).toBe("BAD_REQUEST Stock insuficiente");
    expect(vendedorState(failHarness.ctx).sales).toHaveLength(0);
  });

  it("sesga las líneas hacia los productos hot (>= 40 % en 200 steps)", async () => {
    const harness = createHarness(join(dir, "hot"), { seed: 11 });
    await setup(harness.ctx);
    await runSteps(harness.ctx, 200);
    let total = 0;
    let hot = 0;
    for (const event of events(harness.ctx)) {
      if (event.op !== "sale_create") continue;
      const items = (event.payload as JsonRecord).items as Array<{ productId: string }>;
      for (const item of items) {
        total += 1;
        if (HOT_IDS.includes(item.productId)) hot += 1;
      }
    }
    expect(total).toBeGreaterThan(100);
    expect(hot / total).toBeGreaterThanOrEqual(0.4);
  });

  it("cubre el total con pagos en el 80 % y mezcla cancelaciones, devoluciones y cobros", async () => {
    const harness = createHarness(join(dir, "mix"), { seed: 5 });
    await setup(harness.ctx);
    await runSteps(harness.ctx, 150);
    const all = events(harness.ctx);
    const sales = all.filter((event) => event.op === "sale_create");
    const withPayments = sales.filter((event) => Array.isArray((event.payload as JsonRecord).payments));
    expect(withPayments.length).toBeGreaterThan(sales.length * 0.6);
    expect(withPayments.length).toBeLessThan(sales.length);
    for (const event of withPayments) {
      const payload = event.payload as JsonRecord;
      const items = payload.items as Array<{ quantity: number; unitPriceRef: number }>;
      const totalRef = Math.round(items.reduce((sum, item) => sum + item.quantity * item.unitPriceRef, 0) * 100) / 100;
      const payments = payload.payments as Array<{ currency: string; amount: number; change?: { amount: number } }>;
      const coveredRef = payments.reduce((sum, payment) => {
        const paidRef = payment.currency === "USD" ? payment.amount : payment.amount / 50;
        const changeRef = (payment.change?.amount ?? 0) / 50;
        return sum + paidRef - changeRef;
      }, 0);
      expect(Math.abs(coveredRef - totalRef)).toBeLessThan(0.02);
    }
    const ops = new Set(all.map((event) => event.op));
    expect(ops).toEqual(new Set(["cash_open", "sale_create", "sale_cancel", "sale_return", "payment_create"]));
    for (const event of all) {
      if (event.op === "sale_cancel" || event.op === "sale_return") {
        expect(Object.values(event.expected_delta).every((delta) => delta > 0)).toBe(true);
      }
      if (event.op === "payment_create") {
        expect(event.expected_delta).toEqual({});
      }
    }
  });

  it("abre la caja asignada en setup si no hay sesión y la cierra en teardown", async () => {
    const harness = createHarness(join(dir, "open"), { seed: 1 });
    await setup(harness.ctx);
    expect(harness.client.login).toHaveBeenCalledWith("lab-vendedor-1@lab.local", "Lab2026!");
    const openCall = harness.calls.find((call) => call.path === "/api/cash/session/open");
    expect(openCall?.method).toBe("POST");
    const openEvent = events(harness.ctx).find((event) => event.op === "cash_open");
    expect(openEvent?.payload).toEqual({ registerId: "reg-1", openingVes: 0, openingRef: 0 });
    expect(openEvent?.expected_delta).toEqual({});
    expect(openEvent?.response_id).toBe("sess-new");
    const state = vendedorState(harness.ctx);
    expect(state.sessionId).toBe("sess-new");
    expect(state.openedSession).toBe(true);

    await teardown(harness.ctx);
    const closeCall = harness.calls.find((call) => call.path === "/api/cash/session/close");
    expect(closeCall?.method).toBe("POST");
    const closeEvent = events(harness.ctx).find((event) => event.op === "cash_close");
    expect(closeEvent?.payload).toEqual({ sessionId: "sess-new", closingVes: 0, closingRef: 0 });
    expect(closeEvent?.status).toBe(200);
  });

  it("no abre ni cierra la caja si ya había una sesión abierta", async () => {
    const harness = createHarness(join(dir, "already"), { seed: 1, sessionOpen: true, agent: "vendedor-2" });
    await setup(harness.ctx);
    expect(harness.client.login).toHaveBeenCalledWith("lab-vendedor-2@lab.local", "Lab2026!");
    expect(harness.calls.some((call) => call.path === "/api/cash/session/open")).toBe(false);
    const state = vendedorState(harness.ctx);
    expect(state.sessionId).toBe("sess-existing");
    expect(state.openedSession).toBe(false);

    await teardown(harness.ctx);
    expect(harness.calls.some((call) => call.path === "/api/cash/session/close")).toBe(false);
    expect(events(harness.ctx)).toEqual([]);
  });
});
