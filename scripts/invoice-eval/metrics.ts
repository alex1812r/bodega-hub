/**
 * Métricas del banco de evaluación del escaneo de facturas (SCN-10d).
 *
 * Funciones PURAS (sin IO): reciben la verdad (`truth.ts`), la extracción
 * predicha y el emparejamiento, y devuelven números. Las metas son las de
 * `docs/agent-prompts/factura-escaneo-gtm.md` §10.
 *
 * Alineación de líneas (predicha ↔ verdad): se puntúa cada par con
 *   score = 0,6 · texto + 0,2 · cercanía(lineTotal) + 0,2 · cercanía(quantity)
 * donde `texto` es el máximo coeficiente de Dice por bigramas entre
 * {description, rawText} predichos y {description, rawText} de la verdad
 * (normalizados: minúsculas, sin acentos ni signos) y `cercanía` es 1 dentro de
 * la tolerancia y si no 1 − |a−b| / max(|a|,|b|). Los pares con score ≥
 * `LINE_ALIGN_MIN_SCORE` y texto ≥ `LINE_ALIGN_MIN_TEXT` se ordenan por score
 * descendente (empate: índice de verdad, luego índice predicho) y se asignan en
 * forma voraz 1 a 1. Es determinista.
 */
import type {
  InvoiceExtraction,
  InvoiceExtractionLine,
  InvoiceLineMatch,
  InvoiceMatch,
} from "../../src/modules/invoice-scan/contracts";

import type { InvoiceTruth, TruthUncertainField } from "./truth";

// ───────────────────────── utilidades ─────────────────────────

export const MONEY_ABS_TOLERANCE = 0.01;
export const MONEY_REL_TOLERANCE = 0.001;
export const QUANTITY_TOLERANCE = 0.001;
export const SUPPLIER_NAME_MIN_SIMILARITY = 0.8;
export const LINE_ALIGN_MIN_SCORE = 0.5;
export const LINE_ALIGN_MIN_TEXT = 0.2;
/** Una predicha sobre una línea tapada con confidence ≤ esto no cuenta como inventada. */
export const OCCLUDED_LOW_CONFIDENCE = 0.5;

/** ±0,01 o 0,1 % del valor esperado, lo que sea mayor. */
export function moneyEquals(predicted: number, expected: number): boolean {
  const tolerance = Math.max(MONEY_ABS_TOLERANCE, Math.abs(expected) * MONEY_REL_TOLERANCE);
  return Math.abs(predicted - expected) <= tolerance + 1e-9;
}

export function quantityEquals(predicted: number, expected: number): boolean {
  return Math.abs(predicted - expected) <= QUANTITY_TOLERANCE + 1e-9;
}

export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function bigrams(value: string): Map<string, number> {
  const compact = value.replace(/\s+/g, " ");
  const grams = new Map<string, number>();
  for (let i = 0; i < compact.length - 1; i += 1) {
    const gram = compact.slice(i, i + 2);
    grams.set(gram, (grams.get(gram) ?? 0) + 1);
  }
  return grams;
}

/** Coeficiente de Dice por bigramas sobre texto normalizado (0..1). */
export function textSimilarity(a: string, b: string): number {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (na.length === 0 || nb.length === 0) return 0;
  if (na === nb) return 1;
  const ga = bigrams(na);
  const gb = bigrams(nb);
  let sizeA = 0;
  let sizeB = 0;
  let overlap = 0;
  ga.forEach((count, gram) => {
    sizeA += count;
    overlap += Math.min(count, gb.get(gram) ?? 0);
  });
  gb.forEach((count) => {
    sizeB += count;
  });
  if (sizeA + sizeB === 0) return 0;
  return (2 * overlap) / (sizeA + sizeB);
}

/** `J-50529551-9` → `J505295519`; sin letra queda solo dígitos. */
export function normalizeTaxId(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function taxIdsEqual(a: string, b: string): boolean {
  const na = normalizeTaxId(a);
  const nb = normalizeTaxId(b);
  if (na.length === 0 || nb.length === 0) return false;
  if (na === nb) return true;
  // Si uno de los dos viene sin letra (factura que imprime solo dígitos), se comparan los dígitos.
  const hasLetter = (v: string) => /^[A-Z]/.test(v);
  if (!hasLetter(na) || !hasLetter(nb)) {
    return na.replace(/\D/g, "") === nb.replace(/\D/g, "");
  }
  return false;
}

/** Nombre de proveedor sin acentos, signos ni sufijo societario (C.A., S.A., S.R.L.). */
export function normalizeSupplierName(value: string): string {
  return normalizeText(value)
    .replace(/\s+(c\s?a|s\s?a|s\s?r\s?l|compania anonima)$/, "")
    .trim();
}

/** `00006894` → `6894`; solo dígitos, sin ceros a la izquierda. */
export function normalizeInvoiceNumber(value: string): string {
  const digits = value.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  return digits.length > 0 ? digits : normalizeText(value);
}

function closeness(a: number, b: number, equals: (x: number, y: number) => boolean): number {
  if (equals(a, b)) return 1;
  const scale = Math.max(Math.abs(a), Math.abs(b));
  if (scale === 0) return 1;
  return Math.max(0, 1 - Math.abs(a - b) / scale);
}

// ───────────────────────── cabecera ─────────────────────────

export type HeaderField = "supplier" | "date" | "number" | "total";

export type HeaderFieldResult = {
  /** false si la verdad no trae el campo (no cuenta). */
  evaluated: boolean;
  ok: boolean;
  expected?: string | number;
  predicted?: string | number;
};

export type HeaderMetrics = {
  fields: Record<HeaderField, HeaderFieldResult>;
  okCount: number;
  evaluatedCount: number;
  /** Media de campos evaluados; 1 si no hay ninguno. */
  headerScore: number;
  headerAllOk: boolean;
};

export type HeaderOptions = {
  expectedContactId?: string | null;
  matchedContactId?: string | null;
};

export function evaluateHeader(
  truth: InvoiceExtraction,
  predicted: InvoiceExtraction | null,
  options: HeaderOptions = {},
): HeaderMetrics {
  const skip: HeaderFieldResult = { evaluated: false, ok: false };

  let supplier: HeaderFieldResult = skip;
  const truthName = truth.supplier.name.trim();
  const truthTax = truth.supplier.taxId?.trim();
  if (truthName.length > 0 || (truthTax && truthTax.length > 0)) {
    const predName = predicted?.supplier.name ?? "";
    const predTax = predicted?.supplier.taxId?.trim();
    let ok = false;
    if (truthTax && predTax) {
      ok = taxIdsEqual(truthTax, predTax);
    } else if (predicted) {
      ok =
        textSimilarity(normalizeSupplierName(truthName), normalizeSupplierName(predName)) >=
        SUPPLIER_NAME_MIN_SIMILARITY;
    }
    if (!ok && options.expectedContactId && options.matchedContactId) {
      ok = options.expectedContactId === options.matchedContactId;
    }
    supplier = {
      evaluated: true,
      ok,
      expected: truthTax ?? truthName,
      predicted: predTax ?? (predicted ? predName : undefined),
    };
  }

  const date: HeaderFieldResult =
    truth.date === undefined
      ? skip
      : {
          evaluated: true,
          ok: predicted?.date !== undefined && predicted.date.trim() === truth.date.trim(),
          expected: truth.date,
          predicted: predicted?.date,
        };

  const number: HeaderFieldResult =
    truth.number === undefined
      ? skip
      : {
          evaluated: true,
          ok:
            predicted?.number !== undefined &&
            normalizeInvoiceNumber(predicted.number) === normalizeInvoiceNumber(truth.number),
          expected: truth.number,
          predicted: predicted?.number,
        };

  const total: HeaderFieldResult =
    truth.total === undefined
      ? skip
      : {
          evaluated: true,
          ok: predicted?.total !== undefined && moneyEquals(predicted.total, truth.total),
          expected: truth.total,
          predicted: predicted?.total,
        };

  const fields = { supplier, date, number, total };
  const results = Object.values(fields).filter((field) => field.evaluated);
  const okCount = results.filter((field) => field.ok).length;
  const evaluatedCount = results.length;
  return {
    fields,
    okCount,
    evaluatedCount,
    headerScore: evaluatedCount === 0 ? 1 : okCount / evaluatedCount,
    headerAllOk: okCount === evaluatedCount,
  };
}

// ───────────────────────── alineación ─────────────────────────

export type LinePair = { predictedIndex: number; truthIndex: number; score: number };

type AlignableLine = Pick<InvoiceExtractionLine, "rawText" | "description" | "quantity" | "lineTotal">;

function lineTextSimilarity(a: AlignableLine, b: AlignableLine): number {
  let best = 0;
  for (const ta of [a.description, a.rawText]) {
    for (const tb of [b.description, b.rawText]) {
      best = Math.max(best, textSimilarity(ta, tb));
    }
  }
  return best;
}

export function lineSimilarity(predicted: AlignableLine, truth: AlignableLine): { score: number; text: number } {
  const text = lineTextSimilarity(predicted, truth);
  const score =
    0.6 * text +
    0.2 * closeness(predicted.lineTotal, truth.lineTotal, moneyEquals) +
    0.2 * closeness(predicted.quantity, truth.quantity, quantityEquals);
  return { score, text };
}

/** Asignación voraz 1 a 1 por score (ver comentario de cabecera del archivo). */
export function alignLines(predicted: readonly AlignableLine[], truth: readonly AlignableLine[]): LinePair[] {
  const candidates: LinePair[] = [];
  predicted.forEach((p, predictedIndex) => {
    truth.forEach((t, truthIndex) => {
      const { score, text } = lineSimilarity(p, t);
      if (score >= LINE_ALIGN_MIN_SCORE && text >= LINE_ALIGN_MIN_TEXT) {
        candidates.push({ predictedIndex, truthIndex, score });
      }
    });
  });
  candidates.sort(
    (a, b) => b.score - a.score || a.truthIndex - b.truthIndex || a.predictedIndex - b.predictedIndex,
  );
  const usedPredicted = new Set<number>();
  const usedTruth = new Set<number>();
  const pairs: LinePair[] = [];
  for (const candidate of candidates) {
    if (usedPredicted.has(candidate.predictedIndex) || usedTruth.has(candidate.truthIndex)) continue;
    usedPredicted.add(candidate.predictedIndex);
    usedTruth.add(candidate.truthIndex);
    pairs.push(candidate);
  }
  return pairs.sort((a, b) => a.truthIndex - b.truthIndex);
}

// ───────────────────────── por factura ─────────────────────────

export type Bucket = "sinAlias" | "conAlias";
export const BUCKETS: readonly Bucket[] = ["sinAlias", "conAlias"];

/** productKey → productId de la base lab; null/ausente = fuera de catálogo. */
export type CatalogMap = Readonly<Record<string, string | null | undefined>>;

export type MatchOutcome =
  | "confirmed_correct"
  | "doubtful_correct"
  | "confirmed_wrong"
  | "doubtful_wrong"
  | "unmatched"
  | "lost"
  | "ok_none";

export const MATCH_OUTCOMES: readonly MatchOutcome[] = [
  "confirmed_correct",
  "doubtful_correct",
  "confirmed_wrong",
  "doubtful_wrong",
  "unmatched",
  "lost",
  "ok_none",
];

export type InventedLine = { predictedIndex: number; rawText: string; reason: "unaligned" | "occluded_mismatch" };
export type LostLine = { truthIndex: number; rawText: string };

export type LineMatchResult = {
  /** Índice en la verdad; null para inventadas. */
  truthIndex: number | null;
  predictedIndex: number | null;
  productKey: string | null;
  expectedProductId: string | null;
  outcome: MatchOutcome;
};

export type ExactFailure = { truthIndex: number; fields: ("quantity" | "unitPrice" | "lineTotal" | "lost")[] };

export type InvoiceEvalInput = {
  truth: InvoiceTruth;
  /** null si el escaneo falló (todo cuenta como perdido). */
  predicted: InvoiceExtraction | null;
  matched: InvoiceMatch | null;
  catalog: CatalogMap;
  bucket: Bucket;
  expectedContactId?: string | null;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  modelId?: string;
};

export type InvoiceMetrics = {
  id: string;
  bucket: Bucket;
  synthetic: boolean;
  pageCount: number;
  header: HeaderMetrics;
  pairs: LinePair[];
  lines: {
    tp: number;
    fp: number;
    fn: number;
    /** TP/(TP+FN+FP); 1 si no hay nada que contar. */
    rate: number;
    invented: InventedLine[];
    lost: LostLine[];
  };
  exact: { ok: number; total: number; rate: number; failures: ExactFailure[] };
  matching: {
    perLine: LineMatchResult[];
    counts: Record<MatchOutcome, number>;
    /** Líneas de verdad evaluadas con producto en catálogo (incluye perdidas). */
    inCatalog: number;
    /** Líneas de verdad evaluadas + inventadas. */
    evaluated: number;
    okRate: number;
    confirmedWrongRate: number;
  };
  duplicate: { expected: boolean; detected: boolean; correct: boolean; falsePositive: boolean };
  usage: { durationMs?: number; inputTokens?: number; outputTokens?: number; costUsd: number | null };
};

function emptyCounts(): Record<MatchOutcome, number> {
  return {
    confirmed_correct: 0,
    doubtful_correct: 0,
    confirmed_wrong: 0,
    doubtful_wrong: 0,
    unmatched: 0,
    lost: 0,
    ok_none: 0,
  };
}

function ratio(numerator: number, denominator: number, empty = 1): number {
  return denominator === 0 ? empty : numerator / denominator;
}

function outcomeFor(match: InvoiceLineMatch | undefined, expectedProductId: string | null): MatchOutcome {
  const status = match?.status ?? "unmatched";
  if (expectedProductId === null) {
    return status === "confirmed" ? "confirmed_wrong" : "ok_none";
  }
  if (status === "confirmed") {
    return match?.productId === expectedProductId ? "confirmed_correct" : "confirmed_wrong";
  }
  if (status === "doubtful") {
    const hit =
      match?.productId === expectedProductId ||
      (match?.candidates ?? []).some((candidate) => candidate.productId === expectedProductId);
    return hit ? "doubtful_correct" : "doubtful_wrong";
  }
  return "unmatched";
}

function exactFailures(
  predicted: InvoiceExtractionLine,
  truth: InvoiceExtractionLine,
  uncertain: readonly TruthUncertainField[],
): ExactFailure["fields"] {
  const failed: ExactFailure["fields"] = [];
  if (!uncertain.includes("quantity") && !quantityEquals(predicted.quantity, truth.quantity)) failed.push("quantity");
  if (!uncertain.includes("unitPrice") && !moneyEquals(predicted.unitPrice, truth.unitPrice)) failed.push("unitPrice");
  if (!uncertain.includes("lineTotal") && !moneyEquals(predicted.lineTotal, truth.lineTotal)) failed.push("lineTotal");
  return failed;
}

export function evaluateInvoice(input: InvoiceEvalInput): InvoiceMetrics {
  const { truth, predicted, matched, catalog } = input;
  const truthLines = truth.extraction.lines;
  const predictedLines = predicted?.lines ?? [];
  const pairs = alignLines(predictedLines, truthLines);
  const byTruth = new Map(pairs.map((pair) => [pair.truthIndex, pair]));
  const alignedPredicted = new Set(pairs.map((pair) => pair.predictedIndex));
  const matchByIndex = new Map((matched?.lines ?? []).map((line) => [line.index, line]));

  const expectedProductIdFor = (productKey: string | null): string | null => {
    if (productKey === null) return null;
    const id = catalog[productKey];
    return typeof id === "string" && id.length > 0 ? id : null;
  };

  let tp = 0;
  const invented: InventedLine[] = [];
  const lost: LostLine[] = [];
  let exactOk = 0;
  let exactTotal = 0;
  const failures: ExactFailure[] = [];
  const perLine: LineMatchResult[] = [];

  truthLines.forEach((truthLine, truthIndex) => {
    const meta = truth.lines[truthIndex];
    const pair = byTruth.get(truthIndex);
    const predictedLine = pair ? predictedLines[pair.predictedIndex] : undefined;
    const expectedProductId = expectedProductIdFor(meta.productKey);

    if (meta.occluded) {
      // Tapada: perderla no cuenta; leerla mal con confianza alta es inventar.
      if (!pair || !predictedLine) return;
      const valuesMatch =
        quantityEquals(predictedLine.quantity, truthLine.quantity) &&
        moneyEquals(predictedLine.lineTotal, truthLine.lineTotal);
      if (valuesMatch || predictedLine.confidence <= OCCLUDED_LOW_CONFIDENCE) {
        tp += 1;
        perLine.push({
          truthIndex,
          predictedIndex: pair.predictedIndex,
          productKey: meta.productKey,
          expectedProductId,
          outcome: outcomeFor(matchByIndex.get(pair.predictedIndex), expectedProductId),
        });
      } else {
        invented.push({
          predictedIndex: pair.predictedIndex,
          rawText: predictedLine.rawText,
          reason: "occluded_mismatch",
        });
        perLine.push({
          truthIndex: null,
          predictedIndex: pair.predictedIndex,
          productKey: null,
          expectedProductId: null,
          outcome: outcomeFor(matchByIndex.get(pair.predictedIndex), null),
        });
      }
      return;
    }

    exactTotal += 1;
    if (!pair || !predictedLine) {
      lost.push({ truthIndex, rawText: truthLine.rawText });
      failures.push({ truthIndex, fields: ["lost"] });
      perLine.push({
        truthIndex,
        predictedIndex: null,
        productKey: meta.productKey,
        expectedProductId,
        outcome: expectedProductId === null ? "ok_none" : "lost",
      });
      return;
    }

    tp += 1;
    const failed = exactFailures(predictedLine, truthLine, meta.uncertainFields);
    if (failed.length === 0) exactOk += 1;
    else failures.push({ truthIndex, fields: failed });
    perLine.push({
      truthIndex,
      predictedIndex: pair.predictedIndex,
      productKey: meta.productKey,
      expectedProductId,
      outcome: outcomeFor(matchByIndex.get(pair.predictedIndex), expectedProductId),
    });
  });

  predictedLines.forEach((line, predictedIndex) => {
    if (alignedPredicted.has(predictedIndex)) return;
    invented.push({ predictedIndex, rawText: line.rawText, reason: "unaligned" });
    perLine.push({
      truthIndex: null,
      predictedIndex,
      productKey: null,
      expectedProductId: null,
      outcome: outcomeFor(matchByIndex.get(predictedIndex), null),
    });
  });
  invented.sort((a, b) => a.predictedIndex - b.predictedIndex);

  const counts = emptyCounts();
  perLine.forEach((line) => {
    counts[line.outcome] += 1;
  });
  const inCatalog = perLine.filter((line) => line.truthIndex !== null && line.expectedProductId !== null).length;
  const evaluated = perLine.length;
  const fp = invented.length;
  const fn = lost.length;

  const duplicateExpected = truth.duplicateOf !== null;
  const duplicateDetected = Boolean(matched?.duplicateOfScanId);

  const header = evaluateHeader(truth.extraction, predicted, {
    expectedContactId: input.expectedContactId,
    matchedContactId: matched?.supplier.contactId,
  });

  const costUsd =
    input.modelId !== undefined && input.inputTokens !== undefined && input.outputTokens !== undefined
      ? estimateCostUsd(input.modelId, input.inputTokens, input.outputTokens)
      : null;

  return {
    id: truth.id,
    bucket: input.bucket,
    synthetic: truth.synthetic,
    pageCount: truth.pages.length,
    header,
    pairs,
    lines: { tp, fp, fn, rate: ratio(tp, tp + fp + fn), invented, lost },
    exact: { ok: exactOk, total: exactTotal, rate: ratio(exactOk, exactTotal), failures },
    matching: {
      perLine,
      counts,
      inCatalog,
      evaluated,
      okRate: ratio(counts.confirmed_correct + counts.doubtful_correct, inCatalog),
      confirmedWrongRate: ratio(counts.confirmed_wrong, evaluated, 0),
    },
    duplicate: {
      expected: duplicateExpected,
      detected: duplicateDetected,
      correct: duplicateExpected === duplicateDetected,
      falsePositive: duplicateDetected && !duplicateExpected,
    },
    usage: {
      durationMs: input.durationMs,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      costUsd,
    },
  };
}

// ───────────────────────── costo ─────────────────────────

/**
 * Precios en USD por millón de tokens (plan de pago, nivel Standard, entrada de
 * texto/imagen; la salida incluye thinking). Fuentes oficiales consultadas el
 * 2026-10-15 (resumen en .notes/factura-escaneo/evaluacion/research-precios-vertex.md):
 *   - https://ai.google.dev/gemini-api/docs/pricing
 *   - https://ai.google.dev/gemini-api/docs/models
 *   - https://platform.claude.com/docs/en/about-claude/pricing
 *   - https://platform.claude.com/docs/en/about-claude/models/overview
 * Notas:
 *   - gemini-3.6-flash y gemini-3.8-flash cuestan $0.75 / $3.75 hasta el
 *     2026-12-31 y suben a $1.50 / $7.50 desde el 2027-01-01 (fila con
 *     `effectiveFrom`; se elige por la fecha de la corrida, en UTC).
 *   - claude-haiku-5-5 tiene dos tramos: prompt ≤100k tokens $0.10 / $0.50;
 *     si el prompt supera 100k, toda la petición va a $0.50 / $2.50.
 *   - gemini-3.5-flash (solo Vertex) no tiene precio confirmado: no está en la tabla.
 * Verificar en la página oficial antes de decidir con dinero.
 */
export type ModelPrice = {
  /** Fecha (YYYY-MM-DD, UTC) desde la que rige la fila; sin fecha = siempre. */
  effectiveFrom?: string;
  input: number;
  output: number;
  /** Tramo alto: aplica a toda la petición si los tokens de entrada superan el umbral. */
  longContext?: { aboveInputTokens: number; input: number; output: number };
};

export const MODEL_PRICES_USD_PER_MTOK: Readonly<Record<string, readonly ModelPrice[]>> = {
  "gemini-2.5-flash": [{ input: 0.3, output: 2.5 }],
  "gemini-2.5-flash-lite": [{ input: 0.1, output: 0.4 }],
  "gemini-3-flash-preview": [{ input: 0.5, output: 3 }],
  "gemini-3.1-flash-lite": [{ input: 0.25, output: 1.5 }],
  "gemini-3.5-flash-lite": [{ input: 0.3, output: 2.5 }],
  "gemini-3.6-flash": [
    { input: 0.75, output: 3.75 },
    { effectiveFrom: "2027-01-01", input: 1.5, output: 7.5 },
  ],
  "gemini-3.8-flash": [
    { input: 0.75, output: 3.75 },
    { effectiveFrom: "2027-01-01", input: 1.5, output: 7.5 },
  ],
  "claude-haiku-4-5": [{ input: 1, output: 5 }],
  "claude-haiku-5-5": [
    { input: 0.1, output: 0.5, longContext: { aboveInputTokens: 100_000, input: 0.5, output: 2.5 } },
  ],
};

/**
 * Resuelve el id de la tabla para un id de API: quita `models/` y acepta
 * sufijos de fecha/versión (`claude-haiku-4-5-20251001`) por prefijo más largo
 * terminado en límite (`-`, `@` o fin). Desconocido → null.
 */
export function resolvePricedModelId(modelId: string): string | null {
  const id = modelId.trim().replace(/^models\//, "");
  let best: string | null = null;
  for (const key of Object.keys(MODEL_PRICES_USD_PER_MTOK)) {
    if (!id.startsWith(key)) continue;
    const next = id.charAt(key.length);
    if (next !== "" && next !== "-" && next !== "@") continue;
    if (best === null || key.length > best.length) best = key;
  }
  return best;
}

function effectiveTime(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

/** Costo estimado en USD; null si el modelo no está en la tabla. `at` = fecha de la corrida. */
export function estimateCostUsd(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
  at: Date = new Date(),
): number | null {
  const key = resolvePricedModelId(modelId);
  if (key === null) return null;
  const now = at.getTime();
  let row: ModelPrice | null = null;
  for (const candidate of MODEL_PRICES_USD_PER_MTOK[key] ?? []) {
    const from = candidate.effectiveFrom === undefined ? -Infinity : effectiveTime(candidate.effectiveFrom);
    const current = row?.effectiveFrom === undefined ? -Infinity : effectiveTime(row.effectiveFrom);
    if (from <= now && (row === null || from >= current)) row = candidate;
  }
  if (row === null) return null;
  const tier = row.longContext && inputTokens > row.longContext.aboveInputTokens ? row.longContext : row;
  return (inputTokens * tier.input + outputTokens * tier.output) / 1_000_000;
}

// ───────────────────────── agregación ─────────────────────────

export type AggregateMetrics = {
  invoices: number;
  headerFieldsOk: number;
  headerFieldsEvaluated: number;
  /** Suma de campos correctos / campos evaluados (meta de cabecera). */
  headerFieldRate: number | null;
  headerAllOkCount: number;
  headerAllOkRate: number | null;
  linesTp: number;
  linesFp: number;
  linesFn: number;
  linesDetectedRate: number | null;
  exactOk: number;
  exactTotal: number;
  exactRate: number | null;
  matchCounts: Record<MatchOutcome, number>;
  matchInCatalog: number;
  matchEvaluated: number;
  matchOkRate: number | null;
  confirmedWrongRate: number | null;
  duplicates: { expected: number; detected: number; truePositive: number; falsePositive: number; missed: number };
  /** p95 (rango más cercano) de duración en facturas de 1 página; null sin datos. */
  p95DurationMs1Page: number | null;
  /** Media de costo sobre facturas con costo conocido; null sin datos. */
  avgCostUsd: number | null;
  costedInvoices: number;
  inputTokens: number;
  outputTokens: number;
};

export type GlobalMetrics = {
  total: AggregateMetrics;
  byBucket: Record<Bucket, AggregateMetrics>;
};

/** Percentil por rango más cercano (p en 0..100); null si no hay valores. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1];
}

export function aggregateMetrics(list: readonly InvoiceMetrics[]): AggregateMetrics {
  const sum = (pick: (m: InvoiceMetrics) => number) => list.reduce((acc, m) => acc + pick(m), 0);
  const rate = (n: number, d: number) => (d === 0 ? null : n / d);

  const matchCounts = emptyCounts();
  list.forEach((m) => {
    MATCH_OUTCOMES.forEach((outcome) => {
      matchCounts[outcome] += m.matching.counts[outcome];
    });
  });

  const headerFieldsOk = sum((m) => m.header.okCount);
  const headerFieldsEvaluated = sum((m) => m.header.evaluatedCount);
  const headerAllOkCount = list.filter((m) => m.header.headerAllOk).length;
  const linesTp = sum((m) => m.lines.tp);
  const linesFp = sum((m) => m.lines.fp);
  const linesFn = sum((m) => m.lines.fn);
  const exactOk = sum((m) => m.exact.ok);
  const exactTotal = sum((m) => m.exact.total);
  const matchInCatalog = sum((m) => m.matching.inCatalog);
  const matchEvaluated = sum((m) => m.matching.evaluated);

  const durations = list
    .filter((m) => m.pageCount === 1 && m.usage.durationMs !== undefined)
    .map((m) => m.usage.durationMs as number);
  const costs = list.map((m) => m.usage.costUsd).filter((c): c is number => c !== null);

  return {
    invoices: list.length,
    headerFieldsOk,
    headerFieldsEvaluated,
    headerFieldRate: rate(headerFieldsOk, headerFieldsEvaluated),
    headerAllOkCount,
    headerAllOkRate: rate(headerAllOkCount, list.length),
    linesTp,
    linesFp,
    linesFn,
    linesDetectedRate: rate(linesTp, linesTp + linesFp + linesFn),
    exactOk,
    exactTotal,
    exactRate: rate(exactOk, exactTotal),
    matchCounts,
    matchInCatalog,
    matchEvaluated,
    matchOkRate: rate(matchCounts.confirmed_correct + matchCounts.doubtful_correct, matchInCatalog),
    confirmedWrongRate: rate(matchCounts.confirmed_wrong, matchEvaluated),
    duplicates: {
      expected: list.filter((m) => m.duplicate.expected).length,
      detected: list.filter((m) => m.duplicate.detected).length,
      truePositive: list.filter((m) => m.duplicate.expected && m.duplicate.detected).length,
      falsePositive: list.filter((m) => m.duplicate.falsePositive).length,
      missed: list.filter((m) => m.duplicate.expected && !m.duplicate.detected).length,
    },
    p95DurationMs1Page: percentile(durations, 95),
    avgCostUsd: costs.length === 0 ? null : costs.reduce((a, b) => a + b, 0) / costs.length,
    costedInvoices: costs.length,
    inputTokens: sum((m) => m.usage.inputTokens ?? 0),
    outputTokens: sum((m) => m.usage.outputTokens ?? 0),
  };
}

export function aggregate(list: readonly InvoiceMetrics[]): GlobalMetrics {
  return {
    total: aggregateMetrics(list),
    byBucket: {
      sinAlias: aggregateMetrics(list.filter((m) => m.bucket === "sinAlias")),
      conAlias: aggregateMetrics(list.filter((m) => m.bucket === "conAlias")),
    },
  };
}

// ───────────────────────── metas §10 ─────────────────────────

export const TARGETS = {
  sinAlias: {
    headerFieldRate: 0.9,
    linesDetectedRate: 0.95,
    exactRate: 0.9,
    matchOkRate: 0.7,
    confirmedWrongRateMax: 0.02,
  },
  conAlias: {
    headerFieldRate: 0.95,
    linesDetectedRate: 0.95,
    exactRate: 0.9,
    matchOkRate: 0.9,
    confirmedWrongRateMax: 0.02,
  },
  /** Sobre todas las facturas de 1 página. */
  p95DurationMs1PageMax: 15_000,
  /** Plan de pago, media por factura. */
  avgCostUsdMax: 0.01,
} as const;

export type TargetCheck = {
  scope: Bucket | "total";
  metric: string;
  value: number | null;
  target: number;
  comparator: ">=" | "<=";
  /** true sin datos (value null): no se puede afirmar ni negar. */
  skipped: boolean;
  ok: boolean;
};

function check(
  scope: TargetCheck["scope"],
  metric: string,
  value: number | null,
  target: number,
  comparator: TargetCheck["comparator"],
): TargetCheck {
  if (value === null) return { scope, metric, value, target, comparator, skipped: true, ok: true };
  const ok = comparator === ">=" ? value >= target - 1e-9 : value <= target + 1e-9;
  return { scope, metric, value, target, comparator, skipped: false, ok };
}

/** Compara contra §10. `ok` es false si algún chequeo con datos falla. */
export function meetsTargets(global: GlobalMetrics): { ok: boolean; checks: TargetCheck[] } {
  const checks: TargetCheck[] = [];
  BUCKETS.forEach((bucket) => {
    const m = global.byBucket[bucket];
    const t = TARGETS[bucket];
    checks.push(check(bucket, "headerFieldRate", m.headerFieldRate, t.headerFieldRate, ">="));
    checks.push(check(bucket, "linesDetectedRate", m.linesDetectedRate, t.linesDetectedRate, ">="));
    checks.push(check(bucket, "exactRate", m.exactRate, t.exactRate, ">="));
    checks.push(check(bucket, "matchOkRate", m.matchOkRate, t.matchOkRate, ">="));
    checks.push(check(bucket, "confirmedWrongRate", m.confirmedWrongRate, t.confirmedWrongRateMax, "<="));
  });
  checks.push(check("total", "p95DurationMs1Page", global.total.p95DurationMs1Page, TARGETS.p95DurationMs1PageMax, "<="));
  checks.push(check("total", "avgCostUsd", global.total.avgCostUsd, TARGETS.avgCostUsdMax, "<="));
  return { ok: checks.every((c) => c.ok), checks };
}

// ───────────────────────── pares duplicados ─────────────────────────

export type PairSide = { extraction: InvoiceExtraction | null; matched?: InvoiceMatch | null };

export type PairConsistency = {
  consistent: boolean;
  headerSame: boolean;
  headerDiffs: HeaderField[];
  linesSame: boolean;
  unpairedA: number[];
  unpairedB: number[];
  /** Pares alineados con cantidad/precio/total distintos. */
  valueDiffs: { indexA: number; indexB: number }[];
  /** Pares alineados con distinto estado o producto (solo si ambos traen matched). */
  matchDiffs: { indexA: number; indexB: number }[];
};

/**
 * Dos escaneos de la misma factura (f02/f03, f07/f16): misma cabecera y mismas
 * líneas alineadas (todas emparejadas 1 a 1 con iguales cantidad, precio y
 * total; y, si se pasa `matched`, mismo estado y producto).
 */
export function pairConsistency(a: PairSide, b: PairSide): PairConsistency {
  const ea = a.extraction;
  const eb = b.extraction;
  if (!ea || !eb) {
    const same = !ea && !eb;
    return {
      consistent: same,
      headerSame: same,
      headerDiffs: same ? [] : ["supplier", "date", "number", "total"],
      linesSame: same,
      unpairedA: ea ? ea.lines.map((_, i) => i) : [],
      unpairedB: eb ? eb.lines.map((_, i) => i) : [],
      valueDiffs: [],
      matchDiffs: [],
    };
  }

  const headerDiffs: HeaderField[] = [];
  const taxA = ea.supplier.taxId;
  const taxB = eb.supplier.taxId;
  const supplierSame =
    taxA && taxB
      ? taxIdsEqual(taxA, taxB)
      : !taxA && !taxB && normalizeSupplierName(ea.supplier.name) === normalizeSupplierName(eb.supplier.name);
  if (!supplierSame) headerDiffs.push("supplier");
  if ((ea.date ?? "") !== (eb.date ?? "")) headerDiffs.push("date");
  const numberA = ea.number === undefined ? "" : normalizeInvoiceNumber(ea.number);
  const numberB = eb.number === undefined ? "" : normalizeInvoiceNumber(eb.number);
  if (numberA !== numberB) headerDiffs.push("number");
  const totalSame =
    ea.total === undefined || eb.total === undefined
      ? ea.total === eb.total
      : moneyEquals(ea.total, eb.total);
  if (!totalSame) headerDiffs.push("total");

  // alignLines(predicted=B, truth=A): truthIndex es el índice en A.
  const pairs = alignLines(eb.lines, ea.lines);
  const pairedA = new Set(pairs.map((p) => p.truthIndex));
  const pairedB = new Set(pairs.map((p) => p.predictedIndex));
  const unpairedA = ea.lines.map((_, i) => i).filter((i) => !pairedA.has(i));
  const unpairedB = eb.lines.map((_, i) => i).filter((i) => !pairedB.has(i));

  const valueDiffs: PairConsistency["valueDiffs"] = [];
  const matchDiffs: PairConsistency["matchDiffs"] = [];
  const matchA = new Map((a.matched?.lines ?? []).map((l) => [l.index, l]));
  const matchB = new Map((b.matched?.lines ?? []).map((l) => [l.index, l]));
  pairs.forEach(({ truthIndex: indexA, predictedIndex: indexB }) => {
    const la = ea.lines[indexA];
    const lb = eb.lines[indexB];
    if (
      !quantityEquals(la.quantity, lb.quantity) ||
      !moneyEquals(la.unitPrice, lb.unitPrice) ||
      !moneyEquals(la.lineTotal, lb.lineTotal)
    ) {
      valueDiffs.push({ indexA, indexB });
    }
    if (a.matched && b.matched) {
      const ma = matchA.get(indexA);
      const mb = matchB.get(indexB);
      if ((ma?.status ?? "unmatched") !== (mb?.status ?? "unmatched") || ma?.productId !== mb?.productId) {
        matchDiffs.push({ indexA, indexB });
      }
    }
  });

  const headerSame = headerDiffs.length === 0;
  const linesSame =
    unpairedA.length === 0 && unpairedB.length === 0 && valueDiffs.length === 0 && matchDiffs.length === 0;
  return {
    consistent: headerSame && linesSame,
    headerSame,
    headerDiffs,
    linesSame,
    unpairedA,
    unpairedB,
    valueDiffs,
    matchDiffs,
  };
}
