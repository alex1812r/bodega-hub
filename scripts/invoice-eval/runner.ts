/**
 * Runner del banco de evaluación del escaneo de facturas (SCN-10g).
 *
 * `runBench(opts)` recorre las verdades (`truth.ts`), extrae cada factura con
 * un extractor INYECTADO (estructuralmente compatible con `extractInvoice` de
 * `src/modules/invoice-scan/server/extract.ts`), empareja con `matchInvoice`
 * sobre un contexto INYECTADO (el CLI usa `loadMatchContext` contra la base lab)
 * y mide con `metrics.ts`. Antes de cargar el contexto y emparejar aplica
 * `normalizeExtractionForMatch`, igual que `createMatchScan` en producción; lo
 * medido (`predicted`) es la extracción cruda, la que producción guarda. No hace IO propio salvo `readPage` (inyectado) y
 * nunca loguea imágenes ni claves.
 *
 * Pasadas:
 * - "sinAlias": cada factura (orden por id) se extrae sin few-shot y se
 *   empareja con los alias del contexto VACÍOS y con `previousScans` simulados
 *   = escaneos ya procesados en esta pasada.
 * - "conAlias": por proveedor, en orden de id, desde la 2.ª factura: alias
 *   simulados = lo que el usuario habría confirmado en las anteriores del mismo
 *   proveedor. Con `fewShot` re-extrae con hasta 3 anteriores del proveedor
 *   (sin la factura de la que es duplicado ni duplicados de ella); sin
 *   `fewShot` reutiliza la extracción de "sinAlias" (sin volver a contar uso).
 *   La 1.ª factura de cada proveedor no entra en este bucket (no hay nada
 *   aprendido), pero sí alimenta alias y `previousScans`.
 */
import { normalizeAlias } from "@bodega/core/invoice";

import type { InvoiceExtraction, InvoiceMatch } from "../../src/modules/invoice-scan/contracts";
import { matchInvoice } from "../../src/modules/invoice-scan/server/match";
import { normalizeExtractionForMatch } from "../../src/modules/invoice-scan/server/matchScan";
import type {
  MatchAlias,
  MatchContext,
  MatchPreviousScan,
  MatchSupplierCatalog,
} from "../../src/modules/invoice-scan/server/match.types";

import {
  aggregate,
  alignLines,
  evaluateInvoice,
  meetsTargets,
  pairConsistency,
  type Bucket,
  type GlobalMetrics,
  type InvoiceMetrics,
  type PairConsistency,
  type TargetCheck,
} from "./metrics";
import type { InvoiceTruth } from "./truth";

// ───────────────────────── contrato del extractor ─────────────────────────

export type BenchPage = {
  data: Uint8Array;
  mediaType: "image/jpeg" | "image/png" | "image/webp";
};

export type BenchFewShotExample = { page?: BenchPage; confirmed: InvoiceExtraction };

/**
 * Qué factura y qué pasada se extrae. Lo usan los extractores sin modelo
 * (oráculo y replay, SCN-10l); el de producción lo ignora y NUNCA se lo pasa
 * al modelo (lleva la verdad).
 */
export type BenchInvoiceRef = { id: string; bucket: Bucket; truth: InvoiceTruth };

export type BenchExtractInput = {
  pages: BenchPage[];
  fewShot?: BenchFewShotExample[];
  signal?: AbortSignal;
  invoice?: BenchInvoiceRef;
  /** Ids de las facturas usadas como few-shot (parte de la clave de la caché, SCN-10n). */
  fewShotIds?: string[];
};

export type BenchExtractResult = {
  extraction: InvoiceExtraction;
  provider: string;
  modelId: string;
  inputTokens: number | null;
  outputTokens: number | null;
  durationMs: number;
  pages: number;
  /** true si vino de la caché de extracciones (tokens y duración son los de la llamada original). */
  cached?: boolean;
};

/** Misma forma que `extractInvoice` (rama de Extracción): se conecta tal cual en el CLI. */
export type BenchExtractor = (input: BenchExtractInput) => Promise<BenchExtractResult>;

// ───────────────────────── opciones y resultado ─────────────────────────

export type BenchScenario = {
  /** productKey → products.id de la base lab. */
  products: Record<string, string>;
  /** supplierKey → contacts.id de la base lab. */
  suppliers: Record<string, string>;
};

export type BenchProgressEvent = {
  phase: "extract" | "match";
  bucket: Bucket;
  id: string;
  done: number;
  total: number;
  error?: BenchError;
};

export type BenchOptions = {
  truths: readonly InvoiceTruth[];
  extractor: BenchExtractor;
  loadContext: (truth: InvoiceTruth, extraction: InvoiceExtraction) => Promise<MatchContext>;
  scenario: BenchScenario;
  /** Ruta relativa a `scripts/invoice-eval/` (la de `truth.pages`). */
  readPage: (path: string) => BenchPage | Promise<BenchPage>;
  fewShot: boolean;
  /** Extracciones en paralelo (el emparejamiento siempre es secuencial). Default 1. */
  concurrency?: number;
  onProgress?: (event: BenchProgressEvent) => void;
  signal?: AbortSignal;
  /** Reloj inyectable para tests. */
  now?: () => Date;
  /**
   * Orden de las EXTRACCIONES dentro de cada pasada (el emparejamiento siempre
   * va por id). "realFirst": reales antes que sintéticas, para que un corte por
   * cuota deje medidas las reales. Default "id".
   */
  extractOrder?: "id" | "realFirst";
};

export type BenchError = { message: string; code?: string };

export type BenchInvoiceResult = {
  id: string;
  synthetic: boolean;
  bucket: Bucket;
  metrics: InvoiceMetrics;
  error?: BenchError;
  durationMs: number | null;
  tokens: { input: number | null; output: number | null };
  costUsd: number | null;
  /** conAlias sin few-shot: extracción de "sinAlias" reutilizada (uso no contado de nuevo). */
  reusedExtraction: boolean;
  /** Ids de las facturas usadas como few-shot. */
  fewShotIds: string[];
  /** La extracción contada vino de la caché (SCN-10n). */
  fromCache: boolean;
  /** Id (de la verdad) del escaneo previo que el emparejamiento marcó como duplicado. */
  duplicateOfScanId?: string;
  predicted: InvoiceExtraction | null;
  matched: InvoiceMatch | null;
};

export type BenchPairResult = {
  bucket: Bucket;
  id: string;
  duplicateOf: string;
  consistency: PairConsistency;
  expectedDetected: true;
  detected: boolean;
  detectedOf?: string;
};

export type BenchResult = {
  meta: {
    provider: string;
    modelId: string;
    date: string;
    fewShot: boolean;
    invoices: { real: number; synthetic: number };
  };
  perInvoice: BenchInvoiceResult[];
  global: { all: GlobalMetrics; real: GlobalMetrics; synthetic: GlobalMetrics };
  pairs: BenchPairResult[];
  targets: { ok: boolean; checks: TargetCheck[] };
};

// ───────────────────────── utilidades ─────────────────────────

type Extracted = {
  result?: BenchExtractResult;
  error?: BenchError;
  fewShotIds: string[];
};

type ScanState = {
  truth: InvoiceTruth;
  extraction: InvoiceExtraction | null;
  matched: InvoiceMatch | null;
};

function byId(a: InvoiceTruth, b: InvoiceTruth): number {
  return a.id.localeCompare(b.id, "en", { numeric: true });
}

/** Mensaje y código del error, sin volcar el objeto (podría traer la petición). */
export function toBenchError(error: unknown): BenchError {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "Error desconocido";
  if (typeof error !== "object" || error === null) {
    return { message };
  }
  const record = error as Record<string, unknown>;
  for (const key of ["code", "status", "statusCode"]) {
    const value = record[key];
    if (typeof value === "string" || typeof value === "number") {
      return { message, code: String(value) };
    }
  }
  return { message };
}

async function mapPool<T, R>(items: readonly T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

function expectedContactId(truth: InvoiceTruth, scenario: BenchScenario): string | null {
  return truth.supplierKey ? (scenario.suppliers[truth.supplierKey] ?? null) : null;
}

/** Raíz de un grupo de duplicados: la factura original. */
function duplicateRoot(truth: InvoiceTruth): string {
  return truth.duplicateOf ?? truth.id;
}

function emptyCatalog(): MatchSupplierCatalog {
  return { supplierProducts: [], aliases: [], packUnits: [] };
}

/** Copia del contexto con alias vacíos, `previousScans` simulados y alias inyectados en `contactId`. */
function prepareContext(
  ctx: MatchContext,
  previousScans: MatchPreviousScan[],
  inject?: { contactId: string; aliases: MatchAlias[] },
): MatchContext {
  const supplierCatalogs: Record<string, MatchSupplierCatalog> = {};
  for (const [contactId, catalog] of Object.entries(ctx.supplierCatalogs)) {
    supplierCatalogs[contactId] = { ...catalog, aliases: [] };
  }
  if (inject) {
    const base = supplierCatalogs[inject.contactId] ?? emptyCatalog();
    supplierCatalogs[inject.contactId] = { ...base, aliases: inject.aliases.map((alias) => ({ ...alias })) };
  }
  return { ...ctx, supplierCatalogs, previousScans: [...previousScans] };
}

/**
 * Escaneo previo tal como lo vería producción: el proveedor que resolvió el
 * emparejamiento (o ninguno) y el RIF leído; nunca el contacto de la verdad.
 */
function toPreviousScan(state: ScanState): MatchPreviousScan | null {
  if (!state.extraction) return null;
  return {
    scanId: state.truth.id,
    supplierId: state.matched?.supplier.contactId ?? null,
    supplierTaxId: state.extraction.supplier.taxId ?? null,
    number: state.extraction.number ?? null,
    date: state.extraction.date ?? null,
    total: state.extraction.total ?? null,
  };
}

/**
 * Alias que el usuario habría confirmado en `previous` (en orden): cada línea
 * predicha alineada con una línea de verdad cuyo productKey está en el
 * escenario. Mismo texto con otro producto: se reasigna (hits vuelve a 1).
 */
export function learnAliases(previous: readonly ScanStateLike[], scenario: BenchScenario): MatchAlias[] {
  const byNorm = new Map<string, MatchAlias>();
  for (const state of previous) {
    if (!state.extraction) continue;
    const predictedLines = state.extraction.lines;
    const truthLines = state.truth.extraction.lines;
    for (const pair of alignLines(predictedLines, truthLines)) {
      const productKey = state.truth.lines[pair.truthIndex]?.productKey;
      const productId = productKey ? scenario.products[productKey] : undefined;
      if (!productId) continue;
      const predicted = predictedLines[pair.predictedIndex];
      const truthLine = truthLines[pair.truthIndex];
      const aliasNorm = normalizeAlias(predicted.rawText);
      if (!aliasNorm) continue;
      const packLabel = predicted.unit ?? truthLine.unit ?? null;
      const unitsPerPack = truthLine.unitsPerPack ?? null;
      const existing = byNorm.get(aliasNorm);
      if (existing && existing.productId === productId) {
        byNorm.set(aliasNorm, { ...existing, packLabel, unitsPerPack, hits: existing.hits + 1 });
      } else {
        byNorm.set(aliasNorm, { aliasNorm, productId, packLabel, unitsPerPack, hits: 1 });
      }
    }
  }
  return [...byNorm.values()];
}

export type ScanStateLike = Pick<ScanState, "truth" | "extraction">;

// ───────────────────────── runner ─────────────────────────

export async function runBench(opts: BenchOptions): Promise<BenchResult> {
  const truths = [...opts.truths].sort(byId);
  const concurrency = opts.concurrency ?? 1;
  const { scenario } = opts;
  /** Fecha de la corrida: fija el precio vigente del costo estimado y `meta.date`. */
  const runAt = opts.now ? opts.now() : new Date();
  let provider: string | undefined;
  let modelId: string | undefined;

  const extract = async (truth: InvoiceTruth, bucket: Bucket, fewShotFrom: InvoiceTruth[]): Promise<Extracted> => {
    const fewShotIds = fewShotFrom.map((t) => t.id);
    try {
      const pages = await Promise.all(truth.pages.map((path) => opts.readPage(path)));
      const fewShot: BenchFewShotExample[] = [];
      for (const example of fewShotFrom) {
        fewShot.push({ page: await opts.readPage(example.pages[0]), confirmed: example.extraction });
      }
      const result = await opts.extractor({
        pages,
        ...(fewShot.length > 0 ? { fewShot } : {}),
        ...(opts.signal ? { signal: opts.signal } : {}),
        invoice: { id: truth.id, bucket, truth },
        ...(fewShotIds.length > 0 ? { fewShotIds } : {}),
      });
      provider ??= result.provider;
      modelId ??= result.modelId;
      return { result, fewShotIds };
    } catch (error) {
      return { error: toBenchError(error), fewShotIds };
    }
  };

  const perInvoice: BenchInvoiceResult[] = [];
  const truthById = new Map(truths.map((truth) => [truth.id, truth]));
  const contextCache = new Map<string, MatchContext>();

  /**
   * Empareja y mide. `contextKey` cachea el contexto por extracción (la misma
   * extracción reutilizada no vuelve a cargarlo); `countUsage` es false cuando
   * la extracción es la de "sinAlias" reutilizada (su uso ya contó allí).
   */
  const evaluate = async (input: {
    truth: InvoiceTruth;
    bucket: Bucket;
    extracted: Extracted;
    previousScans: MatchPreviousScan[];
    aliases?: MatchAlias[];
    contextKey: string;
    countUsage: boolean;
  }): Promise<{ state: ScanState; entry: BenchInvoiceResult }> => {
    const { truth, bucket, extracted } = input;
    let extraction = extracted.result?.extraction ?? null;
    let matched: InvoiceMatch | null = null;
    let error = extracted.error;
    if (extraction) {
      try {
        // Mismo camino que producción (`createMatchScan`): se empareja la lectura normalizada.
        const forMatch = normalizeExtractionForMatch(extraction);
        let ctx = contextCache.get(input.contextKey);
        if (!ctx) {
          ctx = await opts.loadContext(truth, forMatch);
          contextCache.set(input.contextKey, ctx);
        }
        const contactId = expectedContactId(truth, scenario);
        const inject = input.aliases && contactId ? { contactId, aliases: input.aliases } : undefined;
        matched = matchInvoice(forMatch, prepareContext(ctx, input.previousScans, inject));
      } catch (caught) {
        error = toBenchError(caught);
      }
    }
    const usage = input.countUsage ? extracted.result : undefined;
    // Ejemplos few-shot de esta extracción (solo si se extrajo de nuevo con ellos).
    const fewShot = usage
      ? extracted.fewShotIds.flatMap((id) => {
          const example = truthById.get(id);
          return example ? [example.extraction] : [];
        })
      : [];
    const measure = (predicted: InvoiceExtraction | null, match: InvoiceMatch | null) =>
      evaluateInvoice({
        truth,
        predicted,
        matched: match,
        catalog: scenario.products,
        bucket,
        expectedContactId: expectedContactId(truth, scenario),
        at: runAt,
        ...(fewShot.length > 0 ? { fewShot } : {}),
        ...(usage
          ? {
              durationMs: usage.durationMs,
              ...(usage.inputTokens !== null ? { inputTokens: usage.inputTokens } : {}),
              ...(usage.outputTokens !== null ? { outputTokens: usage.outputTokens } : {}),
              modelId: usage.modelId,
            }
          : {}),
      });
    let metrics: InvoiceMetrics;
    try {
      metrics = measure(extraction, matched);
    } catch (caught) {
      // Extracción que las métricas no pueden leer: error de la factura, la corrida sigue.
      error = toBenchError(caught);
      extraction = null;
      matched = null;
      metrics = measure(null, null);
    }
    const entry: BenchInvoiceResult = {
      id: truth.id,
      synthetic: truth.synthetic,
      bucket,
      metrics,
      ...(error ? { error } : {}),
      durationMs: usage?.durationMs ?? null,
      tokens: { input: usage?.inputTokens ?? null, output: usage?.outputTokens ?? null },
      costUsd: metrics.usage.costUsd,
      reusedExtraction: !input.countUsage,
      fewShotIds: extracted.fewShotIds,
      fromCache: input.countUsage && extracted.result?.cached === true,
      ...(matched?.duplicateOfScanId ? { duplicateOfScanId: matched.duplicateOfScanId } : {}),
      predicted: extraction,
      matched,
    };
    return { state: { truth, extraction, matched }, entry };
  };

  const extractionOrder = <T>(items: readonly T[], truthOf: (item: T) => InvoiceTruth): T[] =>
    opts.extractOrder === "realFirst"
      ? [...items].sort((a, b) => Number(truthOf(a).synthetic) - Number(truthOf(b).synthetic) || byId(truthOf(a), truthOf(b)))
      : [...items];

  // a) sinAlias
  let extractedCount = 0;
  const orderA = extractionOrder(truths, (truth) => truth);
  const passA = await mapPool(orderA, concurrency, async (truth) => {
    const extracted = await extract(truth, "sinAlias", []);
    extractedCount += 1;
    opts.onProgress?.({
      phase: "extract",
      bucket: "sinAlias",
      id: truth.id,
      done: extractedCount,
      total: truths.length,
      ...(extracted.error ? { error: extracted.error } : {}),
    });
    return extracted;
  });
  const extractedA = new Map(orderA.map((truth, index) => [truth.id, passA[index]]));
  const stateA = new Map<string, ScanState>();
  const scansA: MatchPreviousScan[] = [];
  for (const [index, truth] of truths.entries()) {
    const { state, entry } = await evaluate({
      truth,
      bucket: "sinAlias",
      extracted: extractedA.get(truth.id) as Extracted,
      previousScans: scansA,
      contextKey: truth.id,
      countUsage: true,
    });
    perInvoice.push(entry);
    stateA.set(truth.id, state);
    const scan = toPreviousScan(state);
    if (scan) scansA.push(scan);
    opts.onProgress?.({ phase: "match", bucket: "sinAlias", id: truth.id, done: index + 1, total: truths.length });
  }

  // b) conAlias
  const groups = new Map<string, InvoiceTruth[]>();
  for (const truth of truths) {
    if (!truth.supplierKey) continue;
    const list = groups.get(truth.supplierKey) ?? [];
    list.push(truth);
    groups.set(truth.supplierKey, list);
  }
  const targetsB: { truth: InvoiceTruth; previous: InvoiceTruth[] }[] = [];
  for (const list of groups.values()) {
    list.forEach((truth, index) => {
      if (index > 0) targetsB.push({ truth, previous: list.slice(0, index) });
    });
  }
  targetsB.sort((a, b) => byId(a.truth, b.truth));

  const extractedB = new Map<string, Extracted>();
  if (opts.fewShot) {
    let done = 0;
    const orderB = extractionOrder(targetsB, (target) => target.truth);
    const results = await mapPool(orderB, concurrency, async ({ truth, previous }) => {
      const root = duplicateRoot(truth);
      const examples = previous.filter((p) => duplicateRoot(p) !== root).slice(-3);
      const extracted = await extract(truth, "conAlias", examples);
      done += 1;
      opts.onProgress?.({
        phase: "extract",
        bucket: "conAlias",
        id: truth.id,
        done,
        total: targetsB.length,
        ...(extracted.error ? { error: extracted.error } : {}),
      });
      return extracted;
    });
    orderB.forEach(({ truth }, index) => extractedB.set(truth.id, results[index]));
  }

  // Estado por factura en conAlias: las primeras de cada proveedor quedan con su estado de sinAlias.
  const stateB = new Map<string, ScanState>();
  const scansB: MatchPreviousScan[] = [];
  const pendingB = new Set(targetsB.map((t) => t.truth.id));
  let matchedB = 0;
  for (const truth of truths) {
    if (!truth.supplierKey) continue;
    let state: ScanState;
    if (!pendingB.has(truth.id)) {
      state = stateA.get(truth.id) as ScanState;
    } else {
      const previous = (groups.get(truth.supplierKey) ?? []).filter((p) => byId(p, truth) < 0);
      const aliases = learnAliases(
        previous.map((p) => stateB.get(p.id) ?? (stateA.get(p.id) as ScanState)),
        scenario,
      );
      const reused = !opts.fewShot;
      const extracted = reused ? (extractedA.get(truth.id) as Extracted) : (extractedB.get(truth.id) as Extracted);
      const evaluated = await evaluate({
        truth,
        bucket: "conAlias",
        extracted,
        previousScans: scansB,
        aliases,
        contextKey: reused ? truth.id : `conAlias:${truth.id}`,
        countUsage: !reused,
      });
      perInvoice.push(evaluated.entry);
      state = evaluated.state;
      matchedB += 1;
      opts.onProgress?.({ phase: "match", bucket: "conAlias", id: truth.id, done: matchedB, total: targetsB.length });
    }
    stateB.set(truth.id, state);
    const scan = toPreviousScan(state);
    if (scan) scansB.push(scan);
  }

  // c) pares duplicados
  const pairs: BenchPairResult[] = [];
  const bucketStates: [Bucket, Map<string, ScanState>, Set<string> | null][] = [
    ["sinAlias", stateA, null],
    ["conAlias", stateB, pendingB],
  ];
  for (const [bucket, states, included] of bucketStates) {
    for (const truth of truths) {
      if (!truth.duplicateOf) continue;
      if (included && !included.has(truth.id)) continue;
      const original = states.get(truth.duplicateOf);
      const duplicate = states.get(truth.id);
      if (!original || !duplicate) continue;
      const detectedOf = duplicate.matched?.duplicateOfScanId;
      pairs.push({
        bucket,
        id: truth.id,
        duplicateOf: truth.duplicateOf,
        // conAlias: el duplicado hereda los alias aprendidos del original, así que su
        // emparejamiento difiere por construcción; ahí se compara solo la extracción.
        consistency:
          bucket === "sinAlias"
            ? pairConsistency(
                { extraction: original.extraction, matched: original.matched },
                { extraction: duplicate.extraction, matched: duplicate.matched },
              )
            : pairConsistency({ extraction: original.extraction }, { extraction: duplicate.extraction }),
        expectedDetected: true,
        detected: Boolean(detectedOf),
        ...(detectedOf ? { detectedOf } : {}),
      });
    }
  }

  const metricsOf = (filter: (entry: BenchInvoiceResult) => boolean) =>
    aggregate(perInvoice.filter(filter).map((entry) => entry.metrics));
  const all = metricsOf(() => true);

  return {
    meta: {
      provider: provider ?? "desconocido",
      modelId: modelId ?? "desconocido",
      date: runAt.toISOString(),
      fewShot: opts.fewShot,
      invoices: {
        real: truths.filter((t) => !t.synthetic).length,
        synthetic: truths.filter((t) => t.synthetic).length,
      },
    },
    perInvoice,
    global: {
      all,
      real: metricsOf((entry) => !entry.synthetic),
      synthetic: metricsOf((entry) => entry.synthetic),
    },
    pairs,
    targets: meetsTargets(all),
  };
}
