/**
 * Base compartida de las suites `hypotheses` y `oneshots` (STK-403, plan
 * stock-integrity fase 4): conexión pg con guarda de host, sesiones BFF y
 * Supabase (anon key + login) como usuarios lab, lecturas de las vistas de
 * integridad filtradas a los productos del caso y escritura de resultados en
 * el formato de `phase4-contracts.md`.
 *
 * Solo toca la base LOCAL del laboratorio (`loadStockLabEnv` +
 * `assertAllowedWriteHost`). Nunca lee `.env` / `.env.local`.
 */
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";

import { ApiClient, type ApiResponse, type JsonRecord } from "../../e2e-bodegon/client";
import { LAB_PASSWORD, LAB_USERS, assertLabApiHost, describeError, labApiUrl, type LabRoleKey } from "../agents/base";
import { assertAllowedWriteHost, loadStockLabEnv } from "../env";

// ---------------------------------------------------------------------------
// Tipos del contrato de resultados
// ---------------------------------------------------------------------------

export type Verdict = "pass" | "fail" | "finding" | "error" | "skip";
export type HypothesisVerdict = "confirmada" | "descartada" | "no_reproducible";
export type SuiteName = "hypotheses" | "oneshots";

export const VERDICTS: readonly Verdict[] = ["pass", "fail", "finding", "error", "skip"];

export const INTEGRITY_VIEWS = [
  "stock_reconciliation",
  "stock_chain_breaks",
  "sales_without_movements",
  "purchases_without_movements",
  "movements_without_document",
  "reversal_mismatches",
  "conversion_mismatches",
  "negative_stock",
  "cross_store_movements",
] as const;

export type IntegrityView = (typeof INTEGRITY_VIEWS)[number];
export type ViewCounts = Record<IntegrityView, number>;

export type Step = {
  op: string;
  as: string;
  status: number;
  response_id: string | null;
  ms: number;
  error?: string;
};

export type CaseOutcome = {
  verdict: Verdict;
  /** Si falta se deriva del veredicto (`defaultHypothesisVerdict`). */
  hypothesis_verdict?: HypothesisVerdict;
  detail: string;
  expected: unknown;
  actual: unknown;
  evidence: string[];
};

export type CaseResult = {
  ts: string;
  suite: SuiteName;
  id: string;
  title: string;
  hypothesis: string[];
  steps: Step[];
  expected: unknown;
  actual: unknown;
  reconcile_scoped: Partial<ViewCounts>;
  reconcile_global: Partial<ViewCounts>;
  verdict: Verdict;
  hypothesis_verdict: HypothesisVerdict;
  detail: string;
  evidence: string[];
};

export type CaseDef = {
  id: string;
  title: string;
  hypothesis: string[];
  run: (lab: Lab, t: CaseCtx) => Promise<CaseOutcome>;
};

// ---------------------------------------------------------------------------
// Lógica pura (cubierta por jest, sin red ni base)
// ---------------------------------------------------------------------------

export type SuiteArgs = { run: string; only: string[] | null; list: boolean; out: string | null };

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** `YYYYMMDD-HHmmss-<suite>` en hora local. */
export function defaultRunId(suite: SuiteName, now: Date = new Date()): string {
  const date = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`;
  const time = `${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
  return `${date}-${time}-${suite}`;
}

/** `--run <id>` · `--only a,b` · `--list` · `--out <dir de runs>`. Lanza ante un flag desconocido o sin valor. */
export function parseSuiteArgs(argv: readonly string[], suite: SuiteName, now: Date = new Date()): SuiteArgs {
  const args: SuiteArgs = { run: defaultRunId(suite, now), only: null, list: false, out: null };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--list") {
      args.list = true;
      continue;
    }
    if (flag === "--run" || flag === "--only" || flag === "--out") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`Falta el valor de ${flag}.`);
      }
      i += 1;
      if (flag === "--run") {
        if (!/^[A-Za-z0-9._-]+$/.test(value)) throw new Error(`--run inválido: "${value}".`);
        args.run = value;
      } else if (flag === "--only") {
        args.only = value
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean);
      } else {
        args.out = value;
      }
      continue;
    }
    throw new Error(`Flag desconocido: ${String(flag)}.`);
  }
  return args;
}

/** `only` casa por id exacto o por prefijo de segmento (`os.20260821` → `os.20260821.sql_replica`). */
export function selectCases<T extends { id: string }>(cases: readonly T[], only: readonly string[] | null): T[] {
  if (!only || only.length === 0) return [...cases];
  return cases.filter((c) => only.some((want) => c.id === want || c.id.startsWith(`${want}.`)));
}

/** Sufijo de SKU único por corrida (los SKU se guardan en minúsculas). */
export function runTag(run: string, entropy: string): string {
  const clean = run.toLowerCase().replace(/[^a-z0-9]/g, "").slice(-10);
  return `${clean}${entropy.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 6)}`;
}

export function is2xx(status: number): boolean {
  return status >= 200 && status < 300;
}

export function is4xx(status: number): boolean {
  return status >= 400 && status < 500;
}

/**
 * Acumulador de aserciones de un caso. `eq`/`ok` son duras (→ `fail`);
 * `finding` es blanda (→ `finding` si no hay ninguna dura rota).
 */
export class Checks {
  readonly failures: string[] = [];
  readonly findings: string[] = [];
  readonly notes: string[] = [];

  eq(label: string, actual: unknown, expected: unknown): boolean {
    const same = JSON.stringify(actual) === JSON.stringify(expected);
    if (!same) {
      this.failures.push(`${label}: esperado ${JSON.stringify(expected)}, obtenido ${JSON.stringify(actual)}`);
    }
    return same;
  }

  ok(label: string, condition: boolean, info = ""): boolean {
    if (!condition) this.failures.push(info ? `${label}: ${info}` : label);
    return condition;
  }

  finding(label: string, condition: boolean, info = ""): boolean {
    if (!condition) this.findings.push(info ? `${label}: ${info}` : label);
    return condition;
  }

  note(text: string): void {
    this.notes.push(text);
  }

  /**
   * Una operación que un sistema sano rechaza: 2xx = fallo duro; 5xx = hallazgo
   * (rechaza, pero con error interno en vez de 4xx); 4xx = correcto.
   */
  rejected(label: string, status: number, message = ""): boolean {
    if (is2xx(status)) {
      this.failures.push(`${label}: se aceptó (${status}) y debía rechazarse`);
      return false;
    }
    if (!is4xx(status)) {
      this.findings.push(`${label}: rechazó con ${status}${message ? ` "${message}"` : ""} en vez de 4xx`);
    }
    return true;
  }

  verdict(): Verdict {
    if (this.failures.length > 0) return "fail";
    if (this.findings.length > 0) return "finding";
    return "pass";
  }

  detail(): string {
    return [...this.failures, ...this.findings, ...this.notes].join(" | ");
  }
}

/** `fail` = el bug se reprodujo; `pass`/`finding` = el escenario lo descarta; el resto no prueba nada. */
export function defaultHypothesisVerdict(verdict: Verdict): HypothesisVerdict {
  if (verdict === "fail") return "confirmada";
  if (verdict === "pass" || verdict === "finding") return "descartada";
  return "no_reproducible";
}

/**
 * Veredicto por hipótesis: `confirmada` si algún caso la confirma; `descartada`
 * si al menos un caso la descarta y ninguno la confirma; si no, `no_reproducible`.
 */
export function aggregateHypotheses(
  results: ReadonlyArray<Pick<CaseResult, "hypothesis" | "hypothesis_verdict">>,
): Record<string, HypothesisVerdict> {
  const out: Record<string, HypothesisVerdict> = {};
  for (const result of results) {
    for (const hypothesis of result.hypothesis) {
      const previous = out[hypothesis];
      const current = result.hypothesis_verdict;
      if (previous === "confirmada" || current === "confirmada") {
        out[hypothesis] = "confirmada";
      } else if (previous === "descartada" || current === "descartada") {
        out[hypothesis] = "descartada";
      } else {
        out[hypothesis] = "no_reproducible";
      }
    }
  }
  return out;
}

export function countVerdicts(results: ReadonlyArray<Pick<CaseResult, "verdict">>): Record<Verdict, number> {
  const counts: Record<Verdict, number> = { pass: 0, fail: 0, finding: 0, error: 0, skip: 0 };
  for (const result of results) counts[result.verdict] += 1;
  return counts;
}

export function formatCounts(counts: Record<Verdict, number>): string {
  return VERDICTS.map((verdict) => `${verdict}=${counts[verdict]}`).join(" ");
}

function hypothesisOrder(a: string, b: string): number {
  return Number(a.replace(/\D/g, "")) - Number(b.replace(/\D/g, "")) || a.localeCompare(b);
}

function mdCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function nonZero(counts: Partial<ViewCounts>): string {
  const parts = Object.entries(counts)
    .filter(([, value]) => typeof value === "number" && value !== 0)
    .map(([name, value]) => `${name}=${String(value)}`);
  return parts.length > 0 ? parts.join(" ") : "0";
}

export function renderMarkdown(suite: SuiteName, run: string, results: readonly CaseResult[]): string {
  const lines: string[] = [`# ${suite} · run ${run}`, "", formatCounts(countVerdicts(results)), ""];
  const aggregate = aggregateHypotheses(results);
  const keys = Object.keys(aggregate).sort(hypothesisOrder);
  if (keys.length > 0) {
    lines.push("| Hipótesis | Veredicto | Casos |", "|---|---|---|");
    for (const key of keys) {
      const ids = results
        .filter((result) => result.hypothesis.includes(key))
        .map((result) => `${result.id}:${result.verdict}`);
      lines.push(`| ${key} | ${aggregate[key] ?? ""} | ${mdCell(ids.join(", "))} |`);
    }
    lines.push("");
  }
  lines.push("| id | hipótesis | verdict | hypothesis_verdict | vistas (mis productos) | detalle |", "|---|---|---|---|---|---|");
  for (const result of results) {
    lines.push(
      `| ${result.id} | ${result.hypothesis.join(",")} | ${result.verdict} | ${result.hypothesis_verdict} | ` +
        `${mdCell(nonZero(result.reconcile_scoped))} | ${mdCell(result.detail)} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

// --- cadena stock_after ----------------------------------------------------

export type ChainMove = { id: string; quantity_delta: number; stock_after: number };

export type ChainClass = "sana" | "artefacto_orden" | "rotura_real";

export type ChainAnalysis = {
  /** Roturas en el orden recibido (el de la vista: created_at, id). */
  orderBreaks: number;
  ledger: number;
  /** Existe algún orden de los mismos movimientos en el que la cadena cierra. */
  reorderable: boolean;
  /** En ese orden la cadena termina en `currentStock`. */
  endsAtCurrentStock: boolean;
  classification: ChainClass;
};

/**
 * Decide si las roturas de `stock_chain_breaks` de un producto son reales o un
 * artefacto del orden `created_at, id`.
 *
 * Cada movimiento es una arista `stock_after - quantity_delta → stock_after`.
 * Los movimientos se pueden reordenar en una cadena sin saltos si y solo si ese
 * multigrafo dirigido tiene un camino euleriano (grados balanceados salvo un
 * inicio y un fin, y aristas conexas). Si además el camino termina en
 * `current_stock`, ninguna escritura se perdió ni se inventó: la "rotura" solo
 * dice que el orden de commit no fue el de `created_at`. Un decremento perdido
 * (dos `5→4`), una escritura directa de `current_stock` o un `stock_after`
 * inventado rompen el balance de grados o la conexión → `rotura_real`.
 */
export function analyzeChain(moves: readonly ChainMove[], currentStock: number): ChainAnalysis {
  let orderBreaks = 0;
  let ledger = 0;
  const out = new Map<number, number>();
  const parent = new Map<number, number>();
  const find = (node: number): number => {
    let root = node;
    while (parent.get(root) !== undefined && parent.get(root) !== root) root = parent.get(root) as number;
    return root;
  };
  const touch = (node: number) => {
    if (!parent.has(node)) parent.set(node, node);
    if (!out.has(node)) out.set(node, 0);
  };

  moves.forEach((move, index) => {
    ledger += move.quantity_delta;
    const previous = index > 0 ? moves[index - 1] : undefined;
    if (previous && move.stock_after !== previous.stock_after + move.quantity_delta) orderBreaks += 1;
    const from = move.stock_after - move.quantity_delta;
    const to = move.stock_after;
    touch(from);
    touch(to);
    out.set(from, (out.get(from) ?? 0) + 1);
    out.set(to, (out.get(to) ?? 0) - 1);
    parent.set(find(from), find(to));
  });

  const starts: number[] = [];
  const ends: number[] = [];
  let balanced = true;
  for (const [node, degree] of out) {
    if (degree === 1) starts.push(node);
    else if (degree === -1) ends.push(node);
    else if (degree !== 0) balanced = false;
  }
  const roots = new Set([...parent.keys()].map(find));
  const connected = roots.size <= 1;
  const shape = (starts.length === 1 && ends.length === 1) || (starts.length === 0 && ends.length === 0);
  const reorderable = moves.length === 0 || (balanced && connected && shape);

  let endsAtCurrentStock: boolean;
  if (moves.length === 0) endsAtCurrentStock = true;
  else if (!reorderable) endsAtCurrentStock = false;
  else if (ends.length === 1) endsAtCurrentStock = ends[0] === currentStock;
  // Circuito: empieza y termina en el stock previo al primer movimiento.
  else endsAtCurrentStock = out.has(currentStock);

  const last = moves[moves.length - 1];
  let classification: ChainClass;
  if (orderBreaks === 0 && (last === undefined || last.stock_after === currentStock)) classification = "sana";
  else if (reorderable && endsAtCurrentStock) classification = "artefacto_orden";
  else classification = "rotura_real";

  return { orderBreaks, ledger, reorderable, endsAtCurrentStock, classification };
}

// --- payloads --------------------------------------------------------------

export type SaleLineInput = { productId: string; quantity: number; unitPriceRef?: number };

export type SaleBodyOptions = {
  customerId: string;
  exchangeRateId: string | null;
  rateVes: number;
  /** `true` = un pago `efectivo_usd` por el total; o la lista de pagos tal cual. */
  payments?: true | unknown[];
  clientRequestId?: string | null;
  notes?: string;
};

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function saleTotalRef(lines: readonly SaleLineInput[]): number {
  return round2(lines.reduce((sum, line) => sum + line.quantity * (line.unitPriceRef ?? 1), 0));
}

/** Cuerpo de `POST /api/sales` (precio de línea 1 REF por defecto, sin IVA ni descuento). */
export function buildSaleBody(lines: readonly SaleLineInput[], options: SaleBodyOptions): JsonRecord {
  const body: JsonRecord = {
    customerId: options.customerId,
    ...(options.exchangeRateId ? { exchangeRateId: options.exchangeRateId } : {}),
    refRateVes: options.rateVes,
    items: lines.map((line) => ({
      productId: line.productId,
      quantity: line.quantity,
      unitPriceRef: line.unitPriceRef ?? 1,
    })),
    taxRef: 0,
    discountRef: 0,
    notes: options.notes ?? "S403",
  };
  if (options.clientRequestId) body.clientRequestId = options.clientRequestId;
  if (options.payments === true) {
    body.payments = [{ method: "efectivo_usd", currency: "USD", amount: saleTotalRef(lines) }];
  } else if (Array.isArray(options.payments)) {
    body.payments = options.payments;
  }
  return body;
}

export type PurchaseLineInput =
  | { productId: string; quantity: number; unitCostRef?: number }
  | { productId: string; packCount: number; unitsPerPack: number; unitCostRef?: number; quantity?: number };

export type PurchaseBodyOptions = {
  supplierId: string;
  status: "pedido" | "recibido";
  exchangeRateId: string | null;
  rateVes: number;
  notes?: string;
};

/** Unidades que un sistema sano debe ingresar por una línea de compra. */
export function purchaseLineUnits(line: PurchaseLineInput): number {
  return "packCount" in line ? line.packCount * line.unitsPerPack : line.quantity;
}

/** Cuerpo de `POST /api/purchases` con todos los totales (costo 1 REF por unidad por defecto, sin IVA). */
export function buildPurchaseBody(lines: readonly PurchaseLineInput[], options: PurchaseBodyOptions): JsonRecord {
  const items = lines.map((line) => {
    const unitCostRef = line.unitCostRef ?? 1;
    const unitCostVes = round2(unitCostRef * options.rateVes);
    const subtotalRef = round2(purchaseLineUnits(line) * unitCostRef);
    const common = {
      productId: line.productId,
      unitCostRef,
      unitCostVes,
      costCurrency: "ref",
      taxRate: 0,
      taxRef: 0,
      taxVes: 0,
      subtotalRef,
      subtotalVes: round2(subtotalRef * options.rateVes),
    };
    if ("packCount" in line) {
      const packCostRef = round2(unitCostRef * line.unitsPerPack);
      return {
        entryMode: "pack",
        ...common,
        packLabel: `Bulto x${line.unitsPerPack}`,
        packCount: line.packCount,
        unitsPerPack: line.unitsPerPack,
        packCostRef,
        packCostVes: round2(packCostRef * options.rateVes),
        ...(line.quantity !== undefined ? { quantity: line.quantity } : {}),
      };
    }
    return { entryMode: "unit", ...common, quantity: line.quantity };
  });
  const subtotalRef = round2(items.reduce((sum, item) => sum + item.subtotalRef, 0));
  return {
    supplierId: options.supplierId,
    status: options.status,
    ...(options.exchangeRateId ? { exchangeRateId: options.exchangeRateId } : {}),
    refRateVes: options.rateVes,
    notes: options.notes ?? "S403",
    subtotalRef,
    subtotalVes: round2(items.reduce((sum, item) => sum + item.subtotalVes, 0)),
    taxRef: 0,
    taxVes: 0,
    discountRef: 0,
    discountVes: 0,
    items,
  };
}

// ---------------------------------------------------------------------------
// Runtime: base, BFF y Supabase del laboratorio
// ---------------------------------------------------------------------------

export type Movement = {
  id: string;
  product_id: string;
  type: string;
  quantity_delta: number;
  stock_after: number;
  created_at: string;
  sale_id: string | null;
  purchase_id: string | null;
  conversion_id: string | null;
  store_id: string | null;
};

export type LabProductRef = { id: string; sku: string };

export type RestResult = {
  data: unknown;
  error: { message: string; code?: string } | null;
  status: number;
};

type Row = Record<string, unknown>;

const RUNS_DIR = resolve(__dirname, "..", "runs");
const RATE_CACHE_MS = 2000;

export function idOf(res: ApiResponse): string | null {
  const data = res.body?.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const id = (data as JsonRecord).id;
  return typeof id === "string" ? id : null;
}

export function dataOf(res: ApiResponse): JsonRecord {
  const data = res.body?.data;
  return data && typeof data === "object" && !Array.isArray(data) ? (data as JsonRecord) : {};
}

export function errorOf(res: ApiResponse): string {
  return res.ok ? "" : describeError(res);
}

export function fmtMove(move: Movement): string {
  return `mov ${move.id} ${move.type} delta=${move.quantity_delta} stock_after=${move.stock_after} created_at=${move.created_at}`;
}

function messageOf(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? `${code} ${error.message}` : error.message;
  }
  return typeof error === "string" ? error : JSON.stringify(error);
}

/** Dentro de una transacción ya abierta: el resto de sentencias corren como ese usuario (RLS incluida). */
export async function actAs(client: Client, userId: string | null): Promise<void> {
  await client.query(userId ? "set local role authenticated" : "set local role anon");
  await client.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify(userId ? { sub: userId, role: "authenticated" } : { role: "anon" }),
  ]);
}

export class Lab {
  readonly db: Client;
  readonly tag: string;
  readonly apiUrl: string;
  readonly supabaseUrl: string;
  storeId = "";
  defaultStoreId = "";
  customerId = "";
  supplierId = "";
  uids: Record<LabRoleKey, string> = { admin: "", vendedor1: "", vendedor2: "", almacen: "", contador: "" };
  httpRequests = 0;

  private readonly anonKey: string;
  private readonly serviceRoleKey: string;
  private readonly dbUrl: string;
  private readonly apis = new Map<LabRoleKey, ApiClient>();
  private readonly supas = new Map<LabRoleKey, SupabaseClient>();
  private readonly extraDbs: Client[] = [];
  private rateCache: { at: number; id: string | null; rateVes: number } | null = null;
  private skuSeq = 0;

  private constructor(run: string) {
    const file = loadStockLabEnv();
    const get = (key: string): string => {
      const value = process.env[key] ?? file[key];
      if (!value) throw new Error(`${key} no está definida (process.env o .env.stock-lab).`);
      return value;
    };
    // El host permitido sale solo del archivo lab, nunca del entorno heredado (C21).
    const allowed = file.STOCK_TEST_ALLOW_WRITES_HOST;
    this.dbUrl = get("STOCK_LAB_DB_URL");
    this.supabaseUrl = file.NEXT_PUBLIC_SUPABASE_URL ?? "";
    this.anonKey = file.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
    this.serviceRoleKey = file.SUPABASE_SERVICE_ROLE_KEY ?? "";
    if (!this.supabaseUrl || !this.anonKey || !this.serviceRoleKey) {
      throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL / ANON_KEY / SERVICE_ROLE_KEY en .env.stock-lab.");
    }
    // Regla 1.4: las tres puertas (pg, PostgREST, BFF) deben ser el host local permitido.
    assertAllowedWriteHost(this.dbUrl, allowed);
    assertAllowedWriteHost(this.supabaseUrl, allowed);
    this.apiUrl = labApiUrl();
    assertLabApiHost(this.apiUrl, allowed);
    this.db = new Client({ connectionString: this.dbUrl, connectionTimeoutMillis: 10_000 });
    this.tag = runTag(run, Date.now().toString(36).slice(-6));
  }

  static async open(run: string): Promise<Lab> {
    const lab = new Lab(run);
    await lab.db.connect();
    const stores = await lab.db.query<{ id: string; slug: string }>(
      "select id, slug from public.stores where slug in ('lab', 'default')",
    );
    lab.storeId = stores.rows.find((row) => row.slug === "lab")?.id ?? "";
    lab.defaultStoreId = stores.rows.find((row) => row.slug === "default")?.id ?? "";
    if (!lab.storeId) throw new Error("No existe la tienda `lab`: falta el seed del laboratorio.");
    if (!lab.defaultStoreId) throw new Error("No existe la tienda `default`.");
    const users = await lab.db.query<{ id: string; email: string }>(
      "select u.id, u.email from auth.users u join public.profiles p on p.id = u.id where p.store_id = $1",
      [lab.storeId],
    );
    for (const key of Object.keys(LAB_USERS) as LabRoleKey[]) {
      const id = users.rows.find((row) => row.email === LAB_USERS[key].email)?.id;
      if (!id) throw new Error(`Falta el usuario lab ${LAB_USERS[key].email}.`);
      lab.uids[key] = id;
    }
    const customer = await lab.db.query<{ id: string }>(
      "select id from public.contacts where store_id = $1 and is_pos_default limit 1",
      [lab.storeId],
    );
    const supplier = await lab.db.query<{ id: string }>(
      "select id from public.contacts where store_id = $1 and type in ('proveedor', 'ambos') and is_active order by created_at limit 1",
      [lab.storeId],
    );
    lab.customerId = customer.rows[0]?.id ?? "";
    lab.supplierId = supplier.rows[0]?.id ?? "";
    if (!lab.customerId || !lab.supplierId) throw new Error("Faltan el cliente POS por defecto o un proveedor en la tienda lab.");
    return lab;
  }

  async close(): Promise<void> {
    for (const extra of this.extraDbs) await extra.end().catch(() => undefined);
    await this.db.end().catch(() => undefined);
  }

  // --- sesiones ---

  /** Sesión BFF nueva (cookie-jar propio) como el usuario lab. */
  async newApi(role: LabRoleKey): Promise<ApiClient> {
    const client = new ApiClient(this.apiUrl);
    this.httpRequests += 1;
    const res = await client.login(LAB_USERS[role].email, LAB_PASSWORD);
    if (!res.ok) throw new Error(`login BFF ${role}: ${res.status} ${describeError(res)}`);
    return client;
  }

  async api(role: LabRoleKey): Promise<ApiClient> {
    const cached = this.apis.get(role);
    if (cached) return cached;
    const client = await this.newApi(role);
    this.apis.set(role, client);
    return client;
  }

  private bareSupabase(key: string): SupabaseClient {
    return createClient(this.supabaseUrl, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  /** Cliente PostgREST con la anon key y sin sesión (rol `anon`). */
  anon(): SupabaseClient {
    return this.bareSupabase(this.anonKey);
  }

  /** Cliente con la service role key: SOLO para el Auth admin API local. */
  service(): SupabaseClient {
    return this.bareSupabase(this.serviceRoleKey);
  }

  /** Sesión Supabase (anon key + login) para llamar RPC/tablas como un usuario real. */
  async newSupa(email: string, password: string = LAB_PASSWORD): Promise<SupabaseClient> {
    const client = this.bareSupabase(this.anonKey);
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw new Error(`signInWithPassword(${email}): ${error.message}`);
    return client;
  }

  async supa(role: LabRoleKey): Promise<SupabaseClient> {
    const cached = this.supas.get(role);
    if (cached) return cached;
    const client = await this.newSupa(LAB_USERS[role].email);
    this.supas.set(role, client);
    return client;
  }

  /** Conexión pg adicional (transacciones intercaladas). Se cierra en `close`. */
  async pg(): Promise<Client> {
    const client = new Client({ connectionString: this.dbUrl, connectionTimeoutMillis: 10_000 });
    await client.connect();
    this.extraDbs.push(client);
    return client;
  }

  // --- lecturas ---

  async rows<T extends Row = Row>(text: string, params: unknown[] = []): Promise<T[]> {
    return (await this.db.query<T>(text, params)).rows;
  }

  async stock(productId: string): Promise<number> {
    const rows = await this.rows<{ current_stock: number }>(
      "select current_stock from public.products where id = $1",
      [productId],
    );
    const row = rows[0];
    if (!row) throw new Error(`Producto ${productId} no existe.`);
    return row.current_stock;
  }

  async stocks(productIds: readonly string[]): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const id of productIds) out[id] = await this.stock(id);
    return out;
  }

  /** Movimientos del producto en el orden de `stock_chain_breaks` (created_at, id). */
  async movements(productId: string): Promise<Movement[]> {
    return this.rows<Movement>(
      `select id, product_id, type::text as type, quantity_delta, stock_after, created_at::text as created_at,
              sale_id, purchase_id, conversion_id, store_id
       from public.stock_movements where product_id = $1 order by created_at, id`,
      [productId],
    );
  }

  async viewRows(view: IntegrityView, productIds: readonly string[]): Promise<Row[]> {
    if (productIds.length === 0) return [];
    const filter =
      view === "conversion_mismatches"
        ? "pack_product_id = any($1::uuid[]) or unit_product_id = any($1::uuid[])"
        : "product_id = any($1::uuid[])";
    return this.rows(`select * from public.${view} where ${filter}`, [productIds]);
  }

  /** Conteo de las 9 vistas filtrado a los productos dados. */
  async scoped(productIds: readonly string[]): Promise<ViewCounts> {
    const out = {} as ViewCounts;
    for (const view of INTEGRITY_VIEWS) out[view] = (await this.viewRows(view, productIds)).length;
    return out;
  }

  async global(): Promise<Partial<ViewCounts>> {
    const rows = await this.rows<{ report: Partial<ViewCounts> | null }>(
      "select public.stock_integrity_report($1::uuid) as report",
      [this.storeId],
    );
    return rows[0]?.report ?? {};
  }

  /** Tasa vigente leída del API (caché de 2 s para ráfagas en paralelo). */
  async rate(): Promise<{ id: string | null; rateVes: number }> {
    const now = Date.now();
    if (this.rateCache && now - this.rateCache.at < RATE_CACHE_MS) return this.rateCache;
    const client = await this.api("almacen");
    this.httpRequests += 1;
    const res = await client.request("/api/exchange-rates/current");
    const data = dataOf(res);
    const rateVes = Number(data.rateVes);
    if (!res.ok || !Number.isFinite(rateVes) || rateVes <= 0) {
      throw new Error(`GET /api/exchange-rates/current: ${res.status} ${describeError(res)}`);
    }
    this.rateCache = { at: now, id: typeof data.id === "string" ? data.id : null, rateVes };
    return this.rateCache;
  }

  nextSku(caseKey: string): string {
    this.skuSeq += 1;
    return `s403-${this.tag}-${caseKey}-${this.skuSeq}`.toLowerCase();
  }
}

/** Contexto de un caso: registra pasos y los productos propios (para filtrar las vistas). */
export class CaseCtx {
  readonly steps: Step[] = [];
  readonly products = new Set<string>();
  readonly key: string;

  constructor(
    readonly lab: Lab,
    caseId: string,
  ) {
    this.key = caseId.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 24);
  }

  track(...ids: string[]): void {
    for (const id of ids) this.products.add(id);
  }

  private push(op: string, as: string, status: number, started: number, responseId: string | null, error?: string): void {
    this.steps.push({ op, as, status, response_id: responseId, ms: Date.now() - started, ...(error ? { error } : {}) });
  }

  /** Request al BFF como el usuario lab (sesión cacheada salvo que se pase `client`). */
  async http(as: LabRoleKey, method: string, path: string, body?: unknown, client?: ApiClient): Promise<ApiResponse> {
    const api = client ?? (await this.lab.api(as));
    const started = Date.now();
    this.lab.httpRequests += 1;
    const res = await api.request(path, body === undefined ? { method } : { method, body: JSON.stringify(body) });
    this.push(`${method} ${path}`, as, res.status, started, idOf(res), res.ok ? undefined : describeError(res));
    return res;
  }

  /** Llamada PostgREST (RPC o tabla) con un cliente Supabase ya autenticado. */
  async rest(as: string, op: string, call: PromiseLike<RestResult>): Promise<RestResult> {
    const started = Date.now();
    const res = await call;
    const error = res.error ? `${res.error.code ?? ""} ${res.error.message}`.trim() : undefined;
    this.push(op, as, res.status, started, null, error);
    // PGRST2xx = la función/firma no existe para PostgREST: el escenario está mal montado, no es un rechazo del sistema.
    if (res.error?.code?.startsWith("PGRST2")) throw new Error(`${op}: ${error ?? ""}`);
    return res;
  }

  /** RPC por PostgREST como usuario lab (anon key + sesión). */
  async rpc(as: LabRoleKey, fn: string, args: Record<string, unknown>): Promise<RestResult> {
    const client = await this.lab.supa(as);
    return this.rest(as, `rpc ${fn}`, client.rpc(fn, args));
  }

  /** SQL como `postgres` (superusuario): fixtures y corrupciones deliberadas. `status` 0 = ok, -1 = error. */
  async sql<T extends Row = Row>(label: string, text: string, params: unknown[] = [], client?: Client): Promise<T[]> {
    const started = Date.now();
    try {
      const result = await (client ?? this.lab.db).query<T>(text, params);
      this.push(`SQL ${label}`, "postgres", 0, started, null);
      return result.rows;
    } catch (error) {
      this.push(`SQL ${label}`, "postgres", -1, started, null, messageOf(error));
      throw error;
    }
  }

  /** Igual que `sql` pero devuelve el error en vez de lanzarlo (para probar guardas). */
  async trySql<T extends Row = Row>(
    label: string,
    text: string,
    params: unknown[] = [],
    client?: Client,
  ): Promise<{ rows: T[]; rowCount: number; error: string | null }> {
    const started = Date.now();
    try {
      const result = await (client ?? this.lab.db).query<T>(text, params);
      this.push(`SQL ${label}`, "postgres", 0, started, null);
      return { rows: result.rows, rowCount: result.rowCount ?? 0, error: null };
    } catch (error) {
      const message = messageOf(error);
      this.push(`SQL ${label}`, "postgres", -1, started, null, message);
      return { rows: [], rowCount: 0, error: message };
    }
  }

  /**
   * Producto propio del caso. Se inserta con stock 0 y el stock inicial entra por
   * el camino real: RPC `adjust_stock(inventario_inicial)` como lab-admin.
   * Con `store: "default"` se crea en la otra tienda (stock + movimiento por SQL).
   */
  async product(
    name: string,
    stock: number,
    options: { store?: "lab" | "default"; price?: number } = {},
  ): Promise<LabProductRef> {
    const lab = this.lab;
    const sku = lab.nextSku(`${this.key}-${name}`);
    const storeId = options.store === "default" ? lab.defaultStoreId : lab.storeId;
    const rows = await this.sql<{ id: string }>(
      `fixture producto ${sku}`,
      `insert into public.products (store_id, sku, name, sale_price_ref, current_cost_ref, current_stock, min_stock, is_active)
       values ($1, $2, $3, $4, 1, 0, 0, true) returning id`,
      [storeId, sku, `S403 ${sku}`, options.price ?? 1],
    );
    const id = rows[0]?.id;
    if (!id) throw new Error(`No se pudo crear el producto ${sku}.`);
    this.track(id);
    if (stock > 0 && options.store === "default") {
      await this.sql(
        `fixture stock inicial ${sku} (tienda default)`,
        `with moved as (
           insert into public.stock_movements (product_id, type, quantity_delta, stock_after, reason, store_id)
           values ($1, 'inventario_inicial', $2, $2, 'S403 fixture', $3) returning product_id
         )
         update public.products set current_stock = $2 where id = (select product_id from moved)`,
        [id, stock, storeId],
      );
    } else if (stock > 0) {
      const res = await this.rpc("admin", "adjust_stock", {
        p_product_id: id,
        p_quantity_delta: stock,
        p_reason: "S403 inventario inicial",
        p_type: "inventario_inicial",
      });
      if (res.error) throw new Error(`adjust_stock inicial de ${sku}: ${res.error.message}`);
    }
    return { id, sku };
  }

  /** `GET /api/cash/session`; si no hay sesión abierta la abre. Nunca la cierra. */
  async ensureCash(as: "vendedor1" | "vendedor2"): Promise<void> {
    const current = await this.http(as, "GET", "/api/cash/session");
    if (!current.ok) throw new Error(`GET /api/cash/session (${as}): ${current.status} ${describeError(current)}`);
    if (idOf(current)) return;
    const registers = await this.lab.rows<{ id: string }>(
      "select id from public.cash_registers where store_id = $1 and assigned_user_id = $2 and is_active limit 1",
      [this.lab.storeId, this.lab.uids[as]],
    );
    const registerId = registers[0]?.id;
    if (!registerId) throw new Error(`No hay caja asignada a ${as}.`);
    const opened = await this.http(as, "POST", "/api/cash/session/open", { registerId, openingVes: 0, openingRef: 0 });
    if (!opened.ok) throw new Error(`No se pudo abrir la caja de ${as}: ${opened.status} ${describeError(opened)}`);
  }

  /** Venta por el BFF. Con `pay` usa el RPC atómico (y exige caja abierta). */
  async sale(
    as: "vendedor1" | "vendedor2",
    lines: readonly SaleLineInput[],
    options: { pay?: boolean; payments?: unknown[]; clientRequestId?: string | null; client?: ApiClient } = {},
  ): Promise<ApiResponse> {
    const rate = await this.lab.rate();
    const withPayments = options.pay === true || options.payments !== undefined;
    const clientRequestId =
      options.clientRequestId === undefined ? (withPayments ? randomUUID() : null) : options.clientRequestId;
    const body = buildSaleBody(lines, {
      customerId: this.lab.customerId,
      exchangeRateId: rate.id,
      rateVes: rate.rateVes,
      payments: options.payments ?? (options.pay ? true : undefined),
      clientRequestId,
      notes: `S403 ${this.key}`,
    });
    return this.http(as, "POST", "/api/sales", body, options.client);
  }

  /** Compra por el BFF (admin o almacén). */
  async purchase(
    as: "admin" | "almacen",
    status: "pedido" | "recibido",
    lines: readonly PurchaseLineInput[],
    client?: ApiClient,
  ): Promise<ApiResponse> {
    const rate = await this.lab.rate();
    const body = buildPurchaseBody(lines, {
      supplierId: this.lab.supplierId,
      status,
      exchangeRateId: rate.id,
      rateVes: rate.rateVes,
      notes: `S403 ${this.key}`,
    });
    return this.http(as, "POST", "/api/purchases", body, client);
  }

  adjust(as: "admin" | "almacen", productId: string, quantityDelta: number, type?: string): Promise<ApiResponse> {
    return this.http(as, "POST", "/api/inventory/adjustments", {
      productId,
      quantityDelta,
      ...(type ? { type } : {}),
      reason: `S403 ${this.key}`,
    });
  }

  /** Vistas de integridad filtradas a los productos del caso. */
  scoped(): Promise<ViewCounts> {
    return this.lab.scoped([...this.products]);
  }
}

/** Exige 2xx y devuelve el id; si no, lanza (el caso queda en `error`: no pudo montarse). */
export function mustId(res: ApiResponse, what: string): string {
  const id = idOf(res);
  if (!res.ok || !id) throw new Error(`${what}: ${res.status} ${describeError(res)}`);
  return id;
}

export function skip(detail: string): CaseOutcome {
  return { verdict: "skip", detail, expected: null, actual: null, evidence: [] };
}

/** Cierra un caso a partir de sus aserciones. */
export function outcome(
  checks: Checks,
  parts: { expected: unknown; actual: unknown; evidence?: string[]; hypothesis_verdict?: HypothesisVerdict },
): CaseOutcome {
  return {
    verdict: checks.verdict(),
    ...(parts.hypothesis_verdict ? { hypothesis_verdict: parts.hypothesis_verdict } : {}),
    detail: checks.detail(),
    expected: parts.expected,
    actual: parts.actual,
    evidence: parts.evidence ?? [],
  };
}

// ---------------------------------------------------------------------------
// Runner de suite (CLI)
// ---------------------------------------------------------------------------

export function buildResult(
  suite: SuiteName,
  def: Pick<CaseDef, "id" | "title" | "hypothesis">,
  steps: Step[],
  out: CaseOutcome,
  scoped: Partial<ViewCounts>,
  global: Partial<ViewCounts>,
  now: Date = new Date(),
): CaseResult {
  return {
    ts: now.toISOString(),
    suite,
    id: def.id,
    title: def.title,
    hypothesis: def.hypothesis,
    steps,
    expected: out.expected,
    actual: out.actual,
    reconcile_scoped: scoped,
    reconcile_global: global,
    verdict: out.verdict,
    hypothesis_verdict: out.hypothesis_verdict ?? defaultHypothesisVerdict(out.verdict),
    detail: out.detail,
    evidence: out.evidence,
  };
}

/**
 * Ejecuta los casos en serie y escribe `runs/<run>/<suite>.jsonl|md`.
 * Devuelve el exit code: 0 si recorrió todos los casos (aunque haya `fail`),
 * 1 solo si no pudo arrancar.
 */
export async function runSuite(suite: SuiteName, cases: readonly CaseDef[], argv: readonly string[]): Promise<number> {
  let args: SuiteArgs;
  try {
    args = parseSuiteArgs(argv, suite);
  } catch (error) {
    console.error(messageOf(error));
    return 1;
  }
  if (args.list) {
    for (const def of cases) console.log(def.id);
    return 0;
  }
  const selected = selectCases(cases, args.only);
  let lab: Lab;
  try {
    lab = await Lab.open(args.run);
  } catch (error) {
    console.error(`${suite}: no pudo arrancar: ${messageOf(error)}`);
    return 1;
  }
  const dir = resolve(args.out ?? RUNS_DIR, args.run);
  const jsonlPath = resolve(dir, `${suite}.jsonl`);
  const results: CaseResult[] = [];
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(jsonlPath, "");
    for (const def of selected) {
      const ctx = new CaseCtx(lab, def.id);
      let out: CaseOutcome;
      try {
        out = await def.run(lab, ctx);
      } catch (error) {
        out = { verdict: "error", detail: messageOf(error), expected: null, actual: null, evidence: [] };
      }
      let scoped: Partial<ViewCounts> = {};
      let global: Partial<ViewCounts> = {};
      try {
        scoped = await ctx.scoped();
        global = await lab.global();
      } catch (error) {
        out = { ...out, detail: `${out.detail} | vistas ilegibles: ${messageOf(error)}`.trim() };
      }
      const result = buildResult(suite, def, ctx.steps, out, scoped, global);
      results.push(result);
      appendFileSync(jsonlPath, `${JSON.stringify(result)}\n`);
      console.log(`${result.id} ${result.verdict}`);
    }
    writeFileSync(resolve(dir, `${suite}.md`), renderMarkdown(suite, args.run, results));
    console.log(`${suite} ${args.run}: ${formatCounts(countVerdicts(results))} · bff_requests=${lab.httpRequests}`);
  } finally {
    await lab.close();
  }
  return 0;
}
