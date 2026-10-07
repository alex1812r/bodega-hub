import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ApiClient, ApiResponse, JsonRecord } from "../../e2e-bodegon/client";
import type { AgentContext } from "./base";
import { compradorState, mapSupplierCatalogItem, setup, step, teardown } from "./comprador";
import { EventLogger, readEvents, type LabEvent } from "./logger";
import { createRng } from "./rng";

type MockClient = jest.Mocked<Pick<ApiClient, "request" | "login">>;

type HarnessOptions = {
  seed?: number;
  /** Respuesta de la segunda recepción (y siguientes) de una misma compra. */
  repeatedReceiveStatus?: number;
  supplierCatalog?: JsonRecord[];
  /** Respuesta de `GET /api/inventory/pack-conversions`. */
  packConversions?: JsonRecord[];
};

function json(status: number, body: JsonRecord | null): ApiResponse {
  return { ok: status >= 200 && status <= 299, status, body };
}

function catalogItems(): JsonRecord[] {
  const items: JsonRecord[] = [];
  for (let i = 1; i <= 8; i += 1) {
    items.push({ id: `prod-${i}`, sku: `LAB-00${i}`, name: `Prod ${i}`, isActive: true, currentStock: 40, salePriceRef: 2 });
  }
  items.push({ id: "inact-1", sku: "LAB-INACT-01", name: "Inactivo", isActive: false, currentStock: 10, salePriceRef: 1 });
  return items;
}

function defaultSupplierCatalog(): JsonRecord[] {
  return [
    {
      id: "sp-1",
      productId: "prod-1",
      supplierSku: "P1",
      product: { id: "prod-1", taxRate: 16 },
      packUnits: [{ id: "pu-1", label: "Bulto x12", unitsPerPack: 12, isDefault: true, isActive: true }],
    },
    { id: "sp-2", productId: "prod-2", product: { id: "prod-2", taxRate: 0 }, packUnits: [] },
    { id: "sp-3", productId: "prod-3", isActive: false },
  ];
}

function createHarness(dir: string, options: HarnessOptions = {}) {
  let purchaseCounter = 0;
  const received = new Set<string>();
  const calls: Array<{ method: string; path: string }> = [];

  const client: MockClient = {
    login: jest.fn<Promise<ApiResponse>, [email: string, password: string]>(async () => json(200, { data: { role: "admin", user: { id: "user-admin" } } })),
    request: jest.fn(async (path: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ method, path });
      const body = typeof init?.body === "string" ? (JSON.parse(init.body) as JsonRecord) : {};
      if (path.startsWith("/api/products")) {
        const items = catalogItems();
        return json(200, { data: { items, total: items.length, limit: 100, skip: 0 } });
      }
      if (path === "/api/inventory/pack-conversions") {
        return json(200, { data: { items: options.packConversions ?? [] } });
      }
      if (path.startsWith("/api/contacts")) {
        return json(200, {
          data: {
            items: [
              { id: "sup-1", name: "Proveedor 1", type: "proveedor" },
              { id: "sup-2", name: "Proveedor 2", type: "proveedor" },
            ],
          },
        });
      }
      if (path.startsWith("/api/suppliers/sup-1/products")) {
        return json(200, { data: { items: options.supplierCatalog ?? defaultSupplierCatalog() } });
      }
      if (path.startsWith("/api/suppliers/sup-2/products")) {
        return json(200, { data: { items: [] } });
      }
      if (path === "/api/exchange-rates/current") {
        return json(200, { data: { id: "rate-1", rateVes: 50 } });
      }
      if (path === "/api/purchases" && method === "POST") {
        purchaseCounter += 1;
        const totalVes = Number(body.subtotalVes) + Number(body.taxVes);
        return json(201, { data: { id: `pur-${purchaseCounter}`, status: body.status, totalVes } });
      }
      const receive = /^\/api\/purchases\/([^/]+)\/receive$/.exec(path);
      if (receive) {
        const id = receive[1] ?? "";
        if (received.has(id)) {
          const status = options.repeatedReceiveStatus ?? 400;
          return json(status, { error: { code: "BAD_REQUEST", message: "La compra ya fue recibida" } });
        }
        received.add(id);
        return json(200, { data: { id, status: "recibido" } });
      }
      if (/^\/api\/purchases\/[^/]+\/cancel$/.test(path)) {
        return json(200, { data: { id: path.split("/")[3], status: "cancelada" } });
      }
      if (/^\/api\/purchases\/[^/]+\/return$/.test(path)) {
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
    logger: new EventLogger("run-test", "comprador", dir),
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

type PurchaseItemPayload = {
  entryMode: "unit" | "pack";
  productId: string;
  quantity?: number;
  packCount?: number;
  unitsPerPack?: number;
  packLabel?: string;
  taxRate: number;
  subtotalRef: number;
  subtotalVes: number;
  taxRef: number;
  taxVes: number;
  supplierSku?: string;
};

function purchaseItems(event: LabEvent): PurchaseItemPayload[] {
  return (event.payload as JsonRecord).items as PurchaseItemPayload[];
}

describe("comprador agent", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "stock-lab-comprador-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("mapea el catálogo del proveedor con empaque por defecto e IVA", () => {
    const [withPack, noPack, inactive] = defaultSupplierCatalog();
    expect(mapSupplierCatalogItem(withPack)).toEqual({
      productId: "prod-1",
      supplierSku: "P1",
      taxRate: 16,
      packLabel: "Bulto x12",
      unitsPerPack: 12,
    });
    expect(mapSupplierCatalogItem(noPack)).toEqual({
      productId: "prod-2",
      supplierSku: null,
      taxRate: 0,
      packLabel: null,
      unitsPerPack: null,
    });
    expect(mapSupplierCatalogItem(inactive)).toBeNull();
    expect(mapSupplierCatalogItem(null)).toBeNull();
  });

  it("hace login como admin y carga proveedores, catálogo de proveedor y tasa", async () => {
    const harness = createHarness(join(dir, "setup"));
    await setup(harness.ctx);
    expect(harness.client.login).toHaveBeenCalledWith("lab-admin@lab.local", "Lab2026!");
    const state = compradorState(harness.ctx);
    expect(state.rateVes).toBe(50);
    expect(state.exchangeRateId).toBe("rate-1");
    expect(state.suppliers.map((supplier) => supplier.id)).toEqual(["sup-1", "sup-2"]);
    expect(state.suppliers[0]?.items.map((item) => item.productId)).toEqual(["prod-1", "prod-2"]);
    expect(state.suppliers[1]?.items).toEqual([]);
    expect(harness.ctx.catalog).toHaveLength(9);
    expect(events(harness.ctx)).toEqual([]);
    await expect(teardown(harness.ctx)).resolves.toBeUndefined();
    expect(events(harness.ctx)).toEqual([]);
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
    expect(firstEvents.length).toBeGreaterThanOrEqual(20);
    expect(project(firstEvents)).toEqual(project(events(second.ctx)));
    expect(first.calls).toEqual(second.calls);
  });

  it("compra pedido → {} y recibido en modo pack → +packCount×unitsPerPack", async () => {
    const harness = createHarness(join(dir, "create"), { seed: 2 });
    await setup(harness.ctx);
    await runSteps(harness.ctx, 60);
    const purchases = events(harness.ctx).filter((event) => event.op === "purchase_create");
    const pending = purchases.filter((event) => (event.payload as JsonRecord).status === "pedido");
    const receivedPack = purchases.filter(
      (event) =>
        (event.payload as JsonRecord).status === "recibido" &&
        purchaseItems(event).some((item) => item.entryMode === "pack"),
    );
    expect(pending.length).toBeGreaterThan(0);
    expect(receivedPack.length).toBeGreaterThan(0);
    for (const event of pending) {
      expect(event.status).toBe(201);
      expect(event.expected_delta).toEqual({});
    }
    for (const event of receivedPack) {
      expect(event.status).toBe(201);
      for (const item of purchaseItems(event)) {
        const units = item.entryMode === "pack" ? (item.packCount ?? 0) * (item.unitsPerPack ?? 0) : (item.quantity ?? 0);
        expect(event.expected_delta[item.productId]).toBe(units);
        if (item.entryMode === "pack") {
          expect(item.packCount).toBeGreaterThanOrEqual(1);
          expect(item.packCount).toBeLessThanOrEqual(5);
          expect([6, 12, 24]).toContain(item.unitsPerPack);
          expect(typeof item.packLabel).toBe("string");
        } else {
          expect(item.quantity).toBeGreaterThanOrEqual(5);
          expect(item.quantity).toBeLessThanOrEqual(50);
        }
        expect(item.subtotalVes).toBeCloseTo(item.subtotalRef * 50, 1);
        expect(item.taxRef).toBeCloseTo((item.subtotalRef * item.taxRate) / 100, 1);
        if ((event.payload as JsonRecord).supplierId === "sup-1" && item.productId === "prod-1") {
          expect(item.taxRate).toBe(16);
          expect(item.supplierSku).toBe("P1");
          if (item.entryMode === "pack") expect(item.unitsPerPack).toBe(12);
        }
      }
    }
    for (const event of purchases) {
      const payload = event.payload as JsonRecord;
      expect(payload.refRateVes).toBe(50);
      expect(payload.exchangeRateId).toBe("rate-1");
      const items = purchaseItems(event);
      expect(payload.subtotalRef).toBeCloseTo(items.reduce((sum, item) => sum + item.subtotalRef, 0), 2);
      expect(payload.taxVes).toBeCloseTo(items.reduce((sum, item) => sum + item.taxVes, 0), 2);
      expect(items.every((item) => (item as JsonRecord).costCurrency === "ref")).toBe(true);
    }
  });

  // STK-519 / F3a: evidencia en .notes/stock-integrity-gtm/qa/STK-513/verdict.md (4 SKU LAB-PACK-* «DESCUADRE»
  // y 40 × 400 «Las unidades por empaque enviadas (N) no coinciden…»). prod-1 es el EMPAQUE y prod-2 la UNIDAD
  // de un par x12 (parche 20261006f, create_purchase, bloque C13).
  it("STK-519: en un par, modo empaque sobre el EMPAQUE espera +packCount y sobre la UNIDAD +packCount×upp del par, enviando siempre el upp del par", async () => {
    const harness = createHarness(join(dir, "pair"), {
      seed: 5,
      packConversions: [{ id: "conv-1", packProduct: { id: "prod-1" }, unitProduct: { id: "prod-2" }, unitsPerPack: 12, isActive: true }],
      supplierCatalog: [
        // El empaque por defecto del proveedor (x24 / x6) NO coincide con el par (x12): manda el par.
        { id: "sp-1", productId: "prod-1", product: { id: "prod-1", taxRate: 0 }, packUnits: [{ id: "pu-1", label: "Bulto x24", unitsPerPack: 24, isDefault: true, isActive: true }] },
        { id: "sp-2", productId: "prod-2", product: { id: "prod-2", taxRate: 0 }, packUnits: [{ id: "pu-2", label: "Bulto x6", unitsPerPack: 6, isDefault: true, isActive: true }] },
      ],
    });
    await setup(harness.ctx);
    await runSteps(harness.ctx, 200);
    const all = events(harness.ctx);
    const state = compradorState(harness.ctx);
    const packLines = { "prod-1": 0, "prod-2": 0 };
    for (const event of all.filter((e) => e.op === "purchase_create" && (e.payload as JsonRecord).supplierId === "sup-1")) {
      const expected: Record<string, number> = {};
      for (const item of purchaseItems(event)) {
        let units = item.quantity ?? 0;
        if (item.entryMode === "pack") {
          expect(item.unitsPerPack).toBe(12);
          packLines[item.productId as "prod-1" | "prod-2"] += 1;
          units = item.productId === "prod-1" ? (item.packCount ?? 0) : (item.packCount ?? 0) * 12;
        }
        expected[item.productId] = (expected[item.productId] ?? 0) + units;
      }
      expect(event.expected_delta).toEqual((event.payload as JsonRecord).status === "recibido" ? expected : {});
    }
    expect(packLines["prod-1"]).toBeGreaterThan(0);
    expect(packLines["prod-2"]).toBeGreaterThan(0);

    // Recibir / devolver usan la misma regla (la línea del empaque se guarda como packCount unidades de stock).
    const packOnly = state.purchases.filter((p) => p.items.length === 1 && p.items[0]?.productId === "prod-1" && p.items[0]?.packCount !== undefined);
    expect(packOnly.length).toBeGreaterThan(0);
    let moved = 0;
    for (const purchase of packOnly) {
      const moves = all.filter(
        (e) => ["purchase_receive", "purchase_return"].includes(e.op) && e.status === 200 && (e.payload as JsonRecord).purchaseId === purchase.id,
      );
      for (const event of moves) {
        moved += 1;
        expect(Math.abs(event.expected_delta["prod-1"] ?? 0)).toBe(purchase.items[0]?.packCount);
      }
    }
    expect(moved).toBeGreaterThan(0);
  });

  it("recibe pedidos propios, a veces dos veces seguidas (2 eventos, el segundo 400 con {})", async () => {
    const harness = createHarness(join(dir, "receive"), { seed: 9 });
    await setup(harness.ctx);
    await runSteps(harness.ctx, 120);
    const all = events(harness.ctx);
    const receives = all.filter((event) => event.op === "purchase_receive");
    expect(receives.length).toBeGreaterThan(0);
    const okReceives = receives.filter((event) => event.status === 200);
    const dupReceives = receives.filter((event) => event.status === 400);
    expect(dupReceives.length).toBeGreaterThan(0);
    for (const event of okReceives) {
      expect(Object.values(event.expected_delta).every((delta) => delta > 0)).toBe(true);
    }
    for (const event of dupReceives) {
      expect(event.expected_delta).toEqual({});
      expect(event.error).toBe("BAD_REQUEST La compra ya fue recibida");
    }
    const duplicatedIds = new Set(dupReceives.map((event) => (event.payload as JsonRecord).purchaseId));
    for (const id of duplicatedIds) {
      const sequence = receives.filter((event) => (event.payload as JsonRecord).purchaseId === id);
      expect(sequence).toHaveLength(2);
      expect(sequence[0]?.status).toBe(200);
      expect(sequence[1]?.status).toBe(400);
    }
    const ops = new Set(all.map((event) => event.op));
    expect(ops).toEqual(new Set(["purchase_create", "purchase_receive", "purchase_cancel", "purchase_return", "payment_create"]));
    for (const event of all) {
      if (event.op === "purchase_return") {
        expect(Object.values(event.expected_delta).every((delta) => delta < 0)).toBe(true);
      }
      if (event.op === "payment_create") {
        expect(event.expected_delta).toEqual({});
        expect((event.payload as JsonRecord).method).toBe("transferencia");
      }
    }
    const receivedIds = new Set(okReceives.map((event) => (event.payload as JsonRecord).purchaseId));
    for (const purchase of compradorState(harness.ctx).purchases) {
      if (receivedIds.has(purchase.id)) {
        expect(purchase.status).not.toBe("pedido");
      }
    }
  });
});
