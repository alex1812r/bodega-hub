/**
 * Base compartida de los agentes operadores del laboratorio de stock
 * (plan stock-integrity, fase 3, STK-302): usuarios lab, cliente HTTP con
 * guard de host, login, catálogo, cajas, bucle de ejecución e idempotencia.
 *
 * Reutiliza `ApiClient` de scripts/e2e-bodegon/client.ts (no se copia).
 */
import { ApiClient, unwrapList, type ApiResponse, type JsonRecord } from "../../e2e-bodegon/client";
import { assertAllowedWriteHost, loadStockLabEnv } from "../env";
import type { AgentArgs } from "./cli";
import type { EventLogger } from "./logger";
import type { Rng } from "./rng";

export const LAB_PASSWORD = "Lab2026!";

export type LabRoleKey = "admin" | "vendedor1" | "vendedor2" | "almacen" | "contador";

export const LAB_USERS: Record<LabRoleKey, { email: string; role: string }> = {
  admin: { email: "lab-admin@lab.local", role: "admin" },
  vendedor1: { email: "lab-vendedor-1@lab.local", role: "vendedor" },
  vendedor2: { email: "lab-vendedor-2@lab.local", role: "vendedor" },
  almacen: { email: "lab-almacen@lab.local", role: "almacen" },
  contador: { email: "lab-contador@lab.local", role: "contador" },
};

export const DEFAULT_LAB_API_URL = "http://localhost:3100";
export const HOT_SKU_PREFIX = "LAB-HOT-";

export type LabProduct = {
  id: string;
  sku: string;
  name: string;
  isActive: boolean;
  currentStock: number;
  salePrice: number;
  isHot: boolean;
  packUnitsPerPack: number | null;
  packUnitProductId: string | null;
};

export type LabRegister = { id: string; name: string; assignedUserId: string | null };

export type AgentContext = {
  client: ApiClient;
  logger: EventLogger;
  rng: Rng;
  catalog: LabProduct[];
  state: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Host guard
// ---------------------------------------------------------------------------

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * `localhost` y `127.0.0.1` (y `::1`) son el mismo loopback, pero
 * `assertAllowedWriteHost` compara literal. Devuelve true si ambos hosts son
 * loopback o si son iguales (case-insensitive).
 */
export function isLoopbackEquivalent(hostA: string, hostB: string | undefined): boolean {
  const a = hostA.trim().toLowerCase();
  const b = hostB?.trim().toLowerCase() ?? "";
  if (!a || !b) return false;
  if (a === b) return true;
  return LOOPBACK_HOSTS.has(a) && LOOPBACK_HOSTS.has(b);
}

/**
 * Valida que `url` apunte al host permitido para escrituras del laboratorio,
 * aceptando equivalencias de loopback. Devuelve el hostname.
 */
export function assertLabApiHost(url: string, allowedHost: string | undefined): string {
  let hostname = "";
  try {
    hostname = new URL(url.trim()).hostname;
  } catch {
    hostname = "";
  }
  if (hostname && isLoopbackEquivalent(hostname, allowedHost)) {
    return hostname;
  }
  // Mismo mensaje/regla que el resto del laboratorio (regla 1.4).
  return assertAllowedWriteHost(url, allowedHost);
}

export function labApiUrl(): string {
  return process.env.STOCK_LAB_API_URL ?? DEFAULT_LAB_API_URL;
}

/** Cliente HTTP contra el BFF del laboratorio; lanza si el host no es el permitido. */
export function createLabClient(): ApiClient {
  const url = labApiUrl();
  const env = loadStockLabEnv();
  assertLabApiHost(url, env.STOCK_TEST_ALLOW_WRITES_HOST);
  return new ApiClient(url);
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export function describeError(res: ApiResponse): string {
  const error = res.body?.error;
  if (error && typeof error === "object") {
    const rec = error as JsonRecord;
    const code = typeof rec.code === "string" ? rec.code : "";
    const message = typeof rec.message === "string" ? rec.message : "";
    return [code, message].filter(Boolean).join(" ") || JSON.stringify(error);
  }
  if (typeof error === "string") return error;
  return res.body ? JSON.stringify(res.body) : "(sin cuerpo)";
}

export async function loginAs(client: ApiClient, key: LabRoleKey): Promise<void> {
  const user = LAB_USERS[key];
  const res = await client.login(user.email, LAB_PASSWORD);
  if (!res.ok) {
    throw new Error(`loginAs(${key}) falló con ${res.status}: ${describeError(res)}`);
  }
}

// ---------------------------------------------------------------------------
// Catálogo
// ---------------------------------------------------------------------------

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

export type PackInfo = { unitsPerPack: number; unitProductId: string };

/** Mapea un item de `GET /api/products` a LabProduct; null si no tiene id/sku. */
export function mapLabProduct(
  raw: unknown,
  packsByPackId: ReadonlyMap<string, PackInfo> = new Map(),
): LabProduct | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as JsonRecord;
  const id = asString(rec.id);
  const sku = asString(rec.sku);
  if (!id || !sku) return null;
  const pack = packsByPackId.get(id);
  return {
    id,
    sku,
    name: asString(rec.name) ?? "",
    isActive: rec.isActive !== false,
    currentStock: asNumber(rec.currentStock),
    salePrice: asNumber(rec.salePriceRef ?? rec.salePrice),
    isHot: sku.startsWith(HOT_SKU_PREFIX),
    packUnitsPerPack: pack?.unitsPerPack ?? null,
    packUnitProductId: pack?.unitProductId ?? null,
  };
}

/** Mapea `GET /api/inventory/pack-conversions` (`packProduct.id` → unidad). */
export function mapPackConversions(items: unknown[]): Map<string, PackInfo> {
  const out = new Map<string, PackInfo>();
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const rec = raw as JsonRecord;
    const packProduct = rec.packProduct as JsonRecord | undefined;
    const unitProduct = (rec.unitProduct ?? rec.linkedProduct) as JsonRecord | undefined;
    const packId = asString(packProduct?.id) ?? asString(rec.packProductId);
    const unitId = asString(unitProduct?.id) ?? asString(rec.unitProductId);
    const unitsPerPack = asNumber(rec.unitsPerPack);
    if (!packId || !unitId || unitsPerPack <= 0) continue;
    out.set(packId, { unitsPerPack, unitProductId: unitId });
  }
  return out;
}

const CATALOG_PAGE_SIZE = 100;
const CATALOG_MAX_PAGES = 1000;

/**
 * Catálogo completo de la tienda (activos e inactivos: sin `isActive` el API
 * devuelve ambos), paginando de 100 en 100 hasta `total`. Rellena los datos de
 * empaque desde pack-conversions; si el rol no puede verlos (403) quedan null.
 */
export async function fetchCatalog(client: ApiClient): Promise<LabProduct[]> {
  const rawItems: unknown[] = [];
  let skip = 0;
  for (let page = 0; page < CATALOG_MAX_PAGES; page += 1) {
    const res = await client.request(`/api/products?limit=${CATALOG_PAGE_SIZE}&skip=${skip}`);
    if (!res.ok) {
      throw new Error(`fetchCatalog: GET /api/products devolvió ${res.status}: ${describeError(res)}`);
    }
    const items = unwrapList(res);
    rawItems.push(...items);
    const data = res.body?.data as JsonRecord | undefined;
    const total = asNumber(data?.total, Number.NaN);
    skip += items.length;
    if (items.length === 0 || (Number.isFinite(total) && skip >= total)) break;
  }

  let packs = new Map<string, PackInfo>();
  const packRes = await client.request("/api/inventory/pack-conversions");
  if (packRes.ok) {
    packs = mapPackConversions(unwrapList(packRes));
  }

  const catalog: LabProduct[] = [];
  for (const raw of rawItems) {
    const product = mapLabProduct(raw, packs);
    if (product) catalog.push(product);
  }
  return catalog;
}

/** Mapea un item de `GET /api/cash/registers`; null si no tiene id. */
export function mapLabRegister(raw: unknown): LabRegister | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as JsonRecord;
  const id = asString(rec.id);
  if (!id) return null;
  return {
    id,
    name: asString(rec.name) ?? "",
    assignedUserId: asString(rec.assignedUserId),
  };
}

export async function fetchRegisters(client: ApiClient): Promise<LabRegister[]> {
  const res = await client.request("/api/cash/registers");
  if (!res.ok) {
    throw new Error(`fetchRegisters: GET /api/cash/registers devolvió ${res.status}: ${describeError(res)}`);
  }
  const out: LabRegister[] = [];
  for (const raw of unwrapList(res)) {
    const register = mapLabRegister(raw);
    if (register) out.push(register);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Bucle
// ---------------------------------------------------------------------------

export type RunLoopOptions = {
  /** Donde registrar los `agent_error` (status 0). Sin logger → stderr. */
  logger?: EventLogger;
  /** Pausa tras un error de `step` para no quemar CPU en bucle (ms). */
  errorDelayMs?: number;
  /** Reloj inyectable (tests). */
  now?: () => number;
};

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : JSON.stringify(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

/**
 * Ejecuta `step` hasta `args.ops` iteraciones o hasta que pasen `args.minutes`
 * (lo que ocurra antes si están ambos). Un error de `step` no mata al agente:
 * se registra como evento `op: "agent_error"`, status 0. Devuelve el nº de
 * iteraciones ejecutadas.
 */
export async function runLoop(
  args: AgentArgs,
  step: (i: number) => Promise<void>,
  options: RunLoopOptions = {},
): Promise<number> {
  if (args.ops === undefined && args.minutes === undefined) {
    throw new Error("runLoop: se necesita ops o minutes.");
  }
  const now = options.now ?? Date.now;
  const errorDelayMs = options.errorDelayMs ?? 250;
  const deadline = args.minutes !== undefined ? now() + args.minutes * 60_000 : Number.POSITIVE_INFINITY;
  const maxOps = args.ops ?? Number.POSITIVE_INFINITY;

  let iterations = 0;
  while (iterations < maxOps && now() < deadline) {
    const index = iterations;
    try {
      await step(index);
    } catch (error) {
      const message = errorMessage(error);
      if (options.logger) {
        options.logger.log({
          op: "agent_error",
          payload: { iteration: index },
          status: 0,
          response_id: null,
          expected_delta: {},
          error: message,
        });
      } else {
        console.error(`[runLoop] iteración ${index}: ${message}`);
      }
      if (errorDelayMs > 0) {
        await sleep(errorDelayMs);
      }
    }
    iterations += 1;
  }
  return iterations;
}

// ---------------------------------------------------------------------------
// Idempotencia
// ---------------------------------------------------------------------------

/** UUID v4 válido derivado de 4 llamadas a `rng.next()` (determinista por semilla). */
export function idempotencyKey(rng: Rng): string {
  const bytes = new Uint8Array(16);
  for (let word = 0; word < 4; word += 1) {
    const value = Math.floor(rng.next() * 0x1_0000_0000) >>> 0;
    bytes[word * 4] = (value >>> 24) & 0xff;
    bytes[word * 4 + 1] = (value >>> 16) & 0xff;
    bytes[word * 4 + 2] = (value >>> 8) & 0xff;
    bytes[word * 4 + 3] = value & 0xff;
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40; // versión 4
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // variante RFC 4122
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
