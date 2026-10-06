/**
 * Librería de los escenarios deterministas del laboratorio de stock
 * (plan stock-integrity, fase 4, STK-402).
 *
 * Parte pura (testeada en lib.test.ts): formato de resultados del contrato de
 * la fase 4, veredicto por operación (delta esperado vs real), runner que
 * aísla cada caso, argumentos del CLI y render de `<suite>.jsonl` / `.md`.
 *
 * Parte con I/O: `Oracle` (pg contra STOCK_LAB_DB_URL) que fotografía
 * `products.current_stock`, los `stock_movements` y las 9 vistas de integridad
 * filtradas a los productos/documentos del caso, y `CaseHarness.op`, que
 * envuelve CADA operación HTTP con foto antes/después y la evalúa.
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "pg";

import type { ApiClient, ApiResponse, JsonRecord } from "../../e2e-bodegon/client";
import { LAB_USERS, createLabClient, describeError, fetchRegisters, loginAs, type LabRoleKey } from "../agents/base";
import { resolveStockLabDbUrl } from "../db-test-utils";
import { assertAllowedWriteHost, loadStockLabEnv } from "../env";
import { INTEGRITY_VIEW_NAMES, reportFromJson, type IntegrityReport, type IntegrityViewName } from "../integrity-views";

// ---------------------------------------------------------------------------
// Formato de resultados (contrato de la fase 4)
// ---------------------------------------------------------------------------

export type Verdict = "pass" | "fail" | "finding" | "error" | "skip";
export const VERDICTS: readonly Verdict[] = ["pass", "fail", "finding", "error", "skip"];

export type SuiteName = "serial" | "oneshots" | "hypotheses";
export const SUITE_NAMES: readonly SuiteName[] = ["serial", "oneshots", "hypotheses"];

export type MovementSummary = {
  id?: string;
  product_id: string;
  type: string;
  quantity_delta: number;
  stock_after?: number;
  sale_id?: string | null;
  purchase_id?: string | null;
  conversion_id?: string | null;
};

export type StepRecord = {
  op: string;
  as: string;
  status: number;
  response_id: string | null;
  ms: number;
  label?: string;
  payload?: unknown;
  error?: string;
  expected_delta?: Record<string, number>;
  actual_delta?: Record<string, number>;
  issues?: string[];
};

export type ScenarioResult = {
  ts: string;
  suite: string;
  id: string;
  title: string;
  hypothesis: string[];
  steps: StepRecord[];
  expected: { stock_delta: Record<string, number>; movements: MovementSummary[] };
  actual: { stock_delta: Record<string, number>; movements: MovementSummary[] };
  reconcile_scoped: Record<string, number>;
  reconcile_global: Record<string, number>;
  verdict: Verdict;
  detail: string;
  evidence: string[];
};

// ---------------------------------------------------------------------------
// Fotos de la base y expectativas por operación
// ---------------------------------------------------------------------------

export type MovementRow = {
  id: string;
  productId: string;
  type: string;
  quantityDelta: number;
  stockAfter: number;
  saleId: string | null;
  purchaseId: string | null;
  conversionId: string | null;
  createdAt: string;
};

export type DocCounts = { sales: number; purchases: number; payments: number };

export type ScopedViews = Record<IntegrityViewName, unknown[]>;

export type Snapshot = {
  /** current_stock por producto del caso (ausente = el producto aún no existe). */
  stock: Record<string, number>;
  movements: MovementRow[];
  views: ScopedViews;
  docs: DocCounts;
};

export type MovementRefKind = "sale" | "purchase" | "conversion";
export type MovementRef = { kind: MovementRefKind; id: string };

export type ExpectedMovement = { productId: string; type: string; quantityDelta: number };

export type HttpExpectation = "accept" | "reject" | "either";

export type OpExpectation = {
  /** accept = 2xx; reject = 4xx con mensaje y sin efectos; either = cualquiera, pero coherente. */
  http: HttpExpectation;
  /** Delta de current_stock por producto SI la operación se acepta. */
  stockDelta: Record<string, number>;
  /** Movimientos nuevos esperados SI la operación se acepta. */
  movements: ExpectedMovement[];
  /** Documento al que deben apuntar todos los movimientos nuevos (null = ninguno). */
  ref: MovementRef | null;
  /** Con `either`: texto del hallazgo si el sistema acepta / rechaza. */
  findingIfAccepted?: string;
  findingIfRejected?: string;
};

export type IssueSeverity = "fail" | "finding";
export type Issue = { severity: IssueSeverity; check: "a" | "b" | "c" | "d" | "e" | "f" | "docs" | "scenario"; message: string };

export type OpEvaluation = {
  accepted: boolean;
  /** Lo esperado una vez resuelto si la operación debía (o no) tener efecto. */
  effective: { stockDelta: Record<string, number>; movements: ExpectedMovement[] };
  actual: { stockDelta: Record<string, number>; movements: MovementRow[] };
  scopedCounts: Record<IntegrityViewName, number>;
  issues: Issue[];
};

export function emptyViews(): ScopedViews {
  const out = {} as ScopedViews;
  for (const name of INTEGRITY_VIEW_NAMES) out[name] = [];
  return out;
}

export function emptySnapshot(): Snapshot {
  return { stock: {}, movements: [], views: emptyViews(), docs: { sales: 0, purchases: 0, payments: 0 } };
}

export function viewCounts(views: ScopedViews): Record<IntegrityViewName, number> {
  const out = {} as Record<IntegrityViewName, number>;
  for (const name of INTEGRITY_VIEW_NAMES) out[name] = views[name]?.length ?? 0;
  return out;
}

function dropZeros(delta: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(delta)) {
    if (value !== 0) out[key] = value;
  }
  return out;
}

/** Suma `b` sobre `a` (no muta) y descarta los ceros. */
export function addDeltas(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = { ...a };
  for (const [key, value] of Object.entries(b)) out[key] = (out[key] ?? 0) + value;
  return dropZeros(out);
}

/** Delta real de current_stock y movimientos que no existían en `before`. */
export function diffSnapshots(
  before: Snapshot,
  after: Snapshot,
): { stockDelta: Record<string, number>; newMovements: MovementRow[] } {
  const stockDelta: Record<string, number> = {};
  for (const [productId, stock] of Object.entries(after.stock)) {
    stockDelta[productId] = stock - (before.stock[productId] ?? 0);
  }
  for (const [productId, stock] of Object.entries(before.stock)) {
    if (!(productId in after.stock)) stockDelta[productId] = -stock;
  }
  const known = new Set(before.movements.map((movement) => movement.id));
  const newMovements = after.movements.filter((movement) => !known.has(movement.id));
  return { stockDelta: dropZeros(stockDelta), newMovements };
}

function movementKey(movement: ExpectedMovement): string {
  return `${movement.productId}|${movement.type}|${movement.quantityDelta}`;
}

function describeMovements(movements: readonly ExpectedMovement[]): string {
  if (movements.length === 0) return "(ninguno)";
  return movements.map((m) => `${m.type} ${m.quantityDelta > 0 ? "+" : ""}${m.quantityDelta} [${m.productId.slice(0, 8)}]`).join(", ");
}

const REF_COLUMNS: Record<MovementRefKind, "saleId" | "purchaseId" | "conversionId"> = {
  sale: "saleId",
  purchase: "purchaseId",
  conversion: "conversionId",
};

export function isSuccess(status: number): boolean {
  return status >= 200 && status < 300;
}

/**
 * Veredicto de UNA operación HTTP (checks a-f del ticket + documentos huérfanos).
 * Pura: recibe las fotos de antes y después.
 */
export function evaluateOp(input: {
  op: string;
  expect: OpExpectation;
  status: number;
  message: string;
  before: Snapshot;
  after: Snapshot;
}): OpEvaluation {
  const { expect, status, before, after, op } = input;
  const accepted = isSuccess(status);
  const issues: Issue[] = [];
  const message = input.message.trim();
  const hasEffect = expect.http === "reject" ? false : expect.http === "accept" ? true : accepted;
  const effective = {
    stockDelta: hasEffect ? dropZeros(expect.stockDelta) : {},
    movements: hasEffect ? expect.movements.filter((m) => m.quantityDelta !== 0) : [],
  };
  const { stockDelta, newMovements } = diffSnapshots(before, after);
  const moved = Object.keys(stockDelta).length > 0 || newMovements.length > 0;

  // (f) código HTTP
  if (expect.http === "accept" && !accepted) {
    issues.push({ severity: "fail", check: "f", message: `${op}: se esperaba 2xx y respondió ${status} (${message || "sin mensaje"})` });
  } else if (expect.http === "reject" && accepted) {
    issues.push({ severity: "fail", check: "f", message: `${op}: se esperaba un rechazo 4xx y respondió ${status}` });
  } else if (!accepted && expect.http !== "accept") {
    if (status >= 500 || status < 400) {
      issues.push({
        severity: moved ? "fail" : "finding",
        check: "f",
        message: `${op}: rechazo con ${status} en vez de 4xx (${message || "sin mensaje"})${moved ? " y además movió stock" : ""}`,
      });
    } else if (!message) {
      issues.push({ severity: "finding", check: "f", message: `${op}: rechazo ${status} sin mensaje de error` });
    }
  }
  if (expect.http === "either") {
    if (accepted && expect.findingIfAccepted) issues.push({ severity: "finding", check: "f", message: `${op}: ${expect.findingIfAccepted}` });
    if (!accepted && expect.findingIfRejected) {
      issues.push({ severity: "finding", check: "f", message: `${op}: ${expect.findingIfRejected} (${status} ${message})` });
    }
  }

  // (a) delta real de current_stock
  const products = new Set([...Object.keys(effective.stockDelta), ...Object.keys(stockDelta)]);
  for (const productId of products) {
    const want = effective.stockDelta[productId] ?? 0;
    const got = stockDelta[productId] ?? 0;
    if (want !== got) {
      issues.push({
        severity: "fail",
        check: "a",
        message: `${op}: current_stock de ${productId} cambió ${got} y se esperaba ${want} (status ${status})`,
      });
    }
  }

  // (b) suma de quantity_delta de los movimientos nuevos
  const ledger: Record<string, number> = {};
  for (const movement of newMovements) ledger[movement.productId] = (ledger[movement.productId] ?? 0) + movement.quantityDelta;
  const ledgerProducts = new Set([...Object.keys(effective.stockDelta), ...Object.keys(ledger)]);
  for (const productId of ledgerProducts) {
    const want = effective.stockDelta[productId] ?? 0;
    const got = ledger[productId] ?? 0;
    if (want !== got) {
      issues.push({
        severity: "fail",
        check: "b",
        message: `${op}: los movimientos nuevos de ${productId} suman ${got} y se esperaba ${want}`,
      });
    }
  }

  // (c) stock_after del último movimiento = current_stock
  const byProduct = new Map<string, MovementRow[]>();
  for (const movement of newMovements) {
    byProduct.set(movement.productId, [...(byProduct.get(movement.productId) ?? []), movement]);
  }
  for (const [productId, rows] of byProduct) {
    const current = after.stock[productId];
    // created_at es el inicio de la transacción: con varios movimientos del mismo
    // producto en una operación el orden no es fiable; basta con que uno cierre la cadena.
    if (current === undefined || !rows.some((row) => row.stockAfter === current)) {
      issues.push({
        severity: "fail",
        check: "c",
        message: `${op}: stock_after (${rows.map((row) => row.stockAfter).join(",")}) no coincide con current_stock=${String(current)} de ${productId}`,
      });
    }
  }

  // (d) tipo de movimiento y referencia
  const wantKeys = effective.movements.map(movementKey).sort();
  const gotKeys = newMovements.map(movementKey).sort();
  if (wantKeys.join("\n") !== gotKeys.join("\n")) {
    issues.push({
      severity: "fail",
      check: "d",
      message: `${op}: movimientos esperados ${describeMovements(effective.movements)}; reales ${describeMovements(newMovements)}`,
    });
  }
  for (const movement of newMovements) {
    for (const kind of Object.keys(REF_COLUMNS) as MovementRefKind[]) {
      const value = movement[REF_COLUMNS[kind]];
      const want = hasEffect && expect.ref?.kind === kind ? expect.ref.id : null;
      if (value !== want) {
        issues.push({
          severity: "fail",
          check: "d",
          message: `${op}: movimiento ${movement.id} (${movement.type}) tiene ${kind}_id=${String(value)} y se esperaba ${String(want)}`,
        });
      }
    }
  }

  // (e) vistas de integridad filtradas al caso: solo lo que esta operación cambió
  const scopedCounts = viewCounts(after.views);
  const beforeCounts = viewCounts(before.views);
  for (const name of INTEGRITY_VIEW_NAMES) {
    if (scopedCounts[name] > 0 && scopedCounts[name] !== beforeCounts[name]) {
      issues.push({
        severity: "fail",
        check: "e",
        message: `${op}: vista ${name} pasó de ${beforeCounts[name]} a ${scopedCounts[name]} filas para los productos/documentos del caso`,
      });
    }
  }

  // Un rechazo no puede dejar venta, compra ni pago.
  if (!hasEffect) {
    for (const key of ["sales", "purchases", "payments"] as const) {
      if (after.docs[key] !== before.docs[key]) {
        issues.push({
          severity: "fail",
          check: "docs",
          message: `${op}: el rechazo (${status}) dejó ${key} ${before.docs[key]} → ${after.docs[key]}`,
        });
      }
    }
  }

  return { accepted, effective, actual: { stockDelta, movements: newMovements }, scopedCounts, issues };
}

/** fail > finding > pass. */
export function verdictFromIssues(issues: readonly Issue[]): Verdict {
  if (issues.some((issue) => issue.severity === "fail")) return "fail";
  if (issues.some((issue) => issue.severity === "finding")) return "finding";
  return "pass";
}

// ---------------------------------------------------------------------------
// Acumulador y runner de casos
// ---------------------------------------------------------------------------

export type CaseDef<H = unknown> = {
  id: string;
  title: string;
  hypothesis: string[];
  /** Motivo por el que la celda no aplica (se reporta `skip`, nunca se omite). */
  skip?: string;
  run?: (harness: H) => Promise<void>;
};

/** Corta el caso conservando lo evaluado hasta ahí (no es un `error` del escenario). */
export class AbortCase extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AbortCase";
  }
}

function toSummary(movement: MovementRow): MovementSummary {
  return {
    id: movement.id,
    product_id: movement.productId,
    type: movement.type,
    quantity_delta: movement.quantityDelta,
    stock_after: movement.stockAfter,
    sale_id: movement.saleId,
    purchase_id: movement.purchaseId,
    conversion_id: movement.conversionId,
  };
}

function zeroReport(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const name of INTEGRITY_VIEW_NAMES) out[name] = 0;
  return out;
}

export class CaseRecorder {
  readonly steps: StepRecord[] = [];
  readonly issues: Issue[] = [];
  readonly notes: string[] = [];
  readonly evidence: string[] = [];
  private expectedDelta: Record<string, number> = {};
  private actualDelta: Record<string, number> = {};
  private readonly expectedMovements: MovementSummary[] = [];
  private readonly actualMovements: MovementSummary[] = [];
  private scoped: Record<string, number> = zeroReport();
  private global: Record<string, number> = {};

  recordOp(step: StepRecord, evaluation: OpEvaluation, views?: ScopedViews): void {
    this.expectedDelta = addDeltas(this.expectedDelta, evaluation.effective.stockDelta);
    this.actualDelta = addDeltas(this.actualDelta, evaluation.actual.stockDelta);
    for (const movement of evaluation.effective.movements) {
      this.expectedMovements.push({ product_id: movement.productId, type: movement.type, quantity_delta: movement.quantityDelta });
    }
    for (const movement of evaluation.actual.movements) this.actualMovements.push(toSummary(movement));
    this.scoped = { ...evaluation.scopedCounts };
    const record: StepRecord = {
      ...step,
      expected_delta: evaluation.effective.stockDelta,
      actual_delta: evaluation.actual.stockDelta,
    };
    if (evaluation.issues.length > 0) {
      record.issues = evaluation.issues.map((issue) => `[${issue.check}/${issue.severity}] ${issue.message}`);
      this.evidence.push(
        `repro: ${step.op} as ${step.as} payload=${JSON.stringify(step.payload ?? null)} -> ${step.status}${step.error ? ` ${step.error}` : ""}`,
      );
      if (views) {
        for (const name of INTEGRITY_VIEW_NAMES) {
          const rows = views[name];
          if (rows.length > 0) this.evidence.push(`${name}: ${JSON.stringify(rows.slice(0, 2))}`);
        }
      }
    }
    this.steps.push(record);
    this.issues.push(...evaluation.issues);
  }

  setGlobal(report: Record<string, number>): void {
    this.global = { ...report };
  }

  note(text: string): void {
    this.notes.push(text);
  }

  finding(text: string): void {
    this.issues.push({ severity: "finding", check: "scenario", message: text });
  }

  fail(text: string): void {
    this.issues.push({ severity: "fail", check: "scenario", message: text });
  }

  addEvidence(text: string): void {
    this.evidence.push(text);
  }

  build(def: Pick<CaseDef, "id" | "title" | "hypothesis">, suite: string, ts: string, override?: { verdict: Verdict; detail: string }): ScenarioResult {
    const messages = [
      ...this.issues.filter((issue) => issue.severity === "fail").map((issue) => issue.message),
      ...this.issues.filter((issue) => issue.severity === "finding").map((issue) => issue.message),
      ...this.notes,
    ];
    return {
      ts,
      suite,
      id: def.id,
      title: def.title,
      hypothesis: def.hypothesis,
      steps: this.steps,
      expected: { stock_delta: this.expectedDelta, movements: this.expectedMovements },
      actual: { stock_delta: this.actualDelta, movements: this.actualMovements },
      reconcile_scoped: this.scoped,
      reconcile_global: this.global,
      verdict: override?.verdict ?? verdictFromIssues(this.issues),
      detail: override ? [override.detail, ...messages].filter(Boolean).join(" · ") : messages.join(" · "),
      evidence: this.evidence,
    };
  }
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : JSON.stringify(error);
}

export type RunCaseDeps<H> = {
  suite: string;
  now?: () => Date;
  /** Construye el harness del caso alrededor de su recorder. */
  makeHarness: (recorder: CaseRecorder, def: CaseDef<H>) => H | Promise<H>;
};

/**
 * Ejecuta UN caso aislado: una excepción se convierte en `error` (o en el
 * veredicto acumulado si fue un `AbortCase`) y nunca se propaga.
 */
export async function runCase<H>(def: CaseDef<H>, deps: RunCaseDeps<H>): Promise<ScenarioResult> {
  const ts = (deps.now?.() ?? new Date()).toISOString();
  const recorder = new CaseRecorder();
  if (def.skip !== undefined || !def.run) {
    return recorder.build(def, deps.suite, ts, { verdict: "skip", detail: def.skip ?? "caso sin implementación" });
  }
  try {
    const harness = await deps.makeHarness(recorder, def);
    await def.run(harness);
    return recorder.build(def, deps.suite, ts);
  } catch (error) {
    if (error instanceof AbortCase && recorder.issues.length > 0) {
      recorder.note(`caso interrumpido: ${error.message}`);
      return recorder.build(def, deps.suite, ts);
    }
    return recorder.build(def, deps.suite, ts, { verdict: "error", detail: `error del escenario: ${errorText(error)}` });
  }
}

// ---------------------------------------------------------------------------
// CLI y archivos de resultados
// ---------------------------------------------------------------------------

export type SuiteArg = SuiteName | "all";

export type ScenarioArgs = {
  suite: SuiteArg;
  runId: string | null;
  only: string[] | null;
  list: boolean;
  out: string | null;
};

/** Parsea argv (sin node/script). Lanza Error con mensaje claro si algo no cuadra. */
export function parseScenarioArgs(argv: readonly string[]): ScenarioArgs {
  const args: ScenarioArgs = { suite: "all", runId: null, only: null, list: false, out: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = (): string => {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) throw new Error(`Falta el valor de ${arg}`);
      i += 1;
      return value;
    };
    if (arg === "--suite") {
      const value = next();
      if (value !== "all" && !(SUITE_NAMES as readonly string[]).includes(value)) {
        throw new Error(`--suite debe ser ${SUITE_NAMES.join("|")}|all, recibido "${value}"`);
      }
      args.suite = value as SuiteArg;
    } else if (arg === "--run") {
      const value = next();
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) throw new Error(`--run solo admite letras, números, ".", "_" y "-"; recibido "${value}"`);
      args.runId = value;
    } else if (arg === "--only") {
      const ids = next()
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);
      if (ids.length === 0) throw new Error("--only necesita al menos un id");
      args.only = ids;
    } else if (arg === "--list") {
      args.list = true;
    } else if (arg === "--out") {
      args.out = next();
    } else {
      throw new Error(`Argumento desconocido: ${arg}`);
    }
  }
  return args;
}

/** Run id por defecto: `YYYYMMDD-HHmmss-<suite>` en hora local. */
export function defaultScenarioRunId(now: Date, suite: string): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}` +
    `-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}-${suite}`
  );
}

export function suitesFor(suite: SuiteArg): SuiteName[] {
  return suite === "all" ? [...SUITE_NAMES] : [suite];
}

/** Flags que se reenvían a los CLIs de las suites externas (oneshots / hypotheses). */
export function subSuiteArgs(args: ScenarioArgs, runId: string): string[] {
  const out: string[] = [];
  if (args.list) out.push("--list");
  else out.push("--run", runId);
  if (args.only) out.push("--only", args.only.join(","));
  if (args.out && !args.list) out.push("--out", args.out);
  return out;
}

/** Filtra por `--only` conservando el orden de la matriz; devuelve también los ids desconocidos. */
export function selectCases<T extends { id: string }>(cases: readonly T[], only: readonly string[] | null): { selected: T[]; unknown: string[] } {
  if (!only) return { selected: [...cases], unknown: [] };
  const wanted = new Set(only);
  const known = new Set(cases.map((item) => item.id));
  return {
    selected: cases.filter((item) => wanted.has(item.id)),
    unknown: only.filter((id) => !known.has(id)),
  };
}

export function summarize(results: readonly Pick<ScenarioResult, "verdict">[]): Record<Verdict, number> {
  const counts: Record<Verdict, number> = { pass: 0, fail: 0, finding: 0, error: 0, skip: 0 };
  for (const result of results) counts[result.verdict] += 1;
  return counts;
}

export function formatSummary(suite: string, results: readonly Pick<ScenarioResult, "verdict">[]): string {
  const counts = summarize(results);
  return `${suite}: ${results.length} casos · ${VERDICTS.map((verdict) => `${verdict}=${counts[verdict]}`).join(" ")}`;
}

export function resultToJsonLine(result: ScenarioResult): string {
  return `${JSON.stringify(result)}\n`;
}

function mdCell(text: string, max = 400): string {
  const flat = text.replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** `<suite>.md`: resumen por veredicto + una fila por caso. */
export function renderMarkdown(suite: string, runId: string, results: readonly ScenarioResult[]): string {
  const lines = [
    `# ${suite} — run ${runId}`,
    "",
    formatSummary(suite, results),
    "",
    "| id | veredicto | hipótesis | pasos (op → status) | reconcile del caso | detalle |",
    "|---|---|---|---|---|---|",
  ];
  for (const result of results) {
    const steps = result.steps.map((step) => `${step.op} → ${step.status}`).join("; ");
    const scopedTotal = Object.entries(result.reconcile_scoped)
      .filter(([, count]) => count > 0)
      .map(([name, count]) => `${name}=${count}`)
      .join(", ");
    lines.push(
      `| ${mdCell(result.id)} | ${result.verdict} | ${mdCell(result.hypothesis.join(", "))} | ${mdCell(steps, 600)} | ${mdCell(scopedTotal || "0")} | ${mdCell(result.detail)} |`,
    );
  }
  const last = [...results].reverse().find((result) => Object.keys(result.reconcile_global).length > 0);
  if (last) {
    lines.push("", "## stock_integrity_report (tienda lab, tras el último caso)", "", "```json", JSON.stringify(last.reconcile_global), "```");
  }
  return `${lines.join("\n")}\n`;
}

export const DEFAULT_RUNS_DIR = resolve(__dirname, "..", "runs");

/** Escritor incremental: una línea JSONL por caso y el `.md` al cerrar. */
export class SuiteWriter {
  readonly dir: string;
  readonly jsonlPath: string;
  readonly mdPath: string;
  private readonly results: ScenarioResult[] = [];

  constructor(
    readonly suite: string,
    readonly runId: string,
    runsDir: string = DEFAULT_RUNS_DIR,
  ) {
    this.dir = resolve(runsDir, runId);
    this.jsonlPath = resolve(this.dir, `${suite}.jsonl`);
    this.mdPath = resolve(this.dir, `${suite}.md`);
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.jsonlPath, "");
  }

  add(result: ScenarioResult): void {
    this.results.push(result);
    appendFileSync(this.jsonlPath, resultToJsonLine(result));
  }

  close(): ScenarioResult[] {
    writeFileSync(this.mdPath, renderMarkdown(this.suite, this.runId, this.results));
    return this.results;
  }
}

// ---------------------------------------------------------------------------
// SQL del oráculo por caso
// ---------------------------------------------------------------------------

const VIEW_SCOPE: Record<IntegrityViewName, string> = {
  stock_reconciliation: "v.product_id = any($1::uuid[])",
  stock_chain_breaks: "v.product_id = any($1::uuid[])",
  sales_without_movements: "v.product_id = any($1::uuid[]) or v.sale_id = any($2::uuid[])",
  purchases_without_movements: "v.product_id = any($1::uuid[]) or v.purchase_id = any($2::uuid[])",
  movements_without_document: "v.product_id = any($1::uuid[]) or v.sale_id = any($2::uuid[]) or v.purchase_id = any($2::uuid[])",
  reversal_mismatches: "v.product_id = any($1::uuid[]) or v.document_id = any($2::uuid[])",
  conversion_mismatches: "v.pack_product_id = any($1::uuid[]) or v.unit_product_id = any($1::uuid[])",
  negative_stock: "v.product_id = any($1::uuid[])",
  cross_store_movements: "v.product_id = any($1::uuid[]) or v.sale_id = any($2::uuid[]) or v.purchase_id = any($2::uuid[])",
};

/** Una sola consulta con las 9 vistas filtradas: $1 = productos del caso, $2 = ventas/compras del caso. */
export function scopedViewsSql(): string {
  return INTEGRITY_VIEW_NAMES.map(
    (name) => `select '${name}'::text as view_name, to_jsonb(v) as row from public.${name} v where ${VIEW_SCOPE[name]}`,
  ).join("\nunion all\n");
}

export const SNAPSHOT_STOCK_SQL = "select id, current_stock from public.products where id = any($1::uuid[])";

export const SNAPSHOT_MOVEMENTS_SQL =
  "select id, product_id, type::text as type, quantity_delta, stock_after, sale_id, purchase_id, conversion_id, created_at " +
  "from public.stock_movements where product_id = any($1::uuid[]) order by seq, id";

export const SNAPSHOT_DOCS_SQL = `
with s as (select distinct si.sale_id as id from public.sale_items si where si.product_id = any($1::uuid[])),
     p as (select distinct pi.purchase_id as id from public.purchase_items pi where pi.product_id = any($1::uuid[]))
select
  (select count(*) from s)::int as sales,
  (select count(*) from p)::int as purchases,
  (select count(*) from public.payments pay
    where pay.sale_id in (select id from s) or pay.purchase_id in (select id from p))::int as payments`;

type Row = Record<string, unknown>;

function toIso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** Filas de `SNAPSHOT_MOVEMENTS_SQL` → MovementRow. */
export function mapMovementRows(rows: readonly Row[]): MovementRow[] {
  return rows.map((row) => ({
    id: String(row.id),
    productId: String(row.product_id),
    type: String(row.type),
    quantityDelta: Number(row.quantity_delta),
    stockAfter: Number(row.stock_after),
    saleId: nullableString(row.sale_id),
    purchaseId: nullableString(row.purchase_id),
    conversionId: nullableString(row.conversion_id),
    createdAt: toIso(row.created_at),
  }));
}

/** Filas de `scopedViewsSql()` → filas agrupadas por vista. */
export function groupViewRows(rows: readonly Row[]): ScopedViews {
  const out = emptyViews();
  for (const row of rows) {
    const name = String(row.view_name) as IntegrityViewName;
    if (out[name]) out[name].push(row.row);
  }
  return out;
}

// ---------------------------------------------------------------------------
// I/O: oráculo (pg) y sesión del laboratorio
// ---------------------------------------------------------------------------

export class Oracle {
  constructor(
    private readonly db: Client,
    readonly storeId: string,
  ) {}

  async query<T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.db.query<T>(sql, params);
    return result.rows;
  }

  async snapshot(productIds: readonly string[], docIds: readonly string[]): Promise<Snapshot> {
    if (productIds.length === 0 && docIds.length === 0) return emptySnapshot();
    const products = [...productIds];
    const docs = [...docIds];
    const stockRows = await this.query(SNAPSHOT_STOCK_SQL, [products]);
    const movementRows = await this.query(SNAPSHOT_MOVEMENTS_SQL, [products]);
    const viewRows = await this.query(scopedViewsSql(), [products, docs]);
    const docRows = await this.query(SNAPSHOT_DOCS_SQL, [products]);
    const stock: Record<string, number> = {};
    for (const row of stockRows) stock[String(row.id)] = Number(row.current_stock);
    const docRow = docRows[0] ?? {};
    return {
      stock,
      movements: mapMovementRows(movementRows),
      views: groupViewRows(viewRows),
      docs: { sales: Number(docRow.sales ?? 0), purchases: Number(docRow.purchases ?? 0), payments: Number(docRow.payments ?? 0) },
    };
  }

  async globalReport(): Promise<IntegrityReport> {
    const rows = await this.query("select public.stock_integrity_report($1::uuid) as report", [this.storeId]);
    return reportFromJson(rows[0]?.report);
  }
}

export type LabSession = {
  runId: string;
  /** Sufijo único por ejecución: permite repetir el mismo `--run` sin chocar SKUs. */
  nonce: string;
  storeId: string;
  oracle: Oracle;
  clients: Partial<Record<LabRoleKey, ApiClient>>;
  userIds: Partial<Record<LabRoleKey, string>>;
  close: () => Promise<void>;
};

/** Conecta a la base lab (host permitido), abre los clientes HTTP y deja al vendedor con caja abierta. */
export async function openLabSession(runId: string, roles: readonly LabRoleKey[]): Promise<LabSession> {
  const env = loadStockLabEnv();
  const dbUrl = resolveStockLabDbUrl();
  // El host permitido sale solo del archivo lab, nunca del entorno heredado (C21).
  assertAllowedWriteHost(dbUrl, env.STOCK_TEST_ALLOW_WRITES_HOST);
  const db = new Client({ connectionString: dbUrl, connectionTimeoutMillis: 10_000 });
  await db.connect();
  try {
    const clients: Partial<Record<LabRoleKey, ApiClient>> = {};
    const userIds: Partial<Record<LabRoleKey, string>> = {};
    let storeId: string | null = null;
    for (const role of roles) {
      const client = createLabClient();
      await loginAs(client, role);
      clients[role] = client;
      const rows = await db.query<{ id: string; store_id: string | null }>(
        "select pr.id, pr.store_id from public.profiles pr join auth.users u on u.id = pr.id where u.email = $1",
        [LAB_USERS[role].email],
      );
      const profile = rows.rows[0];
      if (!profile?.store_id) throw new Error(`El usuario ${LAB_USERS[role].email} no tiene perfil/tienda en la base lab.`);
      if (storeId && storeId !== profile.store_id) throw new Error("Los usuarios lab no comparten tienda.");
      storeId = profile.store_id;
      userIds[role] = profile.id;
    }
    if (!storeId) throw new Error("openLabSession: se necesita al menos un rol.");
    for (const role of ["vendedor1", "vendedor2"] as const) {
      const client = clients[role];
      if (client) await ensureCashSession(client, userIds[role] ?? "");
    }
    return {
      runId,
      nonce: Date.now().toString(36),
      storeId,
      oracle: new Oracle(db, storeId),
      clients,
      userIds,
      close: () => db.end(),
    };
  } catch (error) {
    await db.end().catch(() => undefined);
    throw error;
  }
}

/** Sesión de caja abierta para el vendedor (nunca se cierra: la comparten otros tickets). */
export async function ensureCashSession(client: ApiClient, userId: string): Promise<void> {
  const current = await client.request("/api/cash/session");
  if (!current.ok) throw new Error(`GET /api/cash/session devolvió ${current.status}: ${describeError(current)}`);
  const data = current.body?.data;
  if (data && typeof data === "object" && typeof (data as JsonRecord).id === "string") return;
  const registers = await fetchRegisters(client);
  const mine = registers.find((register) => register.assignedUserId === userId);
  if (!mine) throw new Error(`No hay caja asignada al usuario ${userId}.`);
  const res = await client.request("/api/cash/session/open", {
    method: "POST",
    body: JSON.stringify({ registerId: mine.id, openingVes: 0, openingRef: 0 }),
  });
  if (!res.ok) throw new Error(`POST /api/cash/session/open devolvió ${res.status}: ${describeError(res)}`);
}

// ---------------------------------------------------------------------------
// I/O: harness de un caso
// ---------------------------------------------------------------------------

export type OpSpec = {
  as: LabRoleKey;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  body?: JsonRecord;
  label?: string;
  /** Los esperados admiten una función cuando dependen de la respuesta (ids que nacen con la operación). */
  expect: Omit<OpExpectation, "ref" | "stockDelta" | "movements"> & {
    stockDelta: Record<string, number> | ((data: JsonRecord | null) => Record<string, number>);
    movements: ExpectedMovement[] | ((data: JsonRecord | null) => ExpectedMovement[]);
    ref?: MovementRef | null | ((data: JsonRecord | null) => MovementRef | null);
  };
  /** Productos que nacen con esta operación (entran al alcance del caso antes de la foto posterior). */
  newProducts?: (data: JsonRecord | null, oracle: Oracle) => Promise<string[]> | string[];
  /** Ventas/compras que nacen con esta operación. */
  newDocs?: (data: JsonRecord | null) => string[];
};

export type OpResult = {
  res: ApiResponse;
  data: JsonRecord | null;
  accepted: boolean;
  id: string | null;
  evaluation: OpEvaluation;
};

function dataRecord(res: ApiResponse): JsonRecord | null {
  const data = res.body?.data;
  return data && typeof data === "object" && !Array.isArray(data) ? (data as JsonRecord) : null;
}

export class CaseHarness {
  private readonly products = new Set<string>();
  private readonly docs = new Set<string>();

  constructor(
    readonly session: LabSession,
    readonly recorder: CaseRecorder,
    readonly caseId: string,
  ) {}

  get oracle(): Oracle {
    return this.session.oracle;
  }

  client(role: LabRoleKey): ApiClient {
    const client = this.session.clients[role];
    if (!client) throw new Error(`No hay sesión HTTP abierta para el rol ${role}.`);
    return client;
  }

  track(...productIds: string[]): void {
    for (const id of productIds) this.products.add(id);
  }

  trackDoc(...docIds: string[]): void {
    for (const id of docIds) this.docs.add(id);
  }

  note(text: string): void {
    this.recorder.note(text);
  }

  finding(text: string): void {
    this.recorder.finding(text);
  }

  fail(text: string): void {
    this.recorder.fail(text);
  }

  evidence(text: string): void {
    this.recorder.addEvidence(text);
  }

  /** Lectura sin oráculo (tasa vigente, contactos…): no cuenta como operación. */
  async read(role: LabRoleKey, path: string): Promise<ApiResponse> {
    const res = await this.client(role).request(path);
    if (!res.ok) throw new Error(`GET ${path} (${role}) devolvió ${res.status}: ${describeError(res)}`);
    return res;
  }

  /** UNA operación HTTP con foto antes/después y evaluación de los checks a-f. */
  async op(spec: OpSpec): Promise<OpResult> {
    const before = await this.oracle.snapshot([...this.products], [...this.docs]);
    const started = Date.now();
    const res = await this.client(spec.as).request(spec.path, {
      method: spec.method,
      ...(spec.body ? { body: JSON.stringify(spec.body) } : {}),
    });
    const ms = Date.now() - started;
    const data = dataRecord(res);
    const accepted = isSuccess(res.status);
    if (accepted) {
      if (spec.newProducts) this.track(...(await spec.newProducts(data, this.oracle)));
      if (spec.newDocs) this.trackDoc(...spec.newDocs(data));
    }
    const after = await this.oracle.snapshot([...this.products], [...this.docs]);
    const ref = typeof spec.expect.ref === "function" ? spec.expect.ref(data) : (spec.expect.ref ?? null);
    const opName = `${spec.method} ${spec.path}`;
    const message = accepted ? "" : describeError(res);
    const evaluation = evaluateOp({
      op: spec.label ? `${spec.label} (${opName})` : opName,
      expect: {
        ...spec.expect,
        stockDelta: typeof spec.expect.stockDelta === "function" ? spec.expect.stockDelta(data) : spec.expect.stockDelta,
        movements: typeof spec.expect.movements === "function" ? spec.expect.movements(data) : spec.expect.movements,
        ref,
      },
      status: res.status,
      message: message === "(sin cuerpo)" ? "" : message,
      before,
      after,
    });
    const id = typeof data?.id === "string" ? data.id : null;
    this.recorder.recordOp(
      {
        op: opName,
        as: spec.as,
        status: res.status,
        response_id: id,
        ms,
        ...(spec.label ? { label: spec.label } : {}),
        ...(spec.body ? { payload: spec.body } : {}),
        ...(accepted ? {} : { error: message }),
      },
      evaluation,
      after.views,
    );
    this.recorder.setGlobal(await this.oracle.globalReport());
    return { res, data, accepted, id, evaluation };
  }

  /** Corta el caso si una operación imprescindible para seguir no fue aceptada. */
  need(result: OpResult, what: string): OpResult {
    if (!result.accepted) throw new AbortCase(`${what} respondió ${result.res.status}; no se puede continuar`);
    return result;
  }
}
