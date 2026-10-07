/**
 * Agente operador "almacén" del laboratorio de stock (STK-304).
 *
 * Se loguea como `almacen` y en cada `step` hace UNA operación elegida con el
 * rng: ajuste de inventario (35 %), conversión empaque→unidad (25 %), alta de
 * producto + inventario inicial (15 %), desactivar producto (15 %) o reactivar
 * producto (10 %). Cada request HTTP = un evento en events.jsonl.
 *
 *   npx tsx scripts/stock-lab/agents/almacen.ts --run <id> --seed <n> [--minutes <m> | --ops <n>]
 */
import type { ApiClient, ApiResponse, JsonRecord } from "../../e2e-bodegon/client";
import { unwrapList } from "../../e2e-bodegon/client";
import {
  type AgentContext,
  HOT_SKU_PREFIX,
  type LabProduct,
  createLabClient,
  describeError,
  fetchCatalog,
  loginAs,
  runLoop,
} from "./base";
import { parseAgentArgs } from "./cli";
import { expectedDelta } from "./expected-delta";
import { EventLogger, isSuccessStatus } from "./logger";
import { type Rng, createRng } from "./rng";

export const CATALOG_REFRESH_EVERY = 25;

export type AlmacenOp = "adjustment" | "conversion" | "product_create" | "product_deactivate" | "product_reactivate";

type AlmacenState = {
  /** Semilla del run (para el SKU `LAB-NEW-<seed>-<n>`). */
  seed: number;
  categoryIds: string[];
  opsSinceRefresh: number;
  createdCount: number;
};

type AdjustmentType = "ajuste_entrada" | "ajuste_salida" | "inventario_inicial";

type AdjustmentBody = {
  productId: string;
  quantityDelta: number;
  type: AdjustmentType;
  reason: string;
};

// ---------------------------------------------------------------------------
// Utilidades locales
// ---------------------------------------------------------------------------

function round2(value: number): number {
  return Math.round(value * 100) / 100;
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

/** Aplica un delta esperado al catálogo local (solo tras un 2xx). */
export function applyDeltaToCatalog(catalog: LabProduct[], delta: Record<string, number>): void {
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
  payload: unknown,
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

function readState(ctx: AgentContext): AlmacenState {
  const state = ctx.state as Partial<AlmacenState>;
  if (!Array.isArray(state.categoryIds) || typeof state.opsSinceRefresh !== "number") {
    throw new Error("almacen: setup() no se ha ejecutado.");
  }
  return state as AlmacenState;
}

/** Elige la operación con el rng (35/25/15/15/10). Exportado para el test de determinismo. */
export function pickOp(rng: Rng): AlmacenOp {
  const roll = rng.next();
  if (roll < 0.35) return "adjustment";
  if (roll < 0.6) return "conversion";
  if (roll < 0.75) return "product_create";
  if (roll < 0.9) return "product_deactivate";
  return "product_reactivate";
}

// ---------------------------------------------------------------------------
// Operaciones
// ---------------------------------------------------------------------------

async function postAdjustment(ctx: AgentContext, body: AdjustmentBody): Promise<ApiResponse> {
  const res = await sendJson(ctx.client, "POST", "/api/inventory/adjustments", body);
  logRequest(ctx, "adjustment", body, res, () =>
    expectedDelta("adjustment", { productId: body.productId, quantityDelta: body.quantityDelta }),
  );
  return res;
}

/** Candidato para ajuste: 50 % hot / 50 % no-hot (si hay de ambos). */
function pickAdjustmentTarget(ctx: AgentContext): LabProduct | null {
  const active = ctx.catalog.filter((p) => p.isActive);
  if (active.length === 0) return null;
  const hot = active.filter((p) => p.isHot);
  const cold = active.filter((p) => !p.isHot);
  const pool = ctx.rng.chance(0.5) ? hot : cold;
  return ctx.rng.pick(pool.length > 0 ? pool : active);
}

async function opAdjustment(ctx: AgentContext): Promise<void> {
  const product = pickAdjustmentTarget(ctx);
  if (!product) {
    throw new Error("almacen: no hay productos activos para ajustar.");
  }
  const entrada = ctx.rng.chance(0.5) || product.currentStock < 1;
  let body: AdjustmentBody;
  if (entrada) {
    body = {
      productId: product.id,
      quantityDelta: ctx.rng.int(1, 30),
      type: "ajuste_entrada",
      reason: "Lab: ajuste de entrada",
    };
  } else {
    const overStock = ctx.rng.chance(0.1);
    const quantity = overStock ? product.currentStock + ctx.rng.int(1, 20) : ctx.rng.int(1, Math.min(20, product.currentStock));
    body = {
      productId: product.id,
      quantityDelta: -quantity,
      type: "ajuste_salida",
      reason: overStock ? "Lab: salida por encima del stock" : "Lab: ajuste de salida",
    };
  }
  await postAdjustment(ctx, body);
}

async function opConversion(ctx: AgentContext): Promise<void> {
  const packs = ctx.catalog.filter(
    (p) => p.isActive && p.packUnitsPerPack !== null && p.packUnitsPerPack > 0 && p.packUnitProductId !== null,
  );
  if (packs.length === 0) {
    // Sin pares activos (o el rol no los ve): hacemos un ajuste en su lugar.
    await opAdjustment(ctx);
    return;
  }
  const pack = ctx.rng.pick(packs);
  const unitsPerPack = pack.packUnitsPerPack ?? 0;
  const unitProductId = pack.packUnitProductId ?? "";
  const overStock = ctx.rng.chance(0.2);
  const packQuantity = overStock ? Math.max(pack.currentStock, 0) + ctx.rng.int(1, 3) : ctx.rng.int(1, 3);
  const body = {
    packProductId: pack.id,
    packQuantity,
    reason: overStock ? "Lab: conversión por encima del stock" : "Lab: apertura de empaque",
  };
  const res = await sendJson(ctx.client, "POST", "/api/inventory/conversions", body);
  logRequest(ctx, "conversion", { ...body, unitProductId, unitsPerPack }, res, () =>
    expectedDelta("conversion", { packProductId: pack.id, unitProductId, packQuantity, unitsPerPack }),
  );
}

async function opProductCreate(ctx: AgentContext): Promise<void> {
  const state = readState(ctx);
  state.createdCount += 1;
  const n = state.createdCount;
  const salePriceRef = round2(ctx.rng.int(50, 500) / 100);
  const body: JsonRecord = {
    sku: `LAB-NEW-${state.seed}-${n}`,
    name: `Lab nuevo ${state.seed}-${n}`,
    salePriceRef,
    currentCostRef: round2(salePriceRef * 0.7),
    currentStock: 0,
  };
  if (state.categoryIds.length > 0) {
    body.categoryId = ctx.rng.pick(state.categoryIds);
  }
  const res = await sendJson(ctx.client, "POST", "/api/products", body);
  logRequest(ctx, "product_create", body, res, () => {
    const productId = responseId(res) ?? "";
    return expectedDelta("product_create", { productId, initialStock: 0 });
  });
  const productId = responseId(res);
  if (!isSuccessStatus(res.status) || !productId) {
    return;
  }
  ctx.catalog.push({
    id: productId,
    sku: String(body.sku),
    name: String(body.name),
    isActive: true,
    currentStock: 0,
    salePrice: salePriceRef,
    isHot: false,
    packUnitsPerPack: null,
    packUnitProductId: null,
  });
  await postAdjustment(ctx, {
    productId,
    quantityDelta: ctx.rng.int(10, 100),
    type: "inventario_inicial",
    reason: "Stock inicial",
  });
}

async function opProductDeactivate(ctx: AgentContext): Promise<void> {
  const candidates = ctx.catalog.filter((p) => p.isActive && !p.isHot);
  if (candidates.length === 0) {
    await opAdjustment(ctx);
    return;
  }
  const product = ctx.rng.pick(candidates);
  const res = await sendJson(ctx.client, "DELETE", `/api/products/${product.id}`);
  logRequest(ctx, "product_deactivate", { productId: product.id, sku: product.sku }, res, () => ({}));
  if (isSuccessStatus(res.status)) {
    product.isActive = false;
  }
}

async function opProductReactivate(ctx: AgentContext): Promise<void> {
  const candidates = ctx.catalog.filter((p) => !p.isActive);
  if (candidates.length === 0) {
    await opAdjustment(ctx);
    return;
  }
  const product = ctx.rng.pick(candidates);
  const body = { isActive: true };
  const res = await sendJson(ctx.client, "PATCH", `/api/products/${product.id}`, body);
  logRequest(ctx, "product_reactivate", { productId: product.id, sku: product.sku, ...body }, res, () => ({}));
  if (isSuccessStatus(res.status)) {
    product.isActive = true;
  }
}

// ---------------------------------------------------------------------------
// Contrato del agente
// ---------------------------------------------------------------------------

export async function setup(ctx: AgentContext): Promise<void> {
  await loginAs(ctx.client, "almacen");
  ctx.catalog = await loadCatalog(ctx.client);
  const categoriesRes = await ctx.client.request("/api/categories?limit=20");
  const categoryIds: string[] = [];
  if (categoriesRes.ok) {
    for (const raw of unwrapList(categoriesRes)) {
      if (raw && typeof raw === "object" && typeof (raw as JsonRecord).id === "string") {
        categoryIds.push((raw as JsonRecord).id as string);
      }
    }
  }
  const seed = typeof ctx.state.seed === "number" ? ctx.state.seed : 0;
  const state: AlmacenState = { seed, categoryIds, opsSinceRefresh: 0, createdCount: 0 };
  Object.assign(ctx.state, state);
}

export async function step(ctx: AgentContext): Promise<void> {
  const state = readState(ctx);
  if (state.opsSinceRefresh >= CATALOG_REFRESH_EVERY) {
    ctx.catalog = await loadCatalog(ctx.client);
    state.opsSinceRefresh = 0;
  }
  state.opsSinceRefresh += 1;

  switch (pickOp(ctx.rng)) {
    case "adjustment":
      await opAdjustment(ctx);
      break;
    case "conversion":
      await opConversion(ctx);
      break;
    case "product_create":
      await opProductCreate(ctx);
      break;
    case "product_deactivate":
      await opProductDeactivate(ctx);
      break;
    case "product_reactivate":
      await opProductReactivate(ctx);
      break;
  }
}

// El almacén no abre caja ni deja nada que cerrar; la firma la fija el contrato de agentes.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function teardown(ctx: AgentContext): Promise<void> {}

async function main(): Promise<void> {
  const args = parseAgentArgs(process.argv.slice(2), { defaultAgent: "almacen" });
  const logger = new EventLogger(args.run, args.agent);
  const ctx: AgentContext = {
    client: createLabClient(),
    logger,
    rng: createRng(args.seed),
    catalog: [],
    state: { seed: args.seed },
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
