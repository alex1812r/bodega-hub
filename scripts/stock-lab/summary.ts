/**
 * Resumen de una corrida del laboratorio de stock (STK-305). Módulo PURO: sin
 * IO; `run.ts` le pasa los eventos (`events.jsonl`), los productos y los
 * `stock_movements` de la tienda `lab` leídos con `pg`, y escribe el markdown
 * que devuelve `buildSummary` en `runs/<id>/summary.md`.
 *
 * Columnas de descuadre por producto:
 * - `esperado(eventos)`: Σ `expected_delta[producto]` de los eventos 2xx.
 * - `Σmov(run)`: Σ `quantity_delta` de los movimientos con `created_at` dentro
 *   de la ventana del run (≥ ts del primer evento − 2 s).
 * - `Σmov(total)`: Σ `quantity_delta` de TODOS los movimientos del producto
 *   (incluye los previos al run, p. ej. el stock inicial si lo creó un movimiento).
 * - `current_stock` vs `último stock_after`: el stock vivo del producto frente
 *   al `stock_after` del último movimiento (deben coincidir siempre).
 *
 * Bisección (`findFirstBreak`): sobre los eventos 2xx del producto ordenados
 * por `ts`, acumula el delta esperado y lo compara con Σ `quantity_delta` de
 * los movimientos con `created_at ≤ ts + 2 s` (también se acepta la ventana
 * estricta `≤ ts` para no culpar a un evento por una operación concurrente en
 * vuelo). Además valida la cadena `stock_after[i] = stock_after[i-1] +
 * quantity_delta[i]`. Devuelve lo que ocurra primero en el tiempo.
 */
import { isSuccessStatus, type LabEvent } from "./agents/logger";

export type SummaryProduct = {
  id: string;
  sku: string;
  name: string;
  current_stock: number;
  is_active: boolean;
};

export type SummaryMovement = {
  id: string;
  product_id: string;
  type: string;
  quantity_delta: number;
  stock_after: number;
  sale_id: string | null;
  purchase_id: string | null;
  conversion_id: string | null;
  /** ISO 8601. */
  created_at: string;
};

export type ReconcileStatus = "ok" | "missing" | "failed";

export type SummaryReconcile = {
  status: ReconcileStatus;
  /** Contenido de `reconcile.json` tal cual (formato aún no fijado). */
  raw?: unknown;
  error?: string;
};

export type SummaryAgent = { name: string; exitCode: number | null };

export type SummaryInput = {
  runId: string;
  events: LabEvent[];
  products: SummaryProduct[];
  movements: SummaryMovement[];
  reconcile?: SummaryReconcile;
  agents?: SummaryAgent[];
  /** Avisos del orquestador (p. ej. base de datos inaccesible). */
  notes?: string[];
};

export type OpCount = { total: number; ok: number; failed: number };

export type ProductStockRow = {
  productId: string;
  sku: string;
  name: string;
  expectedDelta: number;
  runMovementDelta: number;
  totalMovementDelta: number;
  currentStock: number | null;
  lastStockAfter: number | null;
  /** esperado(eventos) == Σmov(run). */
  deltaOk: boolean;
  /** current_stock == último stock_after (true si no hay movimientos). */
  stockOk: boolean;
};

export type BreakReason = "expected_mismatch" | "chain_break";

export type FirstBreak = {
  productId: string;
  reason: BreakReason;
  /** Evento tras el cual deja de cuadrar (null en `chain_break`). */
  event: LabEvent | null;
  /** Movimiento que rompe la cadena (null en `expected_mismatch`). */
  movement: SummaryMovement | null;
  expected: number;
  actual: number;
};

/** Tolerancia entre el `created_at` del movimiento y el `ts` del evento. */
export const WINDOW_TOLERANCE_MS = 2_000;

export const RECONCILE_PENDING_TEXT = "reconcile pendiente de integrar (fase 2)";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toMillis(iso: string): number {
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : Number.NaN;
}

function compareMovements(a: SummaryMovement, b: SummaryMovement): number {
  const byTime = toMillis(a.created_at) - toMillis(b.created_at);
  if (byTime !== 0 && Number.isFinite(byTime)) return byTime;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function sortMovements(movements: readonly SummaryMovement[]): SummaryMovement[] {
  return [...movements].sort(compareMovements);
}

export function sortEvents(events: readonly LabEvent[]): LabEvent[] {
  return [...events].sort((a, b) => toMillis(a.ts) - toMillis(b.ts));
}

/** ts (ms) del primer evento del run, o null si no hay eventos. */
export function runStartMillis(events: readonly LabEvent[]): number | null {
  let min: number | null = null;
  for (const event of events) {
    const ts = toMillis(event.ts);
    if (!Number.isFinite(ts)) continue;
    if (min === null || ts < min) min = ts;
  }
  return min;
}

/** Movimientos dentro de la ventana del run (`created_at ≥ primer ts − tolerancia`). */
export function movementsInRun(
  events: readonly LabEvent[],
  movements: readonly SummaryMovement[],
): SummaryMovement[] {
  const start = runStartMillis(events);
  if (start === null) return [];
  const from = start - WINDOW_TOLERANCE_MS;
  return sortMovements(movements).filter((m) => toMillis(m.created_at) >= from);
}

function sumDeltas(movements: readonly SummaryMovement[]): number {
  return movements.reduce((acc, m) => acc + m.quantity_delta, 0);
}

function pad(value: string | number, width: number): string {
  return String(value).padEnd(width);
}

function mdCell(value: unknown): string {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function mdTable(headers: string[], rows: (string | number | null)[][]): string {
  const lines = [
    `| ${headers.map(mdCell).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
  ];
  for (const row of rows) {
    lines.push(`| ${row.map(mdCell).join(" | ")} |`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Conteos
// ---------------------------------------------------------------------------

/** Ops por tipo: total, 2xx y no-2xx (incluye status 0 = agent_error). */
export function countOpsByType(events: readonly LabEvent[]): Record<string, OpCount> {
  const out: Record<string, OpCount> = {};
  for (const event of events) {
    const entry = out[event.op] ?? { total: 0, ok: 0, failed: 0 };
    entry.total += 1;
    if (isSuccessStatus(event.status)) entry.ok += 1;
    else entry.failed += 1;
    out[event.op] = entry;
  }
  return out;
}

/** status → op → nº de eventos. Solo no-2xx (incluye status 0). */
export function countErrorsByStatus(events: readonly LabEvent[]): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const event of events) {
    if (isSuccessStatus(event.status)) continue;
    const status = String(event.status);
    const byOp = out[status] ?? {};
    byOp[event.op] = (byOp[event.op] ?? 0) + 1;
    out[status] = byOp;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Descuadres por producto
// ---------------------------------------------------------------------------

/** productId → Σ expected_delta de los eventos 2xx. */
export function expectedDeltaByProduct(events: readonly LabEvent[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const event of events) {
    if (!isSuccessStatus(event.status)) continue;
    for (const [productId, delta] of Object.entries(event.expected_delta ?? {})) {
      if (typeof delta !== "number" || !Number.isFinite(delta)) continue;
      out[productId] = (out[productId] ?? 0) + delta;
    }
  }
  return out;
}

function groupByProduct(movements: readonly SummaryMovement[]): Map<string, SummaryMovement[]> {
  const out = new Map<string, SummaryMovement[]>();
  for (const movement of movements) {
    const list = out.get(movement.product_id) ?? [];
    list.push(movement);
    out.set(movement.product_id, list);
  }
  return out;
}

/**
 * Una fila por producto tocado en el run (con expected_delta o con movimientos
 * en la ventana del run). Ver cabecera del archivo para las columnas.
 */
export function expectedStockByProduct(
  events: readonly LabEvent[],
  products: readonly SummaryProduct[],
  movements: readonly SummaryMovement[],
): ProductStockRow[] {
  const expected = expectedDeltaByProduct(events);
  const byProductAll = groupByProduct(sortMovements(movements));
  const byProductRun = groupByProduct(movementsInRun(events, movements));
  const productsById = new Map(products.map((p) => [p.id, p]));

  const touched = new Set<string>([...Object.keys(expected), ...byProductRun.keys()]);
  const rows: ProductStockRow[] = [];
  for (const productId of touched) {
    const product = productsById.get(productId);
    const all = byProductAll.get(productId) ?? [];
    const run = byProductRun.get(productId) ?? [];
    const last = all.length > 0 ? all[all.length - 1] ?? null : null;
    const expectedDelta = expected[productId] ?? 0;
    const runMovementDelta = sumDeltas(run);
    const currentStock = product?.current_stock ?? null;
    const lastStockAfter = last?.stock_after ?? null;
    rows.push({
      productId,
      sku: product?.sku ?? "?",
      name: product?.name ?? "(producto no encontrado)",
      expectedDelta,
      runMovementDelta,
      totalMovementDelta: sumDeltas(all),
      currentStock,
      lastStockAfter,
      deltaOk: expectedDelta === runMovementDelta,
      stockOk: lastStockAfter === null || currentStock === lastStockAfter,
    });
  }
  rows.sort((a, b) => (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : a.productId.localeCompare(b.productId)));
  return rows;
}

// ---------------------------------------------------------------------------
// Bisección
// ---------------------------------------------------------------------------

/** Primer movimiento cuyo stock_after no es el anterior + su delta, o null. */
export function findChainBreak(sortedMovements: readonly SummaryMovement[]): SummaryMovement | null {
  for (let i = 1; i < sortedMovements.length; i += 1) {
    const prev = sortedMovements[i - 1];
    const curr = sortedMovements[i];
    if (!prev || !curr) continue;
    if (curr.stock_after !== prev.stock_after + curr.quantity_delta) return curr;
  }
  return null;
}

/**
 * Localiza el primer evento (o movimiento) tras el cual el producto deja de
 * cuadrar. `events` pueden ser todos los del run (se filtran por producto);
 * `movementsOfProduct` solo los de ese producto (se filtran a la ventana del run).
 */
export function findFirstBreak(
  events: readonly LabEvent[],
  movementsOfProduct: readonly SummaryMovement[],
  productId: string,
): FirstBreak | null {
  const movements = movementsInRun(events, movementsOfProduct).filter((m) => m.product_id === productId);
  const productEvents = sortEvents(events).filter((event) => {
    if (!isSuccessStatus(event.status)) return false;
    const delta = event.expected_delta?.[productId];
    return typeof delta === "number" && delta !== 0;
  });

  const chainBreak = findChainBreak(movements);
  const chainBreakAt = chainBreak ? toMillis(chainBreak.created_at) : Number.POSITIVE_INFINITY;
  const chainResult = (): FirstBreak | null => {
    if (!chainBreak) return null;
    const index = movements.indexOf(chainBreak);
    const prev = movements[index - 1];
    return {
      productId,
      reason: "chain_break",
      event: null,
      movement: chainBreak,
      expected: (prev?.stock_after ?? 0) + chainBreak.quantity_delta,
      actual: chainBreak.stock_after,
    };
  };

  let expected = 0;
  let cursorStrict = 0;
  let cursorLoose = 0;
  let sumStrict = 0;
  let sumLoose = 0;
  for (const event of productEvents) {
    const ts = toMillis(event.ts);
    expected += event.expected_delta[productId] ?? 0;
    for (let m = movements[cursorStrict]; m && toMillis(m.created_at) <= ts; m = movements[cursorStrict]) {
      sumStrict += m.quantity_delta;
      cursorStrict += 1;
    }
    for (
      let m = movements[cursorLoose];
      m && toMillis(m.created_at) <= ts + WINDOW_TOLERANCE_MS;
      m = movements[cursorLoose]
    ) {
      sumLoose += m.quantity_delta;
      cursorLoose += 1;
    }
    if (sumLoose !== expected && sumStrict !== expected) {
      if (chainBreakAt <= ts + WINDOW_TOLERANCE_MS) return chainResult();
      return { productId, reason: "expected_mismatch", event, movement: null, expected, actual: sumLoose };
    }
  }

  if (chainBreak) return chainResult();

  const total = sumDeltas(movements);
  if (total !== expected) {
    const lastEvent = productEvents[productEvents.length - 1] ?? null;
    return { productId, reason: "expected_mismatch", event: lastEvent, movement: null, expected, actual: total };
  }
  return null;
}

/** Bisección de todos los productos tocados en el run. */
export function findAllBreaks(
  events: readonly LabEvent[],
  movements: readonly SummaryMovement[],
): FirstBreak[] {
  const expected = expectedDeltaByProduct(events);
  const byProduct = groupByProduct(movementsInRun(events, movements));
  const touched = new Set<string>([...Object.keys(expected), ...byProduct.keys()]);
  const out: FirstBreak[] = [];
  for (const productId of touched) {
    const found = findFirstBreak(events, byProduct.get(productId) ?? [], productId);
    if (found) out.push(found);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

function describeEvent(event: LabEvent | null): string {
  if (!event) return "—";
  return `${event.ts} · ${event.agent} · ${event.op} · ${event.response_id ?? "sin id"}`;
}

function describeMovement(movement: SummaryMovement | null): string {
  if (!movement) return "—";
  const ref = movement.sale_id ?? movement.purchase_id ?? movement.conversion_id ?? "sin ref";
  return `${movement.created_at} · mov ${movement.id} · ${movement.type} · ${ref}`;
}

function describeBreak(found: FirstBreak): string {
  if (found.reason === "chain_break") {
    return `chain_break: stock_after=${found.actual}, esperado ${found.expected} (anterior + delta)`;
  }
  return `expected_mismatch: Σ esperado ${found.expected} vs Σ movimientos ${found.actual}`;
}

function describeReconcile(reconcile: SummaryReconcile | undefined): string {
  if (!reconcile || reconcile.status === "missing") {
    return RECONCILE_PENDING_TEXT;
  }
  const lines: string[] = [];
  if (reconcile.status === "failed") {
    lines.push(`reconcile falló${reconcile.error ? `: ${reconcile.error}` : ""}`);
  } else {
    lines.push("reconcile ejecutado (subproceso).");
  }
  const raw = reconcile.raw;
  if (raw !== undefined) {
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const rec = raw as Record<string, unknown>;
      for (const key of ["rows", "mismatches"]) {
        const value = rec[key];
        if (Array.isArray(value)) lines.push(`${key}: ${value.length}`);
      }
    }
    lines.push("", "```json", JSON.stringify(raw, null, 2), "```");
  }
  return lines.join("\n");
}

export function buildSummary(input: SummaryInput): string {
  const { runId, events, products, movements } = input;
  const ops = countOpsByType(events);
  const errors = countErrorsByStatus(events);
  const rows = expectedStockByProduct(events, products, movements);
  const breaks = findAllBreaks(events, movements);
  const okEvents = events.filter((e) => isSuccessStatus(e.status)).length;
  const start = runStartMillis(events);

  const out: string[] = [];
  out.push(`# Stock-lab run ${runId}`, "");
  out.push(
    `- Eventos: ${events.length} (2xx: ${okEvents}, fallidos: ${events.length - okEvents})`,
    `- Inicio: ${start === null ? "sin eventos" : new Date(start).toISOString()}`,
    `- Productos tocados: ${rows.length} · con descuadre: ${rows.filter((r) => !r.deltaOk || !r.stockOk).length} · con bisección: ${breaks.length}`,
  );
  if (input.notes && input.notes.length > 0) {
    out.push("", "## Avisos", "", ...input.notes.map((note) => `- ${note}`));
  }

  out.push("", "## Agentes", "");
  if (input.agents && input.agents.length > 0) {
    out.push(
      mdTable(
        ["agente", "exit code", "estado"],
        input.agents.map((a) => [a.name, a.exitCode ?? "null", a.exitCode === 0 ? "ok" : "FALLÓ"]),
      ),
    );
  } else {
    out.push("(sin agentes registrados)");
  }

  out.push("", "## Operaciones por tipo", "");
  const opRows = Object.entries(ops)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([op, c]) => [op, c.total, c.ok, c.failed]);
  out.push(opRows.length > 0 ? mdTable(["op", "total", "2xx", "no-2xx"], opRows) : "(sin eventos)");

  out.push("", "## Errores HTTP (status × op)", "");
  const errorRows: (string | number)[][] = [];
  for (const status of Object.keys(errors).sort((a, b) => Number(a) - Number(b))) {
    for (const [op, count] of Object.entries(errors[status] ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
      errorRows.push([status === "0" ? "0 (agent_error)" : status, op, count]);
    }
  }
  out.push(errorRows.length > 0 ? mdTable(["status", "op", "eventos"], errorRows) : "(sin errores)");

  out.push("", "## Descuadres por producto", "");
  out.push(
    "`esperado(eventos)` = Σ expected_delta de eventos 2xx · `Σmov(run)` = Σ quantity_delta en la ventana del run · " +
      "`Σmov(total)` = Σ quantity_delta de todos los movimientos · `current_stock` vs `último stock_after` del producto.",
    "",
  );
  out.push(
    rows.length > 0
      ? mdTable(
          ["producto", "sku", "esperado(eventos)", "Σmov(run)", "Σmov(total)", "current_stock", "último stock_after", "delta", "stock"],
          rows.map((r) => [
            r.name,
            r.sku,
            r.expectedDelta,
            r.runMovementDelta,
            r.totalMovementDelta,
            r.currentStock ?? "?",
            r.lastStockAfter ?? "—",
            r.deltaOk ? "ok" : "DESCUADRE",
            r.stockOk ? "ok" : "DESCUADRE",
          ]),
        )
      : "(ningún producto tocado)",
  );

  out.push("", "## Primer evento que rompió cada producto", "");
  if (breaks.length > 0) {
    const productsById = new Map(products.map((p) => [p.id, p]));
    out.push(
      mdTable(
        ["producto", "sku", "evento (ts, agent, op, response_id)", "motivo"],
        breaks.map((b) => {
          const product = productsById.get(b.productId);
          return [
            product?.name ?? b.productId,
            product?.sku ?? "?",
            b.reason === "chain_break" ? describeMovement(b.movement) : describeEvent(b.event),
            describeBreak(b),
          ];
        }),
      ),
    );
  } else {
    out.push("Ningún producto rompió: la suma esperada coincide con los movimientos y la cadena stock_after es válida.");
  }

  out.push("", "## Reconcile", "", describeReconcile(input.reconcile), "");
  return out.join("\n");
}

/** Tres líneas para la consola. */
export function shortSummary(input: SummaryInput): string[] {
  const agents = input.agents ?? [];
  const failedAgents = agents.filter((a) => a.exitCode !== 0).map((a) => a.name);
  const okEvents = input.events.filter((e) => isSuccessStatus(e.status)).length;
  const breaks = findAllBreaks(input.events, input.movements);
  return [
    `${pad("agentes:", 10)} ${agents.length} (fallidos: ${failedAgents.length ? failedAgents.join(", ") : "ninguno"})`,
    `${pad("eventos:", 10)} ${input.events.length} (2xx ${okEvents}, no-2xx ${input.events.length - okEvents})`,
    `${pad("roturas:", 10)} ${breaks.length} producto(s) · reconcile: ${input.reconcile?.status ?? "missing"}`,
  ];
}
