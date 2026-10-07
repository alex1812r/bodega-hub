import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ApiClient, type ApiResponse } from "../../e2e-bodegon/client";
import { CATALOG_REFRESH_EVERY, applyDeltaToCatalog, markHotProducts, pickOp, setup, step } from "./almacen";
import type { AgentContext, LabProduct } from "./base";
import { EventLogger, readEvents } from "./logger";
import { createRng } from "./rng";

type RequestFn = (path: string, init?: RequestInit) => Promise<ApiResponse>;
type Call = { method: string; path: string; body: Record<string, unknown> | null };

const STATUS_RESPONSES: Record<number, ApiResponse> = {
  400: { ok: false, status: 400, body: { error: { code: "BAD_REQUEST", message: "stock insuficiente" } } },
  404: { ok: false, status: 404, body: { error: { code: "NOT_FOUND", message: "no existe" } } },
};

function okResponse(data: Record<string, unknown>, status = 201): ApiResponse {
  return { ok: true, status, body: { data } };
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

/** Catálogo con un hot, dos fríos, un pack (upp 12) con su unidad y un inactivo. */
function sampleCatalog(): LabProduct[] {
  return [
    product({ id: "hot-1", sku: "lab-hot-01", isHot: true, currentStock: 500 }),
    product({ id: "cold-1", sku: "LAB-001", currentStock: 40 }),
    product({ id: "cold-2", sku: "LAB-002", currentStock: 0 }),
    product({ id: "pack-1", sku: "LAB-PACK-01", currentStock: 5, packUnitsPerPack: 12, packUnitProductId: "unit-1" }),
    product({ id: "unit-1", sku: "LAB-UNIT-01", currentStock: 30 }),
    product({ id: "inact-1", sku: "LAB-INACT-01", isActive: false }),
  ];
}

/**
 * Cliente con `request` mockeado. `routes` decide la respuesta por
 * `"METHOD /path"` (prefijo); si no hay ruta devuelve 200 vacío. Guarda las
 * llamadas en `calls`.
 */
function mockClient(routes: Record<string, (call: Call, index: number) => ApiResponse>) {
  const calls: Call[] = [];
  const request = jest.fn<Promise<ApiResponse>, Parameters<RequestFn>>(async (path, init) => {
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    const call: Call = { method, path, body };
    calls.push(call);
    const key = Object.keys(routes).find((route) => `${method} ${path}`.startsWith(route));
    const handler = key ? routes[key] : undefined;
    return handler ? handler(call, calls.length - 1) : okResponse({}, 200);
  });
  const client = Object.assign(new ApiClient("http://localhost:3100"), { request });
  return { client, request, calls };
}

function catalogRoutes(catalog: LabProduct[]) {
  return {
    "POST /api/auth/login": () => okResponse({ role: "almacen", user: { id: "u-almacen" } }, 200),
    "GET /api/products": () =>
      okResponse(
        {
          items: catalog.map((p) => ({ id: p.id, sku: p.sku, name: p.name, isActive: p.isActive, currentStock: p.currentStock, salePriceRef: p.salePrice })),
          total: catalog.length,
          limit: 100,
          skip: 0,
        },
        200,
      ),
    "GET /api/inventory/pack-conversions": () =>
      okResponse(
        catalog
          .filter((p) => p.packUnitsPerPack !== null)
          .map((p) => ({ id: `pc-${p.id}`, unitsPerPack: p.packUnitsPerPack, packProduct: { id: p.id }, unitProduct: { id: p.packUnitProductId } })) as unknown as Record<string, unknown>,
        200,
      ),
    "GET /api/categories": () => okResponse({ items: [{ id: "cat-1", name: "Lab" }], total: 1, limit: 20, skip: 0 }, 200),
  };
}

describe("almacen agent", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "stock-lab-almacen-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function makeCtx(client: ApiClient, seed: number, catalog: LabProduct[] = []): AgentContext {
    return {
      client,
      logger: new EventLogger("run-almacen", "almacen", dir),
      rng: createRng(seed),
      catalog,
      state: { seed, categoryIds: ["cat-1"], opsSinceRefresh: 0, createdCount: 0 },
    };
  }

  it("pickOp es determinista por semilla y cubre las cinco operaciones", () => {
    const rngA = createRng(7);
    const rngB = createRng(7);
    const seqA = Array.from({ length: 200 }, () => pickOp(rngA));
    const seqB = Array.from({ length: 200 }, () => pickOp(rngB));
    expect(seqA).toEqual(seqB);
    expect(new Set(seqA)).toEqual(
      new Set(["adjustment", "conversion", "product_create", "product_deactivate", "product_reactivate"]),
    );
  });

  it("setup: login como almacen, catálogo (con packs) y categorías", async () => {
    const catalog = sampleCatalog();
    const { client, calls } = mockClient(catalogRoutes(catalog));
    const ctx: AgentContext = {
      client,
      logger: new EventLogger("run-almacen", "almacen", dir),
      rng: createRng(1),
      catalog: [],
      state: { seed: 1 },
    };
    await setup(ctx);
    expect(calls[0]).toMatchObject({ method: "POST", path: "/api/auth/login", body: { email: "lab-almacen@lab.local" } });
    expect(ctx.catalog).toHaveLength(6);
    expect(ctx.catalog.find((p) => p.id === "pack-1")).toMatchObject({ packUnitsPerPack: 12, packUnitProductId: "unit-1" });
    expect(ctx.catalog.filter((p) => p.isHot).map((p) => p.sku)).toEqual(["lab-hot-01"]);
    expect(ctx.state).toMatchObject({ seed: 1, categoryIds: ["cat-1"], opsSinceRefresh: 0, createdCount: 0 });
    expect(calls.some((c) => c.path === "/api/categories?limit=20")).toBe(true);
  });

  it("la secuencia de ops con la misma semilla es idéntica entre dos runs", async () => {
    async function run(runId: string): Promise<string[]> {
      const { client } = mockClient({
        "POST /api/inventory/adjustments": (call) => okResponse({ id: `adj-${String(call.body?.quantityDelta)}` }),
        "POST /api/inventory/conversions": () => okResponse({ id: "conv-1" }),
        "POST /api/products": (call) => okResponse({ id: `new-${String(call.body?.sku)}` }),
        "DELETE /api/products/": () => okResponse({}, 200),
        "PATCH /api/products/": () => okResponse({}, 200),
      });
      const ctx = makeCtx(client, 42, sampleCatalog());
      ctx.logger = new EventLogger(runId, "almacen", dir);
      for (let i = 0; i < 20; i += 1) {
        await step(ctx);
      }
      return readEvents(ctx.logger.filePath).map((e) => `${e.op}:${JSON.stringify(e.payload)}`);
    }
    const first = await run("det-a");
    const second = await run("det-b");
    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThanOrEqual(20);
  });

  it("ajuste 201 → delta con signo y catálogo local actualizado; 400 → {} con error", async () => {
    let next: ApiResponse = okResponse({ id: "adj-1" });
    const { client, calls } = mockClient({ "POST /api/inventory/adjustments": () => next });
    const catalog = [product({ id: "cold-1", sku: "LAB-001", currentStock: 40 })];
    // Con un solo producto (sin packs, nada inactivo) toda op que no sea
    // product_create cae en ajuste; iteramos hasta ver el primero.
    const ctx = makeCtx(client, 3, catalog);
    let events = readEvents(ctx.logger.filePath);
    while (!events.some((e) => e.op === "adjustment")) {
      await step(ctx);
      events = readEvents(ctx.logger.filePath);
    }
    const adjustment = events.find((e) => e.op === "adjustment");
    const call = calls.find((c) => c.path === "/api/inventory/adjustments");
    expect(adjustment).toBeDefined();
    expect(call).toBeDefined();
    const delta = Number(call?.body?.quantityDelta);
    expect(adjustment?.status).toBe(201);
    expect(adjustment?.response_id).toBe("adj-1");
    expect(adjustment?.expected_delta).toEqual({ "cold-1": delta });
    expect(ctx.catalog[0]?.currentStock).toBe(40 + delta);

    next = STATUS_RESPONSES[400] as ApiResponse;
    const stockBefore = ctx.catalog[0]?.currentStock;
    while (!readEvents(ctx.logger.filePath).some((e) => e.status === 400)) {
      await step(ctx);
    }
    const failed = readEvents(ctx.logger.filePath).find((e) => e.status === 400);
    expect(failed).toMatchObject({ op: "adjustment", status: 400, expected_delta: {}, response_id: null });
    expect(failed?.error).toContain("stock insuficiente");
    expect(ctx.catalog[0]?.currentStock).toBe(stockBefore);
  });

  it("conversión 201 → { pack: -q, unit: +q×upp }", async () => {
    const { client, calls } = mockClient({
      "POST /api/inventory/conversions": () => okResponse({ conversionId: "conv-1", id: "conv-1" }),
      "POST /api/inventory/adjustments": () => okResponse({ id: "adj-x" }),
      "POST /api/products": () => okResponse({ id: "new-x" }),
      "DELETE /api/products/": () => okResponse({}, 200),
      "PATCH /api/products/": () => okResponse({}, 200),
    });
    const catalog = [
      product({ id: "pack-1", sku: "LAB-PACK-01", currentStock: 50, packUnitsPerPack: 12, packUnitProductId: "unit-1" }),
      product({ id: "unit-1", sku: "LAB-UNIT-01", currentStock: 30 }),
    ];
    const ctx = makeCtx(client, 11, catalog);
    let events = readEvents(ctx.logger.filePath);
    while (!events.some((e) => e.op === "conversion" && e.status === 201)) {
      await step(ctx);
      events = readEvents(ctx.logger.filePath);
    }
    const conversion = events.find((e) => e.op === "conversion" && e.status === 201);
    const call = calls.find((c) => c.path === "/api/inventory/conversions");
    const q = Number(call?.body?.packQuantity);
    expect(q).toBeGreaterThanOrEqual(1);
    expect(call?.body).toMatchObject({ packProductId: "pack-1", reason: expect.any(String) });
    expect(conversion?.expected_delta).toEqual({ "pack-1": -q, "unit-1": q * 12 });
    expect(conversion?.payload).toMatchObject({ packProductId: "pack-1", packQuantity: q, unitProductId: "unit-1", unitsPerPack: 12 });
  });

  it("crear producto 201 + inventario_inicial 201 → segundo evento con delta +n y producto en el catálogo", async () => {
    const { client, calls } = mockClient({
      "POST /api/products": () => okResponse({ id: "new-1" }),
      "POST /api/inventory/adjustments": () => okResponse({ id: "adj-ini" }),
      "POST /api/inventory/conversions": () => okResponse({ id: "conv-1" }),
      "DELETE /api/products/": () => okResponse({}, 200),
      "PATCH /api/products/": () => okResponse({}, 200),
    });
    const ctx = makeCtx(client, 5, sampleCatalog());
    let events = readEvents(ctx.logger.filePath);
    while (!events.some((e) => e.op === "product_create")) {
      await step(ctx);
      events = readEvents(ctx.logger.filePath);
    }
    const index = events.findIndex((e) => e.op === "product_create");
    const created = events[index];
    const initial = events[index + 1];
    expect(created).toMatchObject({ status: 201, response_id: "new-1", expected_delta: {} });
    expect(created?.payload).toMatchObject({ sku: "LAB-NEW-5-1", currentStock: 0, categoryId: "cat-1" });
    expect(initial).toMatchObject({ op: "adjustment", status: 201, response_id: "adj-ini" });
    const n = Number((initial?.payload as Record<string, unknown>).quantityDelta);
    expect(n).toBeGreaterThanOrEqual(10);
    expect(n).toBeLessThanOrEqual(100);
    expect(initial?.payload).toMatchObject({ productId: "new-1", type: "inventario_inicial", reason: "Stock inicial" });
    expect(initial?.expected_delta).toEqual({ "new-1": n });
    expect(ctx.catalog.find((p) => p.id === "new-1")).toMatchObject({ sku: "LAB-NEW-5-1", currentStock: n, isActive: true });
    expect(calls.filter((c) => c.path === "/api/products")).toHaveLength(1);
  });

  it("desactivar (DELETE) y reactivar (PATCH) escriben eventos con delta {} y actualizan isActive", async () => {
    const { client } = mockClient({
      "DELETE /api/products/": () => okResponse({ id: "x" }, 200),
      "PATCH /api/products/": () => okResponse({ id: "y" }, 200),
      "POST /api/inventory/adjustments": () => okResponse({ id: "adj" }),
      "POST /api/inventory/conversions": () => okResponse({ id: "conv" }),
      "POST /api/products": () => okResponse({ id: "new" }),
    });
    const ctx = makeCtx(client, 9, sampleCatalog());
    let events = readEvents(ctx.logger.filePath);
    while (!events.some((e) => e.op === "product_deactivate") || !events.some((e) => e.op === "product_reactivate")) {
      await step(ctx);
      events = readEvents(ctx.logger.filePath);
    }
    const deactivate = events.find((e) => e.op === "product_deactivate");
    const reactivate = events.find((e) => e.op === "product_reactivate");
    expect(deactivate).toMatchObject({ status: 200, expected_delta: {} });
    expect((deactivate?.payload as Record<string, unknown>).productId).not.toBe("hot-1");
    expect(reactivate).toMatchObject({ status: 200, expected_delta: {} });
    expect(reactivate?.payload).toMatchObject({ isActive: true });
  });

  it("refresca el catálogo cada 25 ops", async () => {
    const catalog = sampleCatalog();
    const { client, calls } = mockClient({
      ...catalogRoutes(catalog),
      "POST /api/inventory/adjustments": () => okResponse({ id: "adj" }),
      "POST /api/inventory/conversions": () => okResponse({ id: "conv" }),
      "POST /api/products": () => okResponse({ id: "new" }),
      "DELETE /api/products/": () => okResponse({}, 200),
      "PATCH /api/products/": () => okResponse({}, 200),
    });
    const ctx = makeCtx(client, 2, sampleCatalog());
    for (let i = 0; i < CATALOG_REFRESH_EVERY + 1; i += 1) {
      await step(ctx);
    }
    const refreshes = calls.filter((c) => c.method === "GET" && c.path.startsWith("/api/products?"));
    expect(refreshes).toHaveLength(1);
  });

  it("markHotProducts reconoce el prefijo hot aunque el API devuelva el SKU en minúsculas", () => {
    const catalog = [product({ id: "a", sku: "lab-hot-01" }), product({ id: "b", sku: "lab-001", isHot: true })];
    expect(markHotProducts(catalog).map((p) => p.isHot)).toEqual([true, false]);
  });

  it("applyDeltaToCatalog suma los deltas a los productos presentes", () => {
    const catalog = [product({ id: "a", sku: "A", currentStock: 10 }), product({ id: "b", sku: "B", currentStock: 3 })];
    applyDeltaToCatalog(catalog, { a: -4, zzz: 9 });
    expect(catalog.map((p) => p.currentStock)).toEqual([6, 3]);
  });
});
