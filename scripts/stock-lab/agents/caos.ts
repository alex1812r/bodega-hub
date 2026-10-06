/**
 * Agente operador "caos" del laboratorio de stock (STK-304): casos de la
 * sección 9 del plan (`docs/agent-prompts/stock-integrity-gtm.md`).
 *
 * Tres clientes: `ctx.client` = vendedor1 (ventas/caja), `ctx.state.vendedor2`
 * (segundo vendedor para carreras) y `ctx.state.admin` (compras, ajustes,
 * catálogo). Cada request HTTP = un evento `chaos_<caso>` con `payload.case`.
 * Nunca cierra sesiones de caja.
 *
 *   npx tsx scripts/stock-lab/agents/caos.ts --run <id> --seed <n> [--minutes <m> | --ops <n>]
 */
import type { ApiClient, ApiResponse, JsonRecord } from "../../e2e-bodegon/client";
import { unwrapList } from "../../e2e-bodegon/client";
import {
  type AgentContext,
  HOT_SKU_PREFIX,
  type LabProduct,
  type LabRoleKey,
  createLabClient,
  describeError,
  fetchCatalog,
  fetchRegisters,
  idempotencyKey,
  loginAs,
  runLoop,
} from "./base";
import { parseAgentArgs } from "./cli";
import { type PurchaseLine, type SaleLine, expectedDelta } from "./expected-delta";
import { EventLogger, isSuccessStatus } from "./logger";
import { type Rng, createRng } from "./rng";

export const CATALOG_REFRESH_EVERY = 25;
export const BIG_SALE_LINES = 20;

export const CHAOS_CASES = [
  "double_sale",
  "double_receive",
  "race_stock",
  "cancel_vs_return",
  "over_adjust",
  "forbidden_adjust",
  "sell_inactive",
  "over_stock_sale",
  "retry_same_key",
  "big_sale_reverse",
] as const;

export type ChaosCase = (typeof CHAOS_CASES)[number];

export type ChaosTiming = {
  /** Separación entre los dos envíos de 9.1 (ms). */
  doubleSaleGapMs: number;
  /** Espera antes del reenvío de `retry_same_key` (ms). */
  retryGapMs: number;
};

export const DEFAULT_TIMING: ChaosTiming = { doubleSaleGapMs: 50, retryGapMs: 1000 };

type ChaosState = {
  vendedor2: ApiClient;
  admin: ApiClient;
  customerId: string;
  exchangeRateId: string;
  refRateVes: number;
  supplierId: string | null;
  timing: ChaosTiming;
  opsSinceRefresh: number;
};

type SalePayment = { method: "efectivo_usd"; currency: "USD"; amount: number };

type SaleBody = {
  clientRequestId: string;
  customerId: string;
  exchangeRateId: string;
  refRateVes: number;
  items: { productId: string; quantity: number; unitPriceRef: number }[];
  taxRef: 0;
  discountRef: 0;
  notes: string;
  payments?: SalePayment[];
};

type Actor = Extract<LabRoleKey, "vendedor1" | "vendedor2" | "admin">;

// ---------------------------------------------------------------------------
// Utilidades locales
// ---------------------------------------------------------------------------

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function responseId(res: ApiResponse): string | null {
  const data = res.body?.data;
  if (!data || typeof data !== "object") return null;
  const id = (data as JsonRecord).id;
  return typeof id === "string" ? id : null;
}

function sendJson(client: ApiClient, method: string, path: string, body?: unknown): Promise<ApiResponse> {
  return client.request(path, body === undefined ? { method } : { method, body: JSON.stringify(body) });
}

/**
 * El API guarda los SKU en minúsculas (`normalizeSku`), así que el `isHot` de
 * `mapLabProduct` (prefijo en mayúsculas) sale siempre false; se recalcula aquí
 * sin distinguir mayúsculas.
 */
export function markHotProducts(catalog: LabProduct[]): LabProduct[] {
  for (const product of catalog) {
    product.isHot = product.sku.toUpperCase().startsWith(HOT_SKU_PREFIX);
  }
  return catalog;
}

async function loadCatalog(client: ApiClient): Promise<LabProduct[]> {
  return markHotProducts(await fetchCatalog(client));
}

function applyDeltaToCatalog(catalog: LabProduct[], delta: Record<string, number>): void {
  for (const product of catalog) {
    const change = delta[product.id];
    if (change !== undefined) {
      product.currentStock += change;
    }
  }
}

/** Escribe el evento del request; `expected_delta` solo si el status es 2xx. */
function logRequest(
  ctx: AgentContext,
  op: string,
  payload: JsonRecord,
  res: ApiResponse,
  deltaIfOk: () => Record<string, number>,
): Record<string, number> {
  const ok = isSuccessStatus(res.status);
  const delta = ok ? deltaIfOk() : {};
  ctx.logger.log({
    op,
    payload,
    status: res.status,
    response_id: responseId(res),
    expected_delta: delta,
    ...(ok ? {} : { error: describeError(res) }),
  });
  if (ok) {
    applyDeltaToCatalog(ctx.catalog, delta);
  }
  return delta;
}

function readState(ctx: AgentContext): ChaosState {
  const state = ctx.state as Partial<ChaosState>;
  if (!state.vendedor2 || !state.admin || typeof state.customerId !== "string" || !state.timing) {
    throw new Error("caos: setup() no se ha ejecutado.");
  }
  return state as ChaosState;
}

function clientFor(ctx: AgentContext, actor: Actor): ApiClient {
  if (actor === "vendedor1") return ctx.client;
  const state = readState(ctx);
  return actor === "vendedor2" ? state.vendedor2 : state.admin;
}

/** Caso elegido con el rng. Exportado para el test de determinismo. */
export function pickCase(rng: Rng): ChaosCase {
  return rng.pick(CHAOS_CASES);
}

function activeProducts(ctx: AgentContext): LabProduct[] {
  return ctx.catalog.filter((p) => p.isActive);
}

function pickHot(ctx: AgentContext): LabProduct {
  const hot = activeProducts(ctx).filter((p) => p.isHot && p.currentStock > 0);
  const pool = hot.length > 0 ? hot : activeProducts(ctx).filter((p) => p.currentStock > 0);
  if (pool.length === 0) {
    throw new Error("caos: no hay productos activos con stock.");
  }
  return ctx.rng.pick(pool);
}

function pickColdWithStock(ctx: AgentContext, minStock: number): LabProduct | null {
  const cold = activeProducts(ctx).filter((p) => !p.isHot && p.currentStock >= minStock);
  return cold.length > 0 ? ctx.rng.pick(cold) : null;
}

function buildSaleBody(
  ctx: AgentContext,
  lines: { product: LabProduct; quantity: number }[],
  withPayments: boolean,
): SaleBody {
  const state = readState(ctx);
  const body: SaleBody = {
    clientRequestId: idempotencyKey(ctx.rng),
    customerId: state.customerId,
    exchangeRateId: state.exchangeRateId,
    refRateVes: state.refRateVes,
    items: lines.map(({ product, quantity }) => ({
      productId: product.id,
      quantity,
      unitPriceRef: product.salePrice,
    })),
    taxRef: 0,
    discountRef: 0,
    notes: "Lab caos",
  };
  const totalRef = round2(lines.reduce((sum, { product, quantity }) => sum + product.salePrice * quantity, 0));
  if (withPayments && totalRef > 0) {
    body.payments = [{ method: "efectivo_usd", currency: "USD", amount: totalRef }];
  }
  return body;
}

function saleLines(body: SaleBody): SaleLine[] {
  return body.items.map((item) => ({ productId: item.productId, quantity: item.quantity }));
}

function postSale(client: ApiClient, body: SaleBody): Promise<ApiResponse> {
  return sendJson(client, "POST", "/api/sales", body);
}

/** Loguea un envío de venta con el delta −q si fue 2xx. */
function logSale(
  ctx: AgentContext,
  op: string,
  body: SaleBody,
  extra: JsonRecord,
  res: ApiResponse,
): string | null {
  logRequest(ctx, op, { ...body, ...extra }, res, () => expectedDelta("sale_create", { items: saleLines(body) }));
  return responseId(res);
}

/**
 * Loguea los dos envíos de un mismo body (9.1 y retry_same_key). Si ambos son
 * 2xx y devuelven el mismo id, el segundo no espera delta (`duplicate_of`); si
 * devuelven ids distintos ambos llevan delta (ese es el bug a detectar).
 */
function logDuplicatePair(
  ctx: AgentContext,
  op: string,
  body: SaleBody,
  extra: JsonRecord,
  first: ApiResponse,
  second: ApiResponse,
): void {
  const firstId = logSale(ctx, op, body, { ...extra, attempt: 1 }, first);
  const secondId = responseId(second);
  const duplicate = isSuccessStatus(first.status) && isSuccessStatus(second.status) && firstId !== null && firstId === secondId;
  if (duplicate) {
    ctx.logger.log({
      op,
      payload: { ...body, ...extra, attempt: 2, duplicate_of: firstId },
      status: second.status,
      response_id: secondId,
      expected_delta: {},
    });
    return;
  }
  logSale(ctx, op, body, { ...extra, attempt: 2 }, second);
}

// ---------------------------------------------------------------------------
// Casos
// ---------------------------------------------------------------------------

/** 9.1: mismo body y clientRequestId dos veces separadas 50 ms. */
export async function chaos_double_sale(ctx: AgentContext): Promise<void> {
  const state = readState(ctx);
  const product = pickHot(ctx);
  const body = buildSaleBody(ctx, [{ product, quantity: ctx.rng.int(1, 3) }], true);
  const [first, second] = await Promise.all([
    postSale(ctx.client, body),
    sleep(state.timing.doubleSaleGapMs).then(() => postSale(ctx.client, body)),
  ]);
  logDuplicatePair(ctx, "chaos_double_sale", body, { case: "9.1", actor: "vendedor1" }, first, second);
}

/** 9.2: compra `pedido` y dos `receive` en paralelo. */
export async function chaos_double_receive(ctx: AgentContext): Promise<void> {
  const state = readState(ctx);
  if (!state.supplierId) {
    throw new Error("caos: no hay proveedor para la compra de 9.2.");
  }
  const products = ctx.rng.shuffle(activeProducts(ctx).filter((p) => p.isHot)).slice(0, ctx.rng.int(1, 2));
  if (products.length === 0) {
    throw new Error("caos: no hay productos hot para la compra de 9.2.");
  }
  const rate = state.refRateVes;
  const items = products.map((product) => {
    const quantity = ctx.rng.int(5, 20);
    const unitCostRef = round2(Math.max(product.salePrice * 0.7, 0.01));
    const subtotalRef = round2(unitCostRef * quantity);
    return {
      entryMode: "unit" as const,
      productId: product.id,
      quantity,
      unitCostRef,
      unitCostVes: round2(unitCostRef * rate),
      costCurrency: "ref" as const,
      taxRate: 0,
      taxRef: 0,
      taxVes: 0,
      subtotalRef,
      subtotalVes: round2(subtotalRef * rate),
    };
  });
  const subtotalRef = round2(items.reduce((sum, item) => sum + item.subtotalRef, 0));
  const body = {
    supplierId: state.supplierId,
    status: "pedido" as const,
    exchangeRateId: state.exchangeRateId,
    refRateVes: rate,
    notes: "Lab caos 9.2",
    subtotalRef,
    subtotalVes: round2(subtotalRef * rate),
    taxRef: 0,
    taxVes: 0,
    discountRef: 0,
    discountVes: 0,
    items,
  };
  const lines: PurchaseLine[] = items.map((item) => ({ productId: item.productId, quantity: item.quantity }));
  const created = await sendJson(state.admin, "POST", "/api/purchases", body);
  logRequest(ctx, "purchase_create", { ...body, case: "9.2", actor: "admin" }, created, () =>
    expectedDelta("purchase_create", { status: "pedido", items: lines }),
  );
  const purchaseId = responseId(created);
  if (!isSuccessStatus(created.status) || !purchaseId) {
    return;
  }
  const receive = () => sendJson(state.admin, "PATCH", `/api/purchases/${purchaseId}/receive`);
  const results = await Promise.all([receive(), receive()]);
  results.forEach((res, index) => {
    logRequest(
      ctx,
      "chaos_double_receive",
      { case: "9.2", actor: "admin", purchaseId, items: lines, attempt: index + 1 },
      res,
      () => expectedDelta("purchase_receive", { items: lines }),
    );
  });
}

/** 9.3: dos vendedores venden todo el stock (s) del mismo producto a la vez. */
export async function chaos_race_stock(ctx: AgentContext): Promise<void> {
  const product = pickColdWithStock(ctx, 2);
  if (!product) {
    throw new Error("caos: no hay producto no-hot con stock ≥ 2 para 9.3.");
  }
  const quantity = product.currentStock;
  const bodyV1 = buildSaleBody(ctx, [{ product, quantity }], true);
  const bodyV2 = buildSaleBody(ctx, [{ product, quantity }], true);
  const [first, second] = await Promise.all([
    postSale(clientFor(ctx, "vendedor1"), bodyV1),
    postSale(clientFor(ctx, "vendedor2"), bodyV2),
  ]);
  logSale(ctx, "chaos_race_stock", bodyV1, { case: "9.3", actor: "vendedor1" }, first);
  logSale(ctx, "chaos_race_stock", bodyV2, { case: "9.3", actor: "vendedor2" }, second);
}

/** 9.4: venta sin pagos y luego cancel + return en paralelo. */
export async function chaos_cancel_vs_return(ctx: AgentContext): Promise<void> {
  const product = pickHot(ctx);
  const body = buildSaleBody(ctx, [{ product, quantity: ctx.rng.int(1, 3) }], false);
  const created = await postSale(ctx.client, body);
  const saleId = logSale(ctx, "sale_create", body, { case: "9.4", actor: "vendedor1" }, created);
  if (!isSuccessStatus(created.status) || !saleId) {
    return;
  }
  const lines = saleLines(body);
  const [cancel, returned] = await Promise.all([
    sendJson(ctx.client, "PATCH", `/api/sales/${saleId}/cancel`),
    sendJson(ctx.client, "POST", `/api/sales/${saleId}/return`),
  ]);
  logRequest(ctx, "chaos_cancel_vs_return", { case: "9.4", actor: "vendedor1", saleId, action: "cancel", items: lines }, cancel, () =>
    expectedDelta("sale_cancel", { items: lines }),
  );
  logRequest(ctx, "chaos_cancel_vs_return", { case: "9.4", actor: "vendedor1", saleId, action: "return", items: lines }, returned, () =>
    expectedDelta("sale_return", { items: lines }),
  );
}

/** 9.5: ajuste de salida mayor que el stock → 400. */
export async function chaos_over_adjust(ctx: AgentContext): Promise<void> {
  const state = readState(ctx);
  const product = ctx.rng.pick(activeProducts(ctx));
  const body = {
    productId: product.id,
    quantityDelta: -(Math.max(product.currentStock, 0) + 10),
    type: "ajuste_salida" as const,
    reason: "Lab caos 9.5: salida mayor al stock",
  };
  const res = await sendJson(state.admin, "POST", "/api/inventory/adjustments", body);
  logRequest(ctx, "chaos_over_adjust", { ...body, case: "9.5", actor: "admin" }, res, () =>
    expectedDelta("adjustment", { productId: body.productId, quantityDelta: body.quantityDelta }),
  );
}

/** 9.9: vendedor llama a ajustes → 403. */
export async function chaos_forbidden_adjust(ctx: AgentContext): Promise<void> {
  const product = ctx.rng.pick(activeProducts(ctx));
  const body = {
    productId: product.id,
    quantityDelta: ctx.rng.int(1, 5),
    type: "ajuste_entrada" as const,
    reason: "Lab caos 9.9: ajuste desde vendedor",
  };
  const res = await sendJson(ctx.client, "POST", "/api/inventory/adjustments", body);
  logRequest(ctx, "chaos_forbidden_adjust", { ...body, case: "9.9", actor: "vendedor1" }, res, () =>
    expectedDelta("adjustment", { productId: body.productId, quantityDelta: body.quantityDelta }),
  );
}

/** Venta de un producto inactivo → 400/404. */
export async function chaos_sell_inactive(ctx: AgentContext): Promise<void> {
  const inactive = ctx.catalog.filter((p) => !p.isActive);
  if (inactive.length === 0) {
    throw new Error("caos: no hay productos inactivos para sell_inactive.");
  }
  const product = ctx.rng.pick(inactive);
  const body = buildSaleBody(ctx, [{ product, quantity: 1 }], true);
  const res = await postSale(ctx.client, body);
  logSale(ctx, "chaos_sell_inactive", body, { case: "sell_inactive", actor: "vendedor1" }, res);
}

/** Venta con cantidad = stock + 5 → 400. */
export async function chaos_over_stock_sale(ctx: AgentContext): Promise<void> {
  const product = pickColdWithStock(ctx, 0) ?? ctx.rng.pick(activeProducts(ctx));
  const body = buildSaleBody(ctx, [{ product, quantity: Math.max(product.currentStock, 0) + 5 }], true);
  const res = await postSale(ctx.client, body);
  logSale(ctx, "chaos_over_stock_sale", body, { case: "over_stock_sale", actor: "vendedor1" }, res);
}

/** Venta normal y reenvío idéntico 1 s después (mismo clientRequestId). */
export async function chaos_retry_same_key(ctx: AgentContext): Promise<void> {
  const state = readState(ctx);
  const product = pickHot(ctx);
  const body = buildSaleBody(ctx, [{ product, quantity: ctx.rng.int(1, 3) }], true);
  const first = await postSale(ctx.client, body);
  await sleep(state.timing.retryGapMs);
  const second = await postSale(ctx.client, body);
  logDuplicatePair(ctx, "chaos_retry_same_key", body, { case: "retry_same_key", actor: "vendedor1" }, first, second);
}

/** 9.10: 20 líneas A→Z por vendedor1 y Z→A por vendedor2, en paralelo. */
export async function chaos_big_sale_reverse(ctx: AgentContext): Promise<void> {
  const state = readState(ctx);
  const pool = activeProducts(ctx).filter((p) => p.currentStock >= 2);
  if (pool.length < 2) {
    throw new Error("caos: hacen falta ≥ 2 productos con stock ≥ 2 para 9.10.");
  }
  const chosen = ctx.rng
    .shuffle(pool)
    .slice(0, BIG_SALE_LINES)
    .sort((a, b) => (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0));
  const forward = buildSaleBody(ctx, chosen.map((product) => ({ product, quantity: 1 })), true);
  const reversed = [...chosen].reverse();
  const backward = buildSaleBody(ctx, reversed.map((product) => ({ product, quantity: 1 })), true);
  const [first, second] = await Promise.all([postSale(ctx.client, forward), postSale(state.vendedor2, backward)]);
  logSale(ctx, "chaos_big_sale_reverse", forward, { case: "9.10", actor: "vendedor1", order: "asc" }, first);
  logSale(ctx, "chaos_big_sale_reverse", backward, { case: "9.10", actor: "vendedor2", order: "desc" }, second);
}

const CASE_RUNNERS: Record<ChaosCase, (ctx: AgentContext) => Promise<void>> = {
  double_sale: chaos_double_sale,
  double_receive: chaos_double_receive,
  race_stock: chaos_race_stock,
  cancel_vs_return: chaos_cancel_vs_return,
  over_adjust: chaos_over_adjust,
  forbidden_adjust: chaos_forbidden_adjust,
  sell_inactive: chaos_sell_inactive,
  over_stock_sale: chaos_over_stock_sale,
  retry_same_key: chaos_retry_same_key,
  big_sale_reverse: chaos_big_sale_reverse,
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

async function currentUserId(client: ApiClient): Promise<string> {
  const res = await client.request("/api/auth/me");
  const data = res.body?.data as JsonRecord | undefined;
  const user = data?.user as JsonRecord | undefined;
  if (!res.ok || typeof user?.id !== "string") {
    throw new Error(`caos: GET /api/auth/me devolvió ${res.status}: ${describeError(res)}`);
  }
  return user.id;
}

async function hasOpenSession(client: ApiClient): Promise<boolean> {
  const res = await client.request("/api/cash/session");
  if (!res.ok) {
    throw new Error(`caos: GET /api/cash/session devolvió ${res.status}: ${describeError(res)}`);
  }
  return res.body?.data !== null && res.body?.data !== undefined;
}

/** Abre la caja asignada al vendedor si no tiene sesión abierta. Nunca la cierra. */
async function ensureCashSession(client: ApiClient, key: Actor): Promise<void> {
  if (await hasOpenSession(client)) return;
  const userId = await currentUserId(client);
  const register = (await fetchRegisters(client)).find((r) => r.assignedUserId === userId);
  if (!register) {
    throw new Error(`caos: ${key} no tiene caja asignada.`);
  }
  const res = await sendJson(client, "POST", "/api/cash/session/open", {
    registerId: register.id,
    openingVes: 0,
    openingRef: 0,
  });
  if (res.ok) return;
  // Otro proceso (el agente vendedor) pudo abrirla justo antes.
  if (await hasOpenSession(client)) return;
  throw new Error(`caos: abrir caja de ${key} devolvió ${res.status}: ${describeError(res)}`);
}

async function fetchCurrentRate(client: ApiClient): Promise<{ id: string; rateVes: number }> {
  const res = await client.request("/api/exchange-rates/current");
  const data = res.body?.data as JsonRecord | undefined;
  const rateVes = Number(data?.rateVes);
  if (!res.ok || typeof data?.id !== "string" || !Number.isFinite(rateVes) || rateVes <= 0) {
    throw new Error(`caos: GET /api/exchange-rates/current devolvió ${res.status}: ${describeError(res)}`);
  }
  return { id: data.id, rateVes };
}

async function fetchContactId(client: ApiClient, type: "cliente" | "proveedor"): Promise<string | null> {
  const res = await client.request(`/api/contacts?type=${type}&limit=100`);
  if (!res.ok) {
    throw new Error(`caos: GET /api/contacts?type=${type} devolvió ${res.status}: ${describeError(res)}`);
  }
  const items = unwrapList(res).filter((raw): raw is JsonRecord => Boolean(raw) && typeof raw === "object");
  const preferred = type === "cliente" ? items.find((item) => item.isPosDefault === true) : undefined;
  const chosen = preferred ?? items[0];
  return typeof chosen?.id === "string" ? chosen.id : null;
}

async function ensureSupplier(admin: ApiClient): Promise<string | null> {
  const existing = await fetchContactId(admin, "proveedor");
  if (existing) return existing;
  const res = await sendJson(admin, "POST", "/api/contacts", { name: "Proveedor Lab Caos", type: "proveedor" });
  return res.ok ? responseId(res) : null;
}

function readTiming(ctx: AgentContext): ChaosTiming {
  const raw = ctx.state.timing as Partial<ChaosTiming> | undefined;
  return {
    doubleSaleGapMs: typeof raw?.doubleSaleGapMs === "number" ? raw.doubleSaleGapMs : DEFAULT_TIMING.doubleSaleGapMs,
    retryGapMs: typeof raw?.retryGapMs === "number" ? raw.retryGapMs : DEFAULT_TIMING.retryGapMs,
  };
}

// ---------------------------------------------------------------------------
// Contrato del agente
// ---------------------------------------------------------------------------

/**
 * Logins (vendedor1 en `ctx.client`; `ctx.state.vendedor2` y `ctx.state.admin`
 * se reutilizan si ya vienen en `state`, si no se crean con `createLabClient`),
 * cajas de ambos vendedores, tasa vigente, consumidor final, proveedor y
 * catálogo (leído con admin, que ve los pares empaque↔unidad).
 */
export async function setup(ctx: AgentContext): Promise<void> {
  const prior = ctx.state as Partial<ChaosState>;
  const vendedor2 = prior.vendedor2 ?? createLabClient();
  const admin = prior.admin ?? createLabClient();

  await loginAs(ctx.client, "vendedor1");
  await loginAs(vendedor2, "vendedor2");
  await loginAs(admin, "admin");
  await ensureCashSession(ctx.client, "vendedor1");
  await ensureCashSession(vendedor2, "vendedor2");

  const rate = await fetchCurrentRate(ctx.client);
  const customerId = await fetchContactId(ctx.client, "cliente");
  if (!customerId) {
    throw new Error("caos: no hay cliente (consumidor final) en la tienda lab.");
  }
  const supplierId = await ensureSupplier(admin);
  ctx.catalog = await loadCatalog(admin);

  const state: ChaosState = {
    vendedor2,
    admin,
    customerId,
    exchangeRateId: rate.id,
    refRateVes: rate.rateVes,
    supplierId,
    timing: readTiming(ctx),
    opsSinceRefresh: 0,
  };
  Object.assign(ctx.state, state);
}

export async function step(ctx: AgentContext): Promise<void> {
  const state = readState(ctx);
  if (state.opsSinceRefresh >= CATALOG_REFRESH_EVERY) {
    ctx.catalog = await loadCatalog(state.admin);
    state.opsSinceRefresh = 0;
  }
  state.opsSinceRefresh += 1;
  await CASE_RUNNERS[pickCase(ctx.rng)](ctx);
}

// Las sesiones de caja NUNCA se cierran desde el caos (las cierra el vendedor); la firma la fija el contrato.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function teardown(ctx: AgentContext): Promise<void> {}

async function main(): Promise<void> {
  const args = parseAgentArgs(process.argv.slice(2), { defaultAgent: "caos" });
  const logger = new EventLogger(args.run, args.agent);
  const ctx: AgentContext = {
    client: createLabClient(),
    logger,
    rng: createRng(args.seed),
    catalog: [],
    state: {},
  };
  console.log(`[${args.agent}] run=${args.run} seed=${args.seed} → ${logger.filePath}`);
  try {
    await setup(ctx);
  } catch (error) {
    console.error(`[${args.agent}] setup falló: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
  const iterations = await runLoop(args, () => step(ctx), { logger });
  await teardown(ctx);
  console.log(`[${args.agent}] fin: ${iterations} ops`);
  process.exit(0);
}

if (require.main === module) {
  void main();
}
