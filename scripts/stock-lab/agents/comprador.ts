/**
 * Agente comprador del laboratorio de stock (STK-303): registra compras
 * (`pedido`/`recibido`, en unidades o empaques), recibe pedidos (a veces dos
 * veces seguidas), cancela, devuelve y paga compras propias como `admin`.
 *
 *   npx tsx scripts/stock-lab/agents/comprador.ts --run <id> --seed <n> [--ops <n> | --minutes <m>]
 */
import { unwrapList, type ApiResponse, type JsonRecord } from "../../e2e-bodegon/client";
import {
  createLabClient,
  describeError,
  fetchCatalog,
  loginAs,
  runLoop,
  type AgentContext,
  type LabProduct,
} from "./base";
import { parseAgentArgs } from "./cli";
import { expectedDelta, type PurchaseLine, type PurchaseStatus } from "./expected-delta";
import { EventLogger, isSuccessStatus } from "./logger";
import { createRng, type Rng } from "./rng";

export const COMPRADOR_CATALOG_REFRESH_EVERY = 25;
export const PACK_SIZES = [6, 12, 24] as const;

export type CompradorPurchaseStatus = PurchaseStatus | "cancelada" | "devuelta";

export type CompradorPurchase = {
  id: string;
  items: PurchaseLine[];
  status: CompradorPurchaseStatus;
  totalVes: number;
};

/** Producto que un proveedor tiene en su catálogo, con su empaque por defecto si lo hay. */
export type SupplierCatalogItem = {
  productId: string;
  supplierSku: string | null;
  taxRate: number;
  packLabel: string | null;
  unitsPerPack: number | null;
};

export type LabSupplier = { id: string; name: string; items: SupplierCatalogItem[] };

export type CompradorState = {
  suppliers: LabSupplier[];
  exchangeRateId: string | null;
  rateVes: number;
  purchases: CompradorPurchase[];
  ops: number;
};

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

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function dataRecord(res: ApiResponse): JsonRecord | null {
  return asRecord(res.body?.data);
}

export function compradorState(ctx: AgentContext): CompradorState {
  const state = ctx.state.comprador;
  if (!state || typeof state !== "object") {
    throw new Error("comprador: estado no inicializado (llama a setup primero).");
  }
  return state as CompradorState;
}

function applyDeltaToCatalog(catalog: LabProduct[], delta: Record<string, number>): void {
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

/** Mapea un item de `GET /api/suppliers/[id]/products` (toma el empaque por defecto activo). */
export function mapSupplierCatalogItem(raw: unknown): SupplierCatalogItem | null {
  const rec = asRecord(raw);
  const productId = rec ? asString(rec.productId) : null;
  if (!rec || !productId || rec.isActive === false) return null;
  const product = asRecord(rec.product);
  const packUnits = Array.isArray(rec.packUnits) ? rec.packUnits.map(asRecord) : [];
  const defaultPack =
    asRecord(rec.defaultPackUnit) ??
    packUnits.find((unit) => unit?.isDefault === true && unit.isActive !== false) ??
    packUnits.find((unit) => unit?.isActive !== false) ??
    null;
  const unitsPerPack = defaultPack ? asNumber(defaultPack.unitsPerPack) : 0;
  return {
    productId,
    supplierSku: asString(rec.supplierSku),
    taxRate: asNumber(product?.taxRate),
    packLabel: unitsPerPack > 0 ? asString(defaultPack?.label) : null,
    unitsPerPack: unitsPerPack > 0 ? unitsPerPack : null,
  };
}

async function loadSuppliers(ctx: AgentContext, state: CompradorState): Promise<void> {
  const res = await ctx.client.request("/api/contacts?type=proveedor&limit=100");
  if (!res.ok) {
    throw new Error(`GET /api/contacts devolvió ${res.status}: ${describeError(res)}`);
  }
  state.suppliers = [];
  for (const raw of unwrapList(res)) {
    const rec = asRecord(raw);
    const id = rec ? asString(rec.id) : null;
    if (!rec || !id || rec.isActive === false) continue;
    const catalogRes = await ctx.client.request(`/api/suppliers/${id}/products?limit=100`);
    const items: SupplierCatalogItem[] = [];
    if (catalogRes.ok) {
      for (const item of unwrapList(catalogRes)) {
        const mapped = mapSupplierCatalogItem(item);
        if (mapped) items.push(mapped);
      }
    }
    state.suppliers.push({ id, name: asString(rec.name) ?? "", items });
  }
  if (state.suppliers.length === 0) {
    throw new Error("No hay proveedores en la tienda lab.");
  }
}

async function loadExchangeRate(ctx: AgentContext, state: CompradorState): Promise<void> {
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

export async function setup(ctx: AgentContext): Promise<void> {
  await loginAs(ctx.client, "admin");
  const state: CompradorState = { suppliers: [], exchangeRateId: null, rateVes: 0, purchases: [], ops: 0 };
  ctx.state.comprador = state;
  ctx.catalog = await fetchCatalog(ctx.client);
  await loadSuppliers(ctx, state);
  await loadExchangeRate(ctx, state);
}

// ---------------------------------------------------------------------------
// step
// ---------------------------------------------------------------------------

type PurchaseItemBody = JsonRecord & { productId: string; subtotalRef: number; subtotalVes: number; taxRef: number; taxVes: number };

type BuiltPurchaseLine = { body: PurchaseItemBody; line: PurchaseLine };

function unitCostFor(product: LabProduct | undefined, rng: Rng): number {
  const base = product && product.salePrice > 0 ? product.salePrice * 0.6 : rng.int(1, 5);
  return Math.max(0.01, round2(base));
}

/**
 * Una línea de compra: 50 % unidades (5-50), 50 % empaques (1-5 ×
 * {6,12,24}, o el empaque por defecto del proveedor si lo tiene).
 */
export function buildPurchaseLine(
  rng: Rng,
  catalog: readonly LabProduct[],
  item: SupplierCatalogItem,
  rateVes: number,
): BuiltPurchaseLine {
  const product = catalog.find((p) => p.id === item.productId);
  const unitCostRef = unitCostFor(product, rng);
  const unitCostVes = round2(unitCostRef * rateVes);
  const taxRate = item.taxRate > 0 ? item.taxRate : 0;
  const usePack = rng.chance(0.5);
  let subtotalRef: number;
  let body: PurchaseItemBody;
  let line: PurchaseLine;
  if (usePack) {
    const packCount = rng.int(1, 5);
    const unitsPerPack = item.unitsPerPack ?? rng.pick(PACK_SIZES);
    const packCostRef = round2(unitCostRef * unitsPerPack);
    subtotalRef = round2(packCount * packCostRef);
    body = {
      entryMode: "pack",
      productId: item.productId,
      packLabel: item.packLabel ?? `Bulto x${unitsPerPack}`,
      packCount,
      unitsPerPack,
      packCostRef,
      packCostVes: round2(packCostRef * rateVes),
      unitCostRef,
      unitCostVes,
      costCurrency: "ref",
      taxRate,
      taxRef: 0,
      taxVes: 0,
      subtotalRef,
      subtotalVes: 0,
    };
    line = { productId: item.productId, packCount, unitsPerPack };
  } else {
    const quantity = rng.int(5, 50);
    subtotalRef = round2(quantity * unitCostRef);
    body = {
      entryMode: "unit",
      productId: item.productId,
      quantity,
      unitCostRef,
      unitCostVes,
      costCurrency: "ref",
      taxRate,
      taxRef: 0,
      taxVes: 0,
      subtotalRef,
      subtotalVes: 0,
    };
    line = { productId: item.productId, quantity };
  }
  body.subtotalVes = round2(subtotalRef * rateVes);
  body.taxRef = round2((subtotalRef * taxRate) / 100);
  body.taxVes = round2(body.taxRef * rateVes);
  if (item.supplierSku) {
    body.supplierSku = item.supplierSku;
  }
  return { body, line };
}

/** Productos comprables a un proveedor: su catálogo o, si está vacío, cualquier activo. */
function purchasableItems(supplier: LabSupplier, catalog: readonly LabProduct[]): SupplierCatalogItem[] {
  if (supplier.items.length > 0) return supplier.items;
  return catalog
    .filter((p) => p.isActive)
    .map((p) => ({ productId: p.id, supplierSku: null, taxRate: 0, packLabel: null, unitsPerPack: null }));
}

async function createPurchase(ctx: AgentContext, state: CompradorState): Promise<void> {
  const supplier = ctx.rng.pick(state.suppliers);
  const candidates = purchasableItems(supplier, ctx.catalog);
  if (candidates.length === 0) {
    throw new Error("No hay productos activos para comprar.");
  }
  const status: PurchaseStatus = ctx.rng.chance(0.6) ? "recibido" : "pedido";
  const lineCount = Math.min(ctx.rng.int(1, 3), candidates.length);
  const chosen = ctx.rng.shuffle(candidates).slice(0, lineCount);
  const built = chosen.map((item) => buildPurchaseLine(ctx.rng, ctx.catalog, item, state.rateVes));
  const subtotalRef = round2(built.reduce((sum, { body }) => sum + body.subtotalRef, 0));
  const subtotalVes = round2(built.reduce((sum, { body }) => sum + body.subtotalVes, 0));
  const taxRef = round2(built.reduce((sum, { body }) => sum + body.taxRef, 0));
  const taxVes = round2(built.reduce((sum, { body }) => sum + body.taxVes, 0));
  const body: JsonRecord = {
    supplierId: supplier.id,
    status,
    ...(state.exchangeRateId ? { exchangeRateId: state.exchangeRateId } : {}),
    refRateVes: state.rateVes,
    notes: "",
    subtotalRef,
    subtotalVes,
    taxRef,
    taxVes,
    discountRef: 0,
    discountVes: 0,
    items: built.map(({ body: itemBody }) => itemBody),
  };
  const items = built.map(({ line }) => line);
  const res = await send(
    ctx,
    "purchase_create",
    "/api/purchases",
    { method: "POST", body: JSON.stringify(body) },
    body,
    () => expectedDelta("purchase_create", { status, items }),
  );
  if (!isSuccessStatus(res.status)) return;
  const data = dataRecord(res);
  const id = asString(data?.id);
  if (!id) return;
  state.purchases.push({
    id,
    items,
    status,
    totalVes: asNumber(data?.totalVes, round2(subtotalVes + taxVes)),
  });
}

async function receivePurchase(ctx: AgentContext, purchase: CompradorPurchase): Promise<void> {
  const res = await send(
    ctx,
    "purchase_receive",
    `/api/purchases/${purchase.id}/receive`,
    { method: "PATCH" },
    { purchaseId: purchase.id },
    () => expectedDelta("purchase_receive", { items: purchase.items }),
  );
  if (isSuccessStatus(res.status)) purchase.status = "recibido";
}

function receivableStatus(status: CompradorPurchaseStatus): PurchaseStatus | null {
  return status === "pedido" || status === "recibido" ? status : null;
}

async function cancelPurchase(ctx: AgentContext, purchase: CompradorPurchase): Promise<void> {
  const status = receivableStatus(purchase.status) ?? "pedido";
  const res = await send(
    ctx,
    "purchase_cancel",
    `/api/purchases/${purchase.id}/cancel`,
    { method: "PATCH" },
    { purchaseId: purchase.id },
    () => expectedDelta("purchase_cancel", { status, items: purchase.items }),
  );
  if (isSuccessStatus(res.status)) purchase.status = "cancelada";
}

async function returnPurchase(ctx: AgentContext, purchase: CompradorPurchase): Promise<void> {
  const res = await send(
    ctx,
    "purchase_return",
    `/api/purchases/${purchase.id}/return`,
    { method: "POST" },
    { purchaseId: purchase.id },
    () => expectedDelta("purchase_return", { status: "recibido", items: purchase.items }),
  );
  if (isSuccessStatus(res.status)) purchase.status = "devuelta";
}

async function payPurchase(ctx: AgentContext, purchase: CompradorPurchase): Promise<void> {
  const body: JsonRecord = {
    purchaseId: purchase.id,
    method: "transferencia",
    currency: "VES",
    amount: purchase.totalVes,
    bankName: ctx.rng.pick(BANKS),
    referenceCode: `TRF-${String(ctx.rng.int(0, 999_999)).padStart(6, "0")}`,
  };
  await send(ctx, "payment_create", "/api/payments", { method: "POST", body: JSON.stringify(body) }, body, () => ({}));
}

export async function step(ctx: AgentContext): Promise<void> {
  const state = compradorState(ctx);
  if (state.ops > 0 && state.ops % COMPRADOR_CATALOG_REFRESH_EVERY === 0) {
    ctx.catalog = await fetchCatalog(ctx.client);
  }
  state.ops += 1;

  const roll = ctx.rng.next();
  if (roll < 0.5) {
    await createPurchase(ctx, state);
    return;
  }
  if (roll < 0.7) {
    const candidates = state.purchases.filter((purchase) => purchase.status === "pedido");
    if (candidates.length > 0) {
      const purchase = ctx.rng.pick(candidates);
      const twice = ctx.rng.chance(0.25);
      await receivePurchase(ctx, purchase);
      if (twice) {
        await receivePurchase(ctx, purchase);
      }
      return;
    }
  } else if (roll < 0.8) {
    const candidates = state.purchases.filter((purchase) => receivableStatus(purchase.status) !== null);
    if (candidates.length > 0) {
      await cancelPurchase(ctx, ctx.rng.pick(candidates));
      return;
    }
  } else if (roll < 0.9) {
    const candidates = state.purchases.filter((purchase) => purchase.status === "recibido");
    if (candidates.length > 0) {
      await returnPurchase(ctx, ctx.rng.pick(candidates));
      return;
    }
  } else {
    const candidates = state.purchases.filter((purchase) => receivableStatus(purchase.status) !== null && purchase.totalVes > 0);
    if (candidates.length > 0) {
      await payPurchase(ctx, ctx.rng.pick(candidates));
      return;
    }
  }
  // Sin candidatos para la op elegida: compra.
  await createPurchase(ctx, state);
}

// ---------------------------------------------------------------------------
// teardown
// ---------------------------------------------------------------------------

/** El comprador no deja recursos abiertos; solo comprueba que hubo setup. */
export async function teardown(ctx: AgentContext): Promise<void> {
  compradorState(ctx);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseAgentArgs(process.argv.slice(2), { defaultAgent: "comprador" });
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
