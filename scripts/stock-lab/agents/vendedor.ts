/**
 * Agente vendedor del laboratorio de stock (STK-303): vende por el POS,
 * cancela, devuelve y cobra ventas propias. Abre su caja en `setup` si no
 * hay sesión y la cierra en `teardown` solo si la abrió él.
 *
 *   npx tsx scripts/stock-lab/agents/vendedor.ts --run <id> --seed <n> [--ops <n> | --minutes <m>] [--agent vendedor-2]
 */
import { unwrapList, type ApiClient, type ApiResponse, type JsonRecord } from "../../e2e-bodegon/client";
import {
  LAB_PASSWORD,
  LAB_USERS,
  agentNote,
  createLabClient,
  describeError,
  fetchCatalog,
  fetchRegisters,
  idempotencyKey,
  runLoop,
  type AgentContext,
  type LabProduct,
  type LabRoleKey,
} from "./base";
import { parseAgentArgs } from "./cli";
import { expectedDelta, type SaleLine } from "./expected-delta";
import { EventLogger, isSuccessStatus } from "./logger";
import { createRng, type Rng } from "./rng";

export const VENDEDOR_CATALOG_REFRESH_EVERY = 25;

export type SaleStatus = "pendiente_pago" | "pagada" | "cancelada" | "devuelta";

export type VendedorSale = {
  id: string;
  items: SaleLine[];
  status: SaleStatus;
  hasPayments: boolean;
  totalRef: number;
  totalVes: number;
};

export type VendedorState = {
  userId: string;
  sessionId: string | null;
  openedSession: boolean;
  exchangeRateId: string | null;
  rateVes: number;
  posDefaultCustomerId: string | null;
  customerIds: string[];
  sales: VendedorSale[];
  ops: number;
};

type SalePayment = {
  method: "efectivo_usd" | "efectivo_ves" | "pago_movil";
  currency: "USD" | "VES";
  amount: number;
  change?: { amount: number; method: "efectivo_ves" };
  bankName?: string;
  phone?: string;
  referenceCode?: string;
};

const SALE_STATUSES: readonly SaleStatus[] = ["pendiente_pago", "pagada", "cancelada", "devuelta"];
const BANKS = ["Banesco", "Mercantil", "Provincial", "BNC"] as const;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function dataRecord(res: ApiResponse): JsonRecord | null {
  const data = res.body?.data;
  return data && typeof data === "object" && !Array.isArray(data) ? (data as JsonRecord) : null;
}

/** `vendedor2` si el nombre del agente termina en `2` (p. ej. `vendedor-2`); si no `vendedor1`. */
export function vendedorRoleFor(agentName: string): LabRoleKey {
  return /2$/.test(agentName.trim()) ? "vendedor2" : "vendedor1";
}

export function vendedorState(ctx: AgentContext): VendedorState {
  const state = ctx.state.vendedor;
  if (!state || typeof state !== "object") {
    throw new Error("vendedor: estado no inicializado (llama a setup primero).");
  }
  return state as VendedorState;
}

/** Aplica un delta esperado al catálogo local para no vender stock que ya consumimos. */
export function applyDeltaToCatalog(catalog: LabProduct[], delta: Record<string, number>): void {
  for (const product of catalog) {
    const change = delta[product.id];
    if (change !== undefined) {
      product.currentStock += change;
    }
  }
}

/**
 * Envía un request y registra exactamente un evento. `delta` solo se evalúa
 * con respuesta 2xx; si no, `expected_delta` queda `{}` y `error` lleva el
 * mensaje del body.
 */
async function send(
  ctx: AgentContext,
  op: string,
  path: string,
  init: RequestInit,
  payload: unknown,
  delta: () => Record<string, number>,
): Promise<ApiResponse> {
  const res = await ctx.client.request(path, init);
  const ok = isSuccessStatus(res.status);
  const expected = ok ? delta() : {};
  ctx.logger.log({
    op,
    payload,
    status: res.status,
    response_id: asString(dataRecord(res)?.id),
    expected_delta: expected,
    ...(ok ? {} : { error: describeError(res) }),
  });
  if (ok) {
    applyDeltaToCatalog(ctx.catalog, expected);
  }
  return res;
}

// ---------------------------------------------------------------------------
// setup
// ---------------------------------------------------------------------------

async function loginVendedor(client: ApiClient, key: LabRoleKey): Promise<string> {
  const res = await client.login(LAB_USERS[key].email, LAB_PASSWORD);
  if (!res.ok) {
    throw new Error(`login(${key}) falló con ${res.status}: ${describeError(res)}`);
  }
  const user = dataRecord(res)?.user;
  const userId = user && typeof user === "object" ? asString((user as JsonRecord).id) : null;
  if (!userId) {
    throw new Error("login: la respuesta no trae data.user.id.");
  }
  return userId;
}

async function ensureCashSession(ctx: AgentContext, state: VendedorState): Promise<void> {
  const current = await ctx.client.request("/api/cash/session");
  if (!current.ok) {
    throw new Error(`GET /api/cash/session devolvió ${current.status}: ${describeError(current)}`);
  }
  const open = dataRecord(current);
  const openId = asString(open?.id);
  if (openId) {
    state.sessionId = openId;
    state.openedSession = false;
    return;
  }
  const registers = await fetchRegisters(ctx.client);
  const mine = registers.find((register) => register.assignedUserId === state.userId);
  if (!mine) {
    throw new Error(`No hay caja asignada al usuario ${state.userId}.`);
  }
  const body = { registerId: mine.id, openingVes: 0, openingRef: 0 };
  const res = await send(
    ctx,
    "cash_open",
    "/api/cash/session/open",
    { method: "POST", body: JSON.stringify(body) },
    body,
    () => ({}),
  );
  if (!res.ok) {
    throw new Error(`POST /api/cash/session/open devolvió ${res.status}: ${describeError(res)}`);
  }
  state.sessionId = asString(dataRecord(res)?.id);
  state.openedSession = true;
}

async function loadExchangeRate(ctx: AgentContext, state: VendedorState): Promise<void> {
  const res = await ctx.client.request("/api/exchange-rates/current");
  if (!res.ok) {
    throw new Error(`GET /api/exchange-rates/current devolvió ${res.status}: ${describeError(res)}`);
  }
  const data = dataRecord(res);
  state.exchangeRateId = asString(data?.id);
  state.rateVes = asNumber(data?.rateVes);
  if (state.rateVes <= 0) {
    throw new Error("No hay tasa de cambio vigente (rateVes <= 0).");
  }
}

async function loadCustomers(ctx: AgentContext, state: VendedorState): Promise<void> {
  const res = await ctx.client.request("/api/contacts?type=cliente&limit=100");
  if (!res.ok) {
    throw new Error(`GET /api/contacts devolvió ${res.status}: ${describeError(res)}`);
  }
  state.posDefaultCustomerId = null;
  state.customerIds = [];
  for (const raw of unwrapList(res)) {
    if (!raw || typeof raw !== "object") continue;
    const rec = raw as JsonRecord;
    const id = asString(rec.id);
    if (!id || rec.isActive === false) continue;
    if (rec.isPosDefault === true) {
      state.posDefaultCustomerId = id;
    } else {
      state.customerIds.push(id);
    }
  }
  if (!state.posDefaultCustomerId && state.customerIds.length === 0) {
    throw new Error("No hay clientes en la tienda lab.");
  }
}

export async function setup(ctx: AgentContext): Promise<void> {
  const role = vendedorRoleFor(ctx.logger.agent);
  const userId = await loginVendedor(ctx.client, role);
  const state: VendedorState = {
    userId,
    sessionId: null,
    openedSession: false,
    exchangeRateId: null,
    rateVes: 0,
    posDefaultCustomerId: null,
    customerIds: [],
    sales: [],
    ops: 0,
  };
  ctx.state.vendedor = state;
  ctx.catalog = await fetchCatalog(ctx.client);
  await ensureCashSession(ctx, state);
  await loadExchangeRate(ctx, state);
  await loadCustomers(ctx, state);
}

// ---------------------------------------------------------------------------
// step
// ---------------------------------------------------------------------------

function sellable(catalog: readonly LabProduct[], exclude: ReadonlySet<string>): LabProduct[] {
  return catalog.filter((p) => p.isActive && p.currentStock > 0 && !exclude.has(p.id));
}

type PricedLine = SaleLine & { unitPriceRef: number };

/** 1-4 líneas: 60 % hot, 40 % cualquiera con stock; ~5 % por encima del stock local. */
export function buildSaleLines(rng: Rng, catalog: readonly LabProduct[]): PricedLine[] {
  const lineCount = rng.int(1, 4);
  const chosen = new Set<string>();
  const lines: PricedLine[] = [];
  for (let i = 0; i < lineCount; i += 1) {
    const preferHot = rng.chance(0.6);
    const pool = sellable(catalog, chosen);
    const hotPool = pool.filter((p) => p.isHot);
    const candidates = preferHot && hotPool.length > 0 ? hotPool : pool;
    if (candidates.length === 0) break;
    const product = rng.pick(candidates);
    chosen.add(product.id);
    const overStock = rng.chance(0.05);
    const quantity = overStock
      ? product.currentStock + rng.int(1, 3)
      : rng.int(1, Math.min(5, product.currentStock));
    lines.push({ productId: product.id, quantity, unitPriceRef: product.salePrice });
  }
  if (lines.length === 0) {
    throw new Error("No hay productos activos con stock para vender.");
  }
  return lines;
}

function referenceCode(rng: Rng): string {
  return String(rng.int(0, 9999)).padStart(4, "0");
}

/** Pagos que cubren el total: mezcla de USD con vuelto, Bs en efectivo y pago móvil. */
export function buildSalePayments(rng: Rng, totalRef: number, rateVes: number): SalePayment[] {
  const totalVes = round2(totalRef * rateVes);
  const kind = rng.int(0, 3);
  if (kind === 0) {
    return [{ method: "efectivo_ves", currency: "VES", amount: totalVes }];
  }
  if (kind === 1) {
    return [
      {
        method: "pago_movil",
        currency: "VES",
        amount: totalVes,
        bankName: rng.pick(BANKS),
        phone: `0414${String(rng.int(0, 9_999_999)).padStart(7, "0")}`,
        referenceCode: referenceCode(rng),
      },
    ];
  }
  if (kind === 2) {
    const received = Math.ceil(totalRef) + rng.int(0, 5);
    const changeVes = round2((received - totalRef) * rateVes);
    const usd: SalePayment = { method: "efectivo_usd", currency: "USD", amount: received };
    if (changeVes > 0) {
      usd.change = { amount: changeVes, method: "efectivo_ves" };
    }
    return [usd];
  }
  const usdPart = round2(totalRef / 2);
  const vesPart = round2(totalVes - round2(usdPart * rateVes));
  const payments: SalePayment[] = [{ method: "efectivo_usd", currency: "USD", amount: usdPart }];
  if (vesPart > 0) {
    payments.push({ method: "efectivo_ves", currency: "VES", amount: vesPart });
  }
  return payments;
}

function parseSaleStatus(value: unknown, fallback: SaleStatus): SaleStatus {
  return typeof value === "string" && (SALE_STATUSES as readonly string[]).includes(value)
    ? (value as SaleStatus)
    : fallback;
}

/** 70 % consumidor final; el resto, cualquier otro cliente activo. */
function pickCustomer(rng: Rng, state: VendedorState): string {
  const { posDefaultCustomerId, customerIds } = state;
  if (posDefaultCustomerId && (customerIds.length === 0 || rng.chance(0.7))) {
    return posDefaultCustomerId;
  }
  return rng.pick(customerIds);
}

async function createSale(ctx: AgentContext, state: VendedorState): Promise<void> {
  // Catálogo con activos pero todos agotados en la caché: condición transitoria
  // de la ola (STK-626). Se anota y la iteración no envía nada; se comprueba
  // antes de tocar el rng. Sin ningún activo sigue lanzando (error real).
  if (ctx.catalog.some((p) => p.isActive) && sellable(ctx.catalog, new Set()).length === 0) {
    agentNote(ctx, "venta omitida: todos los productos activos están sin stock en el catálogo en caché");
    return;
  }
  const lines = buildSaleLines(ctx.rng, ctx.catalog);
  const totalRef = round2(lines.reduce((sum, line) => sum + line.quantity * line.unitPriceRef, 0));
  const customerId = pickCustomer(ctx.rng, state);
  const withPayments = ctx.rng.chance(0.8);
  const clientRequestId = idempotencyKey(ctx.rng, ctx.logger.runId);
  const body: JsonRecord = {
    clientRequestId,
    customerId,
    ...(state.exchangeRateId ? { exchangeRateId: state.exchangeRateId } : {}),
    refRateVes: state.rateVes,
    items: lines.map(({ productId, quantity, unitPriceRef }) => ({ productId, quantity, unitPriceRef })),
    taxRef: 0,
    discountRef: 0,
    ...(withPayments ? { payments: buildSalePayments(ctx.rng, totalRef, state.rateVes) } : {}),
  };
  const items: SaleLine[] = lines.map(({ productId, quantity }) => ({ productId, quantity }));
  const res = await send(
    ctx,
    "sale_create",
    "/api/sales",
    { method: "POST", body: JSON.stringify(body) },
    body,
    () => expectedDelta("sale_create", { items }),
  );
  if (!isSuccessStatus(res.status)) return;
  const data = dataRecord(res);
  const id = asString(data?.id);
  if (!id) return;
  state.sales.push({
    id,
    items,
    status: parseSaleStatus(data?.status, withPayments ? "pagada" : "pendiente_pago"),
    hasPayments: withPayments,
    totalRef: asNumber(data?.totalRef, totalRef),
    totalVes: asNumber(data?.totalVes, round2(totalRef * state.rateVes)),
  });
}

async function cancelSale(ctx: AgentContext, sale: VendedorSale): Promise<void> {
  const res = await send(
    ctx,
    "sale_cancel",
    `/api/sales/${sale.id}/cancel`,
    { method: "PATCH" },
    { saleId: sale.id },
    () => expectedDelta("sale_cancel", { items: sale.items }),
  );
  if (isSuccessStatus(res.status)) sale.status = "cancelada";
}

async function returnSale(ctx: AgentContext, sale: VendedorSale): Promise<void> {
  const res = await send(
    ctx,
    "sale_return",
    `/api/sales/${sale.id}/return`,
    { method: "POST" },
    { saleId: sale.id },
    () => expectedDelta("sale_return", { items: sale.items }),
  );
  if (isSuccessStatus(res.status)) sale.status = "devuelta";
}

async function paySale(ctx: AgentContext, sale: VendedorSale): Promise<void> {
  const usePagoMovil = ctx.rng.chance(0.5);
  const body: JsonRecord = usePagoMovil
    ? {
        saleId: sale.id,
        method: "pago_movil",
        currency: "VES",
        amount: sale.totalVes,
        bankName: ctx.rng.pick(BANKS),
        phone: `0424${String(ctx.rng.int(0, 9_999_999)).padStart(7, "0")}`,
        referenceCode: referenceCode(ctx.rng),
      }
    : { saleId: sale.id, method: "efectivo_ves", currency: "VES", amount: sale.totalVes };
  const res = await send(
    ctx,
    "payment_create",
    "/api/payments",
    { method: "POST", body: JSON.stringify(body) },
    body,
    () => ({}),
  );
  if (isSuccessStatus(res.status)) {
    sale.hasPayments = true;
    sale.status = "pagada";
  }
}

export async function step(ctx: AgentContext): Promise<void> {
  const state = vendedorState(ctx);
  if (state.ops > 0 && state.ops % VENDEDOR_CATALOG_REFRESH_EVERY === 0) {
    ctx.catalog = await fetchCatalog(ctx.client);
  }
  state.ops += 1;

  const roll = ctx.rng.next();
  if (roll < 0.7) {
    await createSale(ctx, state);
    return;
  }
  if (roll < 0.8) {
    const candidates = state.sales.filter((sale) => sale.status === "pendiente_pago" && !sale.hasPayments);
    if (candidates.length > 0) {
      await cancelSale(ctx, ctx.rng.pick(candidates));
      return;
    }
  } else if (roll < 0.9) {
    const candidates = state.sales.filter((sale) => sale.status === "pagada");
    if (candidates.length > 0) {
      await returnSale(ctx, ctx.rng.pick(candidates));
      return;
    }
  } else {
    const candidates = state.sales.filter((sale) => sale.status === "pendiente_pago");
    if (candidates.length > 0) {
      await paySale(ctx, ctx.rng.pick(candidates));
      return;
    }
  }
  // Sin candidatos para la op elegida: vende.
  await createSale(ctx, state);
}

// ---------------------------------------------------------------------------
// teardown
// ---------------------------------------------------------------------------

export async function teardown(ctx: AgentContext): Promise<void> {
  const state = vendedorState(ctx);
  if (!state.openedSession || !state.sessionId) return;
  const body = { sessionId: state.sessionId, closingVes: 0, closingRef: 0 };
  await send(
    ctx,
    "cash_close",
    "/api/cash/session/close",
    { method: "POST", body: JSON.stringify(body) },
    body,
    () => ({}),
  );
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseAgentArgs(process.argv.slice(2), { defaultAgent: "vendedor" });
  const ctx: AgentContext = {
    client: createLabClient(),
    logger: new EventLogger(args.run, args.agent),
    rng: createRng(args.seed),
    catalog: [],
    state: {},
  };
  try {
    await setup(ctx);
  } catch (error) {
    console.error(`[${args.agent}] setup falló: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
  console.log(`[${args.agent}] run=${args.run} seed=${args.seed} inicio`);
  const ops = await runLoop(args, () => step(ctx), { logger: ctx.logger });
  await teardown(ctx);
  console.log(`[${args.agent}] fin: ${ops} ops`);
  process.exit(0);
}

if (require.main === module) {
  void main();
}
