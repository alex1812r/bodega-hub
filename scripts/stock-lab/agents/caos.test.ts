import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ApiClient, type ApiResponse } from "../../e2e-bodegon/client";
import type { AgentContext, LabProduct } from "./base";
import {
  CHAOS_CASES,
  chaos_big_sale_reverse,
  chaos_cancel_vs_return,
  chaos_double_receive,
  chaos_double_sale,
  chaos_forbidden_adjust,
  chaos_over_adjust,
  chaos_over_stock_sale,
  chaos_race_stock,
  chaos_retry_same_key,
  chaos_sell_inactive,
  markHotProducts,
  pickCase,
  setup,
  step,
} from "./caos";
import { EventLogger, readEvents } from "./logger";
import { createRng } from "./rng";

type RequestFn = (path: string, init?: RequestInit) => Promise<ApiResponse>;
type Call = { method: string; path: string; body: Record<string, unknown> | null };
type Handler = (call: Call, index: number) => ApiResponse;

function okResponse(data: unknown, status = 201): ApiResponse {
  return { ok: true, status, body: { data } as Record<string, unknown> };
}

function errorResponse(status: number, code: string, message: string): ApiResponse {
  return { ok: false, status, body: { error: { code, message } } };
}

function product(overrides: Partial<LabProduct> & { id: string; sku: string }): LabProduct {
  return {
    name: overrides.sku,
    isActive: true,
    currentStock: 100,
    salePrice: 2,
    isHot: false,
    packUnitsPerPack: null,
    packUnitProductId: null,
    ...overrides,
  };
}

function sampleCatalog(): LabProduct[] {
  const hot = [1, 2, 3, 4, 5].map((n) => product({ id: `hot-${n}`, sku: `LAB-HOT-0${n}`, isHot: true, currentStock: 500, salePrice: 1.5 }));
  const cold = Array.from({ length: 25 }, (_, i) => product({ id: `cold-${i + 1}`, sku: `LAB-${String(i + 1).padStart(3, "0")}`, currentStock: 10 + i }));
  return [...hot, ...cold, product({ id: "inact-1", sku: "LAB-INACT-01", isActive: false, currentStock: 5 })];
}

/** Cliente con `request` mockeado por `"METHOD /path"` (prefijo); registra las llamadas. */
function mockClient(label: string, routes: Record<string, Handler>, calls: (Call & { client: string })[] = []) {
  const request = jest.fn<Promise<ApiResponse>, Parameters<RequestFn>>(async (path, init) => {
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    const call: Call = { method, path, body };
    calls.push({ ...call, client: label });
    const key = Object.keys(routes).find((route) => `${method} ${path}`.startsWith(route));
    const handler = key ? routes[key] : undefined;
    return handler ? handler(call, calls.length - 1) : okResponse({}, 200);
  });
  const client = Object.assign(new ApiClient("http://localhost:3100"), { request });
  return { client, request };
}

describe("caos agent", () => {
  let dir: string;
  let calls: (Call & { client: string })[];
  let saleCounter: number;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "stock-lab-caos-"));
    calls = [];
    saleCounter = 0;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** Rutas de venta que devuelven ids distintos (bug de idempotencia) o el mismo id. */
  function saleRoutes(mode: "distinct" | "same" | "reject"): Record<string, Handler> {
    return {
      "POST /api/sales": () => {
        if (mode === "reject") return errorResponse(400, "BAD_REQUEST", "stock insuficiente");
        saleCounter += 1;
        return okResponse({ id: mode === "same" ? "sale-1" : `sale-${saleCounter}` });
      },
    };
  }

  function makeCtx(
    seed: number,
    routes: { v1?: Record<string, Handler>; v2?: Record<string, Handler>; admin?: Record<string, Handler> },
    catalog: LabProduct[] = sampleCatalog(),
  ): AgentContext {
    const v1 = mockClient("vendedor1", routes.v1 ?? {}, calls).client;
    const v2 = mockClient("vendedor2", routes.v2 ?? {}, calls).client;
    const admin = mockClient("admin", routes.admin ?? {}, calls).client;
    return {
      client: v1,
      logger: new EventLogger("run-caos", "caos", dir),
      rng: createRng(seed),
      catalog,
      state: {
        vendedor2: v2,
        admin,
        customerId: "cust-final",
        exchangeRateId: "rate-1",
        refRateVes: 50,
        supplierId: "supp-1",
        timing: { doubleSaleGapMs: 0, retryGapMs: 0 },
        opsSinceRefresh: 0,
      },
    };
  }

  it("pickCase es determinista por semilla y cubre todos los casos", () => {
    const a = createRng(21);
    const b = createRng(21);
    const seqA = Array.from({ length: 300 }, () => pickCase(a));
    const seqB = Array.from({ length: 300 }, () => pickCase(b));
    expect(seqA).toEqual(seqB);
    expect(new Set(seqA)).toEqual(new Set(CHAOS_CASES));
  });

  it("step: la secuencia de ops con la misma semilla es idéntica entre dos runs", async () => {
    async function run(runId: string): Promise<string[]> {
      calls = [];
      saleCounter = 0;
      const ctx = makeCtx(99, {
        v1: { ...saleRoutes("distinct"), "POST /api/inventory/adjustments": () => errorResponse(403, "FORBIDDEN", "sin permiso") },
        v2: saleRoutes("distinct"),
        admin: {
          "POST /api/purchases": () => okResponse({ id: "purch-1" }),
          "PATCH /api/purchases/": () => okResponse({ id: "purch-1" }, 200),
          "POST /api/inventory/adjustments": () => errorResponse(400, "BAD_REQUEST", "stock insuficiente"),
        },
      });
      ctx.logger = new EventLogger(runId, "caos", dir);
      for (let i = 0; i < 15; i += 1) {
        await step(ctx);
      }
      return readEvents(ctx.logger.filePath);
    }
    const keyOf = (payload: unknown) => (payload as { clientRequestId?: string } | null)?.clientRequestId;
    // La clave de idempotencia depende de (semilla, run id): se compara aparte.
    const shape = (events: Awaited<ReturnType<typeof run>>) =>
      events.map((e) => `${e.op}:${JSON.stringify({ ...(e.payload as object), clientRequestId: undefined })}`);
    const keys = (events: Awaited<ReturnType<typeof run>>) => events.map((e) => keyOf(e.payload)).filter((key) => key !== undefined);
    const first = await run("det-a");
    const second = await run("det-b");
    expect(shape(first)).toEqual(shape(second));
    expect(first.length).toBeGreaterThanOrEqual(15);
    // Misma semilla en otro run → ninguna clave repetida (no choca con ventas de la corrida anterior).
    expect(keys(first).length).toBeGreaterThan(0);
    expect(keys(first).filter((key) => keys(second).includes(key))).toEqual([]);
  });

  it("setup: tres logins, abre solo las cajas sin sesión, tasa, consumidor final, proveedor y catálogo con admin", async () => {
    let sessionChecks = 0;
    const common: Record<string, Handler> = {
      "POST /api/auth/login": (call) => okResponse({ role: "x", user: { id: `u-${String(call.body?.email)}` } }, 200),
      "GET /api/auth/me": () => okResponse({ user: { id: "u-lab-vendedor-2@lab.local" } }, 200),
      "GET /api/cash/session": () => {
        sessionChecks += 1;
        // vendedor1 ya tiene sesión; vendedor2 no.
        return okResponse(sessionChecks === 1 ? { id: "sess-1" } : null, 200);
      },
      "GET /api/cash/registers": () =>
        okResponse({ items: [{ id: "reg-1", name: "Caja Lab 1", assignedUserId: "u-1" }, { id: "reg-2", name: "Caja Lab 2", assignedUserId: "u-lab-vendedor-2@lab.local" }] }, 200),
      "POST /api/cash/session/open": () => okResponse({ id: "sess-2", status: "open" }),
      "GET /api/exchange-rates/current": () => okResponse({ id: "rate-9", rateVes: 52 }, 200),
      "GET /api/contacts?type=cliente": () => okResponse({ items: [{ id: "c-other" }, { id: "c-final", isPosDefault: true }] }, 200),
      "GET /api/contacts?type=proveedor": () => okResponse({ items: [] }, 200),
      "POST /api/contacts": () => okResponse({ id: "supp-new" }),
      "GET /api/products": () => okResponse({ items: [{ id: "p1", sku: "lab-001", currentStock: 3, salePriceRef: 1 }, { id: "p2", sku: "lab-hot-01", currentStock: 500, salePriceRef: 1 }], total: 2 }, 200),
      "GET /api/inventory/pack-conversions": () => okResponse([], 200),
    };
    const ctx = makeCtx(1, { v1: common, v2: common, admin: common }, []);
    ctx.state = { vendedor2: ctx.state.vendedor2, admin: ctx.state.admin, timing: { doubleSaleGapMs: 0, retryGapMs: 0 } };
    await setup(ctx);

    const logins = calls.filter((c) => c.path === "/api/auth/login").map((c) => `${c.client}:${String(c.body?.email)}`);
    expect(logins).toEqual(["vendedor1:lab-vendedor-1@lab.local", "vendedor2:lab-vendedor-2@lab.local", "admin:lab-admin@lab.local"]);
    const opens = calls.filter((c) => c.path === "/api/cash/session/open");
    expect(opens).toEqual([expect.objectContaining({ client: "vendedor2", body: { registerId: "reg-2", openingVes: 0, openingRef: 0 } })]);
    expect(calls.some((c) => c.path === "/api/cash/session/close")).toBe(false);
    expect(ctx.state).toMatchObject({ customerId: "c-final", exchangeRateId: "rate-9", refRateVes: 52, supplierId: "supp-new" });
    expect(calls.filter((c) => c.path.startsWith("/api/products?")).map((c) => c.client)).toEqual(["admin"]);
    expect(ctx.catalog.map((p) => [p.sku, p.isHot])).toEqual([["lab-001", false], ["lab-hot-01", true]]);
  });

  it("markHotProducts reconoce el prefijo hot con SKU en minúsculas", () => {
    const catalog = [product({ id: "a", sku: "lab-hot-03" }), product({ id: "b", sku: "lab-pack-01", isHot: true })];
    expect(markHotProducts(catalog).map((p) => p.isHot)).toEqual([true, false]);
  });

  it("chaos_double_sale: 2 eventos; mismo id → el segundo lleva {} y duplicate_of", async () => {
    const ctx = makeCtx(5, { v1: saleRoutes("same") });
    await chaos_double_sale(ctx);
    const events = readEvents(ctx.logger.filePath);
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.op)).toEqual(["chaos_double_sale", "chaos_double_sale"]);
    const first = events[0];
    const second = events[1];
    const items = (first?.payload as { items: { productId: string; quantity: number }[] }).items;
    expect(items).toHaveLength(1);
    const line = items[0];
    expect(first?.expected_delta).toEqual({ [line?.productId ?? ""]: -(line?.quantity ?? 0) });
    expect(first?.payload).toMatchObject({ case: "9.1", attempt: 1, payments: [{ method: "efectivo_usd", currency: "USD" }] });
    expect(second).toMatchObject({ status: 201, response_id: "sale-1", expected_delta: {} });
    expect(second?.payload).toMatchObject({ case: "9.1", attempt: 2, duplicate_of: "sale-1" });
    const sales = calls.filter((c) => c.path === "/api/sales");
    expect(sales).toHaveLength(2);
    expect(sales[0]?.body).toEqual(sales[1]?.body);
    expect(typeof sales[0]?.body?.clientRequestId).toBe("string");
  });

  it("chaos_double_sale: ids distintos → ambos eventos con delta (bug a detectar)", async () => {
    const ctx = makeCtx(5, { v1: saleRoutes("distinct") });
    await chaos_double_sale(ctx);
    const events = readEvents(ctx.logger.filePath);
    expect(events.map((e) => e.response_id)).toEqual(["sale-1", "sale-2"]);
    expect(Object.keys(events[0]?.expected_delta ?? {})).toHaveLength(1);
    expect(events[1]?.expected_delta).toEqual(events[0]?.expected_delta);
    expect(events[1]?.payload).not.toHaveProperty("duplicate_of");
  });

  it("chaos_retry_same_key: reenvío con el mismo clientRequestId y duplicate_of si repite id", async () => {
    const ctx = makeCtx(8, { v1: saleRoutes("same") });
    await chaos_retry_same_key(ctx);
    const events = readEvents(ctx.logger.filePath);
    expect(events).toHaveLength(2);
    expect(events[1]?.payload).toMatchObject({ case: "retry_same_key", duplicate_of: "sale-1" });
    expect(events[1]?.expected_delta).toEqual({});
    const sales = calls.filter((c) => c.path === "/api/sales");
    expect(sales[0]?.body?.clientRequestId).toBe(sales[1]?.body?.clientRequestId);
  });

  it("chaos_forbidden_adjust: vendedor1 recibe 403 → {} con error", async () => {
    const ctx = makeCtx(2, { v1: { "POST /api/inventory/adjustments": () => errorResponse(403, "FORBIDDEN", "No tienes permiso") } });
    await chaos_forbidden_adjust(ctx);
    const events = readEvents(ctx.logger.filePath);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ op: "chaos_forbidden_adjust", status: 403, expected_delta: {}, response_id: null });
    expect(events[0]?.error).toContain("FORBIDDEN");
    expect(events[0]?.payload).toMatchObject({ case: "9.9", actor: "vendedor1", type: "ajuste_entrada" });
    expect(calls[0]?.client).toBe("vendedor1");
  });

  it("chaos_over_adjust: admin pide −(stock+10) y el 400 deja {}", async () => {
    const ctx = makeCtx(2, { admin: { "POST /api/inventory/adjustments": () => errorResponse(400, "BAD_REQUEST", "stock insuficiente") } });
    await chaos_over_adjust(ctx);
    const events = readEvents(ctx.logger.filePath);
    const body = calls[0]?.body;
    const target = ctx.catalog.find((p) => p.id === body?.productId);
    expect(calls[0]?.client).toBe("admin");
    expect(body?.quantityDelta).toBe(-((target?.currentStock ?? 0) + 10));
    expect(events[0]).toMatchObject({ op: "chaos_over_adjust", status: 400, expected_delta: {} });
    expect(events[0]?.payload).toMatchObject({ case: "9.5", type: "ajuste_salida" });
  });

  it("chaos_double_receive: purchase_create pedido {} y luego 200/400 → delta solo en el primero", async () => {
    let receives = 0;
    const ctx = makeCtx(13, {
      admin: {
        "POST /api/purchases": () => okResponse({ id: "purch-7", status: "pedido" }),
        "PATCH /api/purchases/purch-7/receive": () => {
          receives += 1;
          return receives === 1 ? okResponse({ id: "purch-7", status: "recibido" }, 200) : errorResponse(400, "BAD_REQUEST", "estado inválido");
        },
      },
    });
    await chaos_double_receive(ctx);
    const events = readEvents(ctx.logger.filePath);
    expect(events.map((e) => e.op)).toEqual(["purchase_create", "chaos_double_receive", "chaos_double_receive"]);
    expect(events[0]).toMatchObject({ status: 201, response_id: "purch-7", expected_delta: {} });
    expect(events[0]?.payload).toMatchObject({ case: "9.2", status: "pedido", supplierId: "supp-1" });
    const items = (events[0]?.payload as { items: { productId: string; quantity: number }[] }).items;
    const expected = Object.fromEntries(items.map((i) => [i.productId, i.quantity]));
    expect(events[1]).toMatchObject({ status: 200, response_id: "purch-7", expected_delta: expected });
    expect(events[2]).toMatchObject({ status: 400, expected_delta: {} });
    expect(events[2]?.payload).toMatchObject({ purchaseId: "purch-7", attempt: 2 });
    expect(calls.every((c) => c.client === "admin")).toBe(true);
    for (const [productId, quantity] of Object.entries(expected)) {
      expect(ctx.catalog.find((p) => p.id === productId)?.currentStock).toBe(500 + quantity);
    }
  });

  it("chaos_race_stock: vendedor1 y vendedor2 venden s en paralelo; delta −s solo en los 2xx", async () => {
    const ctx = makeCtx(4, { v1: saleRoutes("distinct"), v2: saleRoutes("reject") });
    await chaos_race_stock(ctx);
    const events = readEvents(ctx.logger.filePath);
    expect(events.map((e) => e.op)).toEqual(["chaos_race_stock", "chaos_race_stock"]);
    const body = calls.find((c) => c.client === "vendedor1")?.body as { items: { productId: string; quantity: number }[] };
    const line = body.items[0];
    const sold = ctx.catalog.find((p) => p.id === line?.productId);
    expect(sold?.isHot).toBe(false);
    expect(line?.quantity).toBeGreaterThanOrEqual(2);
    expect(events[0]?.expected_delta).toEqual({ [line?.productId ?? ""]: -(line?.quantity ?? 0) });
    expect(events[1]).toMatchObject({ status: 400, expected_delta: {} });
    expect(events[1]?.payload).toMatchObject({ actor: "vendedor2", case: "9.3" });
    expect(sold?.currentStock).toBe(0);
    expect(calls.map((c) => c.client).sort()).toEqual(["vendedor1", "vendedor2"]);
  });

  it("chaos_cancel_vs_return: venta sin pagos + cancel/return en paralelo; +q solo en el 2xx", async () => {
    const ctx = makeCtx(6, {
      v1: {
        // Las rutas específicas van antes que el prefijo genérico "POST /api/sales".
        "PATCH /api/sales/sale-1/cancel": () => okResponse({ id: "sale-1", status: "cancelada" }, 200),
        "POST /api/sales/sale-1/return": () => errorResponse(400, "BAD_REQUEST", "ya cancelada"),
        ...saleRoutes("distinct"),
      },
    });
    await chaos_cancel_vs_return(ctx);
    const events = readEvents(ctx.logger.filePath);
    expect(events.map((e) => e.op)).toEqual(["sale_create", "chaos_cancel_vs_return", "chaos_cancel_vs_return"]);
    const saleBody = calls[0]?.body;
    expect(saleBody).not.toHaveProperty("payments");
    const quantity = (saleBody?.items as { productId: string; quantity: number }[])[0];
    expect(events[0]?.expected_delta).toEqual({ [quantity?.productId ?? ""]: -(quantity?.quantity ?? 0) });
    expect(events[1]).toMatchObject({ status: 200, expected_delta: { [quantity?.productId ?? ""]: quantity?.quantity } });
    expect(events[1]?.payload).toMatchObject({ action: "cancel", saleId: "sale-1", case: "9.4" });
    expect(events[2]).toMatchObject({ status: 400, expected_delta: {} });
    expect(events[2]?.payload).toMatchObject({ action: "return" });
  });

  it("chaos_sell_inactive y chaos_over_stock_sale: el rechazo deja {}", async () => {
    const ctx = makeCtx(3, {
      v1: { "POST /api/sales": () => errorResponse(404, "NOT_FOUND", "producto inactivo") },
    });
    await chaos_sell_inactive(ctx);
    await chaos_over_stock_sale(ctx);
    const events = readEvents(ctx.logger.filePath);
    expect(events.map((e) => e.op)).toEqual(["chaos_sell_inactive", "chaos_over_stock_sale"]);
    expect(events[0]).toMatchObject({ status: 404, expected_delta: {} });
    expect((calls[0]?.body?.items as { productId: string }[])[0]?.productId).toBe("inact-1");
    const over = (calls[1]?.body?.items as { productId: string; quantity: number }[])[0];
    const target = ctx.catalog.find((p) => p.id === over?.productId);
    expect(over?.quantity).toBe((target?.currentStock ?? 0) + 5);
    expect(events[1]).toMatchObject({ status: 404, expected_delta: {} });
  });

  it("chaos_big_sale_reverse: 20 líneas A→Z (vendedor1) y Z→A (vendedor2); −1 por producto en cada 2xx", async () => {
    const ctx = makeCtx(17, { v1: saleRoutes("distinct"), v2: saleRoutes("distinct") });
    await chaos_big_sale_reverse(ctx);
    const events = readEvents(ctx.logger.filePath);
    expect(events.map((e) => e.op)).toEqual(["chaos_big_sale_reverse", "chaos_big_sale_reverse"]);
    const v1 = calls.find((c) => c.client === "vendedor1")?.body?.items as { productId: string; quantity: number }[];
    const v2 = calls.find((c) => c.client === "vendedor2")?.body?.items as { productId: string; quantity: number }[];
    expect(v1).toHaveLength(20);
    expect(v2.map((i) => i.productId)).toEqual([...v1.map((i) => i.productId)].reverse());
    const skus = v1.map((i) => ctx.catalog.find((p) => p.id === i.productId)?.sku ?? "");
    expect(skus).toEqual([...skus].sort());
    expect(new Set(v1.map((i) => i.productId)).size).toBe(20);
    expect(events[0]?.expected_delta).toEqual(Object.fromEntries(v1.map((i) => [i.productId, -1])));
    expect(events[1]?.expected_delta).toEqual(events[0]?.expected_delta);
    expect(events[1]?.payload).toMatchObject({ case: "9.10", actor: "vendedor2", order: "desc" });
  });
});
