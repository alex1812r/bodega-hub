/**
 * Ola de carga del plan stock-integrity §9.13 (STK-411): N operaciones a ritmo
 * constante con varios usuarios lab, latencia por request y reconcile al final.
 *
 *   npm run stock-lab:load -- --ops 1000 --seconds 120 [--concurrency 16]
 *       [--mix create_sale=62,adjust=6,…] [--seed 411] [--run <id>] [--out <dir>]
 *
 * Mezcla por defecto: mayoría de ventas con pago (`create_sale_with_payments`),
 * más ventas pendientes, cancelaciones, devoluciones, compras, pedidos,
 * recepciones y ajustes, sobre productos propios (`C411-<run>-…-load-NN`) y los
 * sembrados calientes (`LAB-HOT-*`).
 *
 * Salida: `<out>/<run>/load.json` y `load.md`. Exit 0 si completó la ola; 1 si
 * no pudo arrancar. La agregación y los percentiles son funciones puras
 * (`load.test.ts`).
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";

import type { ApiClient, ApiResponse, JsonRecord } from "../../e2e-bodegon/client";
import { type LabRoleKey, describeError } from "../agents/base";
import { type Rng, createRng } from "../agents/rng";
import { INTEGRITY_VIEW_NAMES, type IntegrityReport } from "../integrity-views";
import {
  type Lab,
  PLAN_CASES,
  type Rate,
  type SaleLineInput,
  type ScopedIntegrity,
  type Verdict,
  cleanupOwnProducts,
  closeLab,
  currentRate,
  defaultRunId,
  formatCleanup,
  globalIntegrity,
  integrityProblems,
  is2xx,
  is4xx,
  openLab,
  purchaseBody,
  saleBody,
  scopedIntegrity,
  seedProducts,
  session,
} from "./cases";

// ===========================================================================
// Lógica pura
// ===========================================================================

export const OP_KINDS = [
  "create_sale",
  "sale_pending",
  "cancel_sale",
  "return_sale",
  "purchase",
  "purchase_order",
  "receive",
  "adjust",
] as const;

export type OpKind = (typeof OP_KINDS)[number];
export type Mix = Record<OpKind, number>;

/** Pesos por defecto (suman 100): mayoría ventas con pago. */
export const DEFAULT_MIX: Mix = {
  create_sale: 62,
  sale_pending: 6,
  cancel_sale: 5,
  return_sale: 5,
  purchase: 8,
  purchase_order: 4,
  receive: 4,
  adjust: 6,
};

export type LoadArgs = {
  ops: number;
  seconds: number;
  concurrency: number;
  mix: Mix;
  seed: number;
  runId: string | null;
  out: string | null;
};

function isOpKind(value: string): value is OpKind {
  return (OP_KINDS as readonly string[]).includes(value);
}

/** `create_sale=70,adjust=10` → pesos; las operaciones no nombradas quedan en 0. */
export function parseMix(text: string): Mix {
  const mix = {} as Mix;
  for (const kind of OP_KINDS) mix[kind] = 0;
  for (const part of text.split(",")) {
    const [rawKind, rawWeight] = part.split("=").map((s) => s.trim());
    if (!rawKind) continue;
    if (!isOpKind(rawKind)) throw new Error(`--mix: operación desconocida "${rawKind}" (válidas: ${OP_KINDS.join(", ")})`);
    const weight = Number(rawWeight);
    if (!Number.isFinite(weight) || weight < 0) throw new Error(`--mix: peso inválido para ${rawKind}`);
    mix[rawKind] = weight;
  }
  if (OP_KINDS.every((kind) => mix[kind] === 0)) throw new Error("--mix: todos los pesos son 0");
  return mix;
}

export function parseLoadArgs(argv: readonly string[]): LoadArgs {
  const args: LoadArgs = { ops: 1000, seconds: 120, concurrency: 16, mix: { ...DEFAULT_MIX }, seed: 411, runId: null, out: null };
  const positiveInt = (name: string, raw: string): number => {
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1) throw new Error(`${name} debe ser un entero >= 1`);
    return value;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = (): string => {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) throw new Error(`Falta el valor de ${arg}`);
      i += 1;
      return value;
    };
    if (arg === "--ops") args.ops = positiveInt("--ops", next());
    else if (arg === "--seconds") args.seconds = positiveInt("--seconds", next());
    else if (arg === "--concurrency") args.concurrency = positiveInt("--concurrency", next());
    else if (arg === "--seed") args.seed = positiveInt("--seed", next());
    else if (arg === "--mix") args.mix = parseMix(next());
    else if (arg === "--run") args.runId = next();
    else if (arg === "--out") args.out = next();
    else throw new Error(`Argumento desconocido: ${arg}`);
  }
  if (args.runId !== null && !/^[A-Za-z0-9._-]+$/.test(args.runId)) {
    throw new Error("--run solo admite letras, números, punto, guion y guion bajo");
  }
  return args;
}

/** Reparto exacto de `ops` según los pesos (restos mayores primero; empates por orden de OP_KINDS). */
export function allocateOps(ops: number, mix: Mix): Record<OpKind, number> {
  const totalWeight = OP_KINDS.reduce((sum, kind) => sum + mix[kind], 0);
  const out = {} as Record<OpKind, number>;
  if (totalWeight <= 0) throw new Error("allocateOps: la mezcla no tiene peso");
  const remainders: { kind: OpKind; rest: number }[] = [];
  let assigned = 0;
  for (const kind of OP_KINDS) {
    const exact = (ops * mix[kind]) / totalWeight;
    out[kind] = Math.floor(exact);
    assigned += out[kind];
    remainders.push({ kind, rest: exact - out[kind] });
  }
  remainders.sort((a, b) => b.rest - a.rest);
  for (let i = 0; assigned < ops; i += 1, assigned += 1) {
    const target = remainders[i % remainders.length];
    if (target) out[target.kind] += 1;
  }
  return out;
}

/** Secuencia determinista de operaciones: reparto exacto + barajado con semilla. */
export function buildSchedule(ops: number, mix: Mix, seed: number): OpKind[] {
  const counts = allocateOps(ops, mix);
  const sequence: OpKind[] = [];
  for (const kind of OP_KINDS) for (let i = 0; i < counts[kind]; i += 1) sequence.push(kind);
  return createRng(seed).shuffle(sequence);
}

/** Percentil por rango más cercano (nearest-rank) sobre una copia ordenada; vacío → 0. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const clamped = Math.min(100, Math.max(0, p));
  const rank = Math.max(1, Math.ceil((clamped / 100) * sorted.length));
  return sorted[rank - 1] ?? 0;
}

export type Sample = { op: string; status: number; ms: number; error?: string };

export type OpStats = {
  n: number;
  s2xx: number;
  s4xx: number;
  s5xx: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  mean: number;
  /** Requests por segundo sobre la duración total de la ola. */
  throughput: number;
};

const round1 = (value: number): number => Math.round(value * 10) / 10;

export function statsOf(samples: readonly Sample[], elapsedMs: number): OpStats {
  const ms = samples.map((s) => s.ms);
  const n = samples.length;
  const s2xx = samples.filter((s) => is2xx(s.status)).length;
  const s4xx = samples.filter((s) => is4xx(s.status)).length;
  return {
    n,
    s2xx,
    s4xx,
    // Todo lo que no es 2xx ni 4xx (5xx y sin respuesta = status 0) cuenta como fallo de servidor.
    s5xx: n - s2xx - s4xx,
    p50: round1(percentile(ms, 50)),
    p95: round1(percentile(ms, 95)),
    p99: round1(percentile(ms, 99)),
    max: round1(ms.length > 0 ? Math.max(...ms) : 0),
    mean: round1(n > 0 ? ms.reduce((sum, v) => sum + v, 0) / n : 0),
    throughput: elapsedMs > 0 ? Math.round((n / (elapsedMs / 1000)) * 100) / 100 : 0,
  };
}

export type LoadSummary = { byOp: Record<string, OpStats>; total: OpStats };

/** Estadísticas por operación (en orden de aparición) y totales. */
export function summarize(samples: readonly Sample[], elapsedMs: number): LoadSummary {
  const groups = new Map<string, Sample[]>();
  for (const sample of samples) {
    const list = groups.get(sample.op) ?? [];
    list.push(sample);
    groups.set(sample.op, list);
  }
  const byOp: Record<string, OpStats> = {};
  for (const [op, list] of groups) byOp[op] = statsOf(list, elapsedMs);
  return { byOp, total: statsOf(samples, elapsedMs) };
}

export type ErrorBucket = { op: string; status: number; message: string; count: number };

/** Respuestas no 2xx agrupadas por operación, código y mensaje (uuids y números de documento normalizados). */
export function topErrors(samples: readonly Sample[], limit = 20): ErrorBucket[] {
  const buckets = new Map<string, ErrorBucket>();
  for (const sample of samples) {
    if (is2xx(sample.status)) continue;
    const message = (sample.error ?? "")
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>")
      .replace(/\d{6,}/g, "<n>")
      .slice(0, 160);
    const key = `${sample.op}|${sample.status}|${message}`;
    const bucket = buckets.get(key) ?? { op: sample.op, status: sample.status, message, count: 0 };
    bucket.count += 1;
    buckets.set(key, bucket);
  }
  return [...buckets.values()].sort((a, b) => b.count - a.count).slice(0, limit);
}

export type LoadJudgement = { verdict: Verdict; detail: string };

/**
 * 9.13: `reconcile` en 0. La ola solo toca sus productos propios y los
 * calientes sembrados, así que el veredicto sale de las vistas filtradas a esos
 * dos grupos (con el chequeo exacto de cadena en vez de `stock_chain_breaks`).
 * El reporte global se documenta: si creció fuera de esos productos no lo pudo
 * causar la ola (base compartida durante el desarrollo).
 */
export function judgeLoad(
  scopedOwn: ScopedIntegrity,
  scopedHot: ScopedIntegrity,
  globalBefore: IntegrityReport,
  globalAfter: IntegrityReport,
  createSale: OpStats | undefined,
): LoadJudgement {
  const problems = [
    ...integrityProblems(scopedOwn).map((p) => `propios ${p}`),
    ...integrityProblems(scopedHot).map((p) => `calientes ${p}`),
  ];
  const grown: string[] = [];
  for (const name of INTEGRITY_VIEW_NAMES) {
    const grew = globalAfter[name] - globalBefore[name];
    if (grew > 0) grown.push(`${name} +${grew}`);
  }
  const p95 = createSale ? `p95 de create_sale = ${createSale.p95} ms (n=${createSale.n}, 5xx=${createSale.s5xx})` : "sin muestras de create_sale";
  const global =
    grown.length > 0
      ? `Reporte global durante la ola: ${grown.join(", ")} (stock_chain_breaks tiene falsos positivos G9; lo demás, si los productos de la ola están en 0, viene de otros procesos sobre la misma base)`
      : "Reporte global sin crecer";
  if (problems.length > 0) return { verdict: "fail", detail: `reconcile NO queda en 0: ${problems.join(", ")}. ${p95}. ${global}.` };
  if (!createSale || createSale.n === 0) return { verdict: "error", detail: `La ola no ejecutó ninguna venta. ${global}.` };
  return { verdict: "pass", detail: `reconcile en 0 sobre los productos de la ola (propios y calientes). ${p95}. ${global}.` };
}

export type LoadReport = {
  runId: string;
  suite: "load";
  id: "9.13";
  title: string;
  severity: string;
  expected: string;
  startedAt: string;
  args: Omit<LoadArgs, "runId" | "out">;
  elapsedMs: number;
  throughput: number;
  scheduleLagMs: { p50: number; p95: number; max: number };
  summary: LoadSummary;
  errors: ErrorBucket[];
  products: { own: number; hot: number; ownSkuPrefix: string };
  reconcile_scoped: ScopedIntegrity;
  reconcile_scoped_hot: ScopedIntegrity;
  reconcile_global_before: IntegrityReport;
  reconcile_global: IntegrityReport;
  verdict: Verdict;
  detail: string;
};

function statsRow(op: string, s: OpStats): string {
  return `| ${op} | ${s.n} | ${s.s2xx} | ${s.s4xx} | ${s.s5xx} | ${s.p50} | ${s.p95} | ${s.p99} | ${s.max} | ${s.throughput} |`;
}

export function renderLoadMarkdown(report: LoadReport): string {
  const out = [
    `# Carga (9.13) — run \`${report.runId}\``,
    "",
    `Veredicto: **${report.verdict}** — ${report.detail}`,
    "",
    `Plan: ${report.args.ops} operaciones en ${report.args.seconds} s, concurrencia ${report.args.concurrency}, semilla ${report.args.seed}. ` +
      `Real: ${report.summary.total.n} requests en ${(report.elapsedMs / 1000).toFixed(1)} s (${report.throughput} req/s). ` +
      `Retraso de planificación p95 ${report.scheduleLagMs.p95} ms (máx. ${report.scheduleLagMs.max} ms).`,
    "",
    "Latencias en ms (performance.now alrededor del fetch, incluye BFF + PostgREST + RPC).",
    "",
    "| operación | n | 2xx | 4xx | 5xx | p50 | p95 | p99 | max | req/s |",
    "|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const [op, stats] of Object.entries(report.summary.byOp)) out.push(statsRow(op, stats));
  out.push(statsRow("**total**", report.summary.total), "");
  if (report.errors.length > 0) {
    out.push("## Respuestas no 2xx", "", "| operación | status | n | mensaje |", "|---|---|---|---|");
    for (const e of report.errors) out.push(`| ${e.op} | ${e.status} | ${e.count} | ${e.message.replace(/\|/g, "\\|")} |`);
    out.push("");
  }
  out.push("## Reconcile", "", "| vista | propios | calientes (LAB-HOT) | global antes | global después |", "|---|---|---|---|---|");
  for (const name of INTEGRITY_VIEW_NAMES) {
    out.push(
      `| ${name} | ${report.reconcile_scoped[name]} | ${report.reconcile_scoped_hot[name]} | ${report.reconcile_global_before[name]} | ${report.reconcile_global[name]} |`,
    );
  }
  out.push(
    `| chain_inconsistent (chequeo exacto) | ${report.reconcile_scoped.chain_inconsistent} | ${report.reconcile_scoped_hot.chain_inconsistent} | – | – |`,
    "",
  );
  return out.join("\n");
}

// ===========================================================================
// Ejecución (I/O)
// ===========================================================================

type LoadProduct = { id: string; price: number; own: boolean };
type Seller = "vendedor1" | "vendedor2";

type LoadState = {
  lab: Lab;
  rng: Rng;
  rate: Rate;
  products: LoadProduct[];
  own: LoadProduct[];
  clients: Record<Extract<LabRoleKey, "vendedor1" | "vendedor2" | "admin" | "almacen">, ApiClient>;
  paidSales: string[];
  pendingSales: string[];
  pendingPurchases: string[];
  samples: Sample[];
};

function responseId(res: ApiResponse): string | null {
  const data = res.body?.data as JsonRecord | undefined;
  return typeof data?.id === "string" ? data.id : null;
}

/** Un request medido con performance.now alrededor del fetch. */
async function timed(state: LoadState, op: OpKind, client: ApiClient, method: string, path: string, body?: unknown): Promise<ApiResponse> {
  const init: RequestInit = { method };
  if (body !== undefined) init.body = JSON.stringify(body);
  const started = performance.now();
  let res: ApiResponse;
  let thrown: string | undefined;
  try {
    res = await client.request(path, init);
  } catch (error) {
    thrown = error instanceof Error ? error.message : String(error);
    res = { ok: false, status: 0, body: null };
  }
  const sample: Sample = { op, status: res.status, ms: performance.now() - started };
  if (!res.ok) sample.error = thrown ?? describeError(res);
  state.samples.push(sample);
  return res;
}

function pickLines(state: LoadState): SaleLineInput[] {
  const count = state.rng.int(1, 3);
  const pool = state.rng.chance(0.7) ? state.own : state.products;
  return state.rng
    .shuffle(pool)
    .slice(0, count)
    .map((p) => ({ productId: p.id, quantity: state.rng.int(1, 3), price: p.price }));
}

function pickSeller(state: LoadState): Seller {
  return state.rng.chance(0.5) ? "vendedor1" : "vendedor2";
}

async function opSale(state: LoadState, paid: boolean): Promise<void> {
  const seller = pickSeller(state);
  const lines = pickLines(state);
  const body = saleBody(state.lab.customerId, state.rate, lines, paid ? { key: randomUUID(), paid: true, notes: "Lab C411 carga" } : { notes: "Lab C411 carga" });
  const res = await timed(state, paid ? "create_sale" : "sale_pending", state.clients[seller], "POST", "/api/sales", body);
  const id = responseId(res);
  if (res.ok && id) (paid ? state.paidSales : state.pendingSales).push(id);
}

async function opPurchase(state: LoadState, status: "pedido" | "recibido"): Promise<void> {
  const actor = state.rng.chance(0.5) ? "admin" : "almacen";
  const lines = state.rng
    .shuffle(state.products)
    .slice(0, state.rng.int(1, 2))
    .map((p) => ({ productId: p.id, quantity: state.rng.int(5, 20), cost: 0.5 }));
  const body = purchaseBody(state.lab.supplierId, state.rate, lines, status, "Lab C411 carga");
  const res = await timed(state, status === "pedido" ? "purchase_order" : "purchase", state.clients[actor], "POST", "/api/purchases", body);
  const id = responseId(res);
  if (status === "pedido" && res.ok && id) state.pendingPurchases.push(id);
}

/** Ejecuta la operación planificada; si su cola está vacía, la que la alimenta (y se mide con esa etiqueta). */
async function execute(state: LoadState, kind: OpKind): Promise<void> {
  if (kind === "create_sale") return opSale(state, true);
  if (kind === "sale_pending") return opSale(state, false);
  if (kind === "purchase") return opPurchase(state, "recibido");
  if (kind === "purchase_order") return opPurchase(state, "pedido");
  if (kind === "cancel_sale") {
    const id = state.pendingSales.shift();
    if (!id) return opSale(state, false);
    await timed(state, "cancel_sale", state.clients[pickSeller(state)], "PATCH", `/api/sales/${id}/cancel`);
    return;
  }
  if (kind === "return_sale") {
    const id = state.paidSales.shift();
    if (!id) return opSale(state, true);
    await timed(state, "return_sale", state.clients[pickSeller(state)], "POST", `/api/sales/${id}/return`);
    return;
  }
  if (kind === "receive") {
    const id = state.pendingPurchases.shift();
    if (!id) return opPurchase(state, "pedido");
    await timed(state, "receive", state.clients.almacen, "PATCH", `/api/purchases/${id}/receive`);
    return;
  }
  const product = state.rng.pick(state.own);
  const quantityDelta = state.rng.chance(0.7) ? state.rng.int(1, 5) : -state.rng.int(1, 3);
  await timed(state, "adjust", state.clients[state.rng.chance(0.5) ? "admin" : "almacen"], "POST", "/api/inventory/adjustments", {
    productId: product.id,
    quantityDelta,
    type: quantityDelta > 0 ? "ajuste_entrada" : "ajuste_salida",
    reason: "Lab C411 carga",
  });
}

const OWN_PRODUCTS = 24;
const OWN_STOCK = 5000;
const RATE_REFRESH_MS = 10_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, Math.max(0, ms)));
}

async function runLoad(args: LoadArgs, runId: string): Promise<LoadReport> {
  const lab = await openLab(runId);
  try {
    const own = (await seedProducts(lab, "load", OWN_PRODUCTS, { stock: OWN_STOCK })).map((p) => ({ id: p.id, price: p.price, own: true }));
    const hotRows = await lab.db.query<{ id: string; price: number }>(
      "select id, sale_price_ref::float8 as price from public.products where store_id = $1 and is_active and upper(sku) like 'LAB-HOT-%' and current_stock > 0 order by sku",
      [lab.storeId],
    );
    const hot = hotRows.rows.map((r) => ({ id: r.id, price: r.price, own: false }));
    const state: LoadState = {
      lab,
      rng: createRng(args.seed),
      rate: await currentRate(lab),
      products: [...own, ...hot],
      own,
      clients: {
        vendedor1: await session(lab, "vendedor1"),
        vendedor2: await session(lab, "vendedor2"),
        admin: await session(lab, "admin"),
        almacen: await session(lab, "almacen"),
      },
      paidSales: [],
      pendingSales: [],
      pendingPurchases: [],
      samples: [],
    };
    const schedule = buildSchedule(args.ops, args.mix, args.seed);
    const globalBefore = await globalIntegrity(lab.db, lab.storeId);
    const intervalMs = (args.seconds * 1000) / args.ops;
    const inFlight = new Set<Promise<void>>();
    const lags: number[] = [];
    const startedAt = new Date().toISOString();
    const t0 = performance.now();
    let lastRateAt = t0;

    for (let i = 0; i < schedule.length; i += 1) {
      const due = t0 + i * intervalMs;
      await sleep(due - performance.now());
      while (inFlight.size >= args.concurrency) await Promise.race(inFlight);
      if (performance.now() - lastRateAt > RATE_REFRESH_MS) {
        lastRateAt = performance.now();
        state.rate = await currentRate(lab).catch(() => state.rate);
      }
      lags.push(Math.max(0, performance.now() - due));
      const kind = schedule[i];
      if (!kind) continue;
      const task: Promise<void> = execute(state, kind)
        .catch((error: unknown) => {
          state.samples.push({ op: kind, status: 0, ms: 0, error: error instanceof Error ? error.message : String(error) });
        })
        .finally(() => {
          inFlight.delete(task);
        });
      inFlight.add(task);
    }
    await Promise.all(inFlight);
    const elapsedMs = Math.round(performance.now() - t0);

    const summary = summarize(state.samples, elapsedMs);
    const scoped = await scopedIntegrity(lab.db, own.map((p) => p.id));
    const scopedHot = await scopedIntegrity(lab.db, hot.map((p) => p.id));
    const globalAfter = await globalIntegrity(lab.db, lab.storeId);
    const judgement = judgeLoad(scoped, scopedHot, globalBefore, globalAfter, summary.byOp.create_sale);
    const plan = PLAN_CASES["9.13"];
    return {
      runId,
      suite: "load",
      id: "9.13",
      title: plan?.title ?? "",
      severity: plan?.severity ?? "",
      expected: plan?.expected ?? "",
      startedAt,
      args: { ops: args.ops, seconds: args.seconds, concurrency: args.concurrency, mix: args.mix, seed: args.seed },
      elapsedMs,
      throughput: summary.total.throughput,
      scheduleLagMs: { p50: round1(percentile(lags, 50)), p95: round1(percentile(lags, 95)), max: round1(lags.length > 0 ? Math.max(...lags) : 0) },
      summary,
      errors: topErrors(state.samples),
      products: { own: own.length, hot: hot.length, ownSkuPrefix: `C411-${runId}-${lab.nonce}-load-` },
      reconcile_scoped: scoped,
      reconcile_scoped_hot: scopedHot,
      reconcile_global_before: globalBefore,
      reconcile_global: globalAfter,
      verdict: judgement.verdict,
      detail: judgement.detail,
    };
  } finally {
    console.log(formatCleanup(await cleanupOwnProducts(lab)));
    await closeLab(lab);
  }
}

async function main(): Promise<number> {
  const args = parseLoadArgs(process.argv.slice(2));
  const runId = args.runId ?? defaultRunId(new Date(), "load");
  const dir = resolve(args.out ?? resolve(__dirname, "..", "runs"), runId);
  mkdirSync(dir, { recursive: true });
  const report = await runLoad(args, runId);
  writeFileSync(resolve(dir, "load.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(resolve(dir, "load.md"), renderLoadMarkdown(report));
  const sale = report.summary.byOp.create_sale;
  console.log(`9.13 ${report.verdict}`);
  console.log(
    `run=${runId} requests=${report.summary.total.n} 2xx=${report.summary.total.s2xx} 4xx=${report.summary.total.s4xx} 5xx=${report.summary.total.s5xx} ` +
      `create_sale p50=${sale?.p50 ?? 0} p95=${sale?.p95 ?? 0} p99=${sale?.p99 ?? 0} ms → ${resolve(dir, "load.json")}`,
  );
  return 0;
}

if (require.main === module) {
  main()
    .then((code) => {
      process.exit(code);
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}
