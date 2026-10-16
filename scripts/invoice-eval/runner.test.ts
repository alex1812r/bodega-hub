/**
 * @jest-environment node
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { normalizeAlias } from "@bodega/core/invoice";

import type { InvoiceExtraction } from "../../src/modules/invoice-scan/contracts";
import type {
  MatchContext,
  MatchPackUnit,
  MatchProduct,
  MatchSupplierCandidate,
  MatchSupplierCatalog,
} from "../../src/modules/invoice-scan/server/match.types";

import { alignLines } from "./metrics";
import { ORACLE_BANNER, PAIR_NA, pairSummary, renderMarkdown, toJson, writeRunFiles } from "./report";
import {
  createOracleExtractor,
  createReplayExtractor,
  parseReplaySource,
  REPLAY_MISSING_CODE,
  REPLAY_MISSING_MESSAGE,
  renderRunMarkdown,
  writeRun,
  type RunMeta,
} from "./run";
import {
  learnAliases,
  runBench,
  toBenchError,
  type BenchExtractInput,
  type BenchExtractor,
  type BenchExtractResult,
  type BenchOptions,
  type BenchPage,
  type BenchResult,
  type BenchScenario,
} from "./runner";
import { parseTruth, type InvoiceTruth } from "./truth";

const TRUTH_DIR = join(__dirname, "truth");
const FIXTURE_IDS = ["f01", "f02", "f03", "f07", "f11", "f14", "f16", "s01"];

function readTruth(id: string): InvoiceTruth {
  return parseTruth(JSON.parse(readFileSync(join(TRUTH_DIR, `${id}.json`), "utf8")), `${id}.json`);
}

const TRUTHS: InvoiceTruth[] = FIXTURE_IDS.map(readTruth);
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Escenario derivado de las propias verdades: no depende de los productKey concretos. */
function buildScenario(truths: readonly InvoiceTruth[]): BenchScenario {
  const products: Record<string, string> = {};
  const suppliers: Record<string, string> = {};
  for (const truth of truths) {
    if (truth.supplierKey) suppliers[truth.supplierKey] = `c:${truth.supplierKey}`;
    for (const line of truth.lines) {
      if (line.productKey) products[line.productKey] = `p:${line.productKey}`;
    }
  }
  return { products, suppliers };
}

const SCENARIO = buildScenario(TRUTHS);

/**
 * Contexto en memoria: todos los proveedores y productos de las verdades,
 * empaques registrados con los tamaños de la verdad, fuzzy con el producto
 * correcto como candidato. Trae alias y escaneos previos "envenenados" para
 * comprobar que el runner los reemplaza.
 */
function buildLoadContext(truths: readonly InvoiceTruth[]) {
  const products = new Map<string, MatchProduct>();
  const candidates = new Map<string, MatchSupplierCandidate>();
  const catalogs: Record<string, MatchSupplierCatalog> = {};
  for (const truth of truths) {
    if (!truth.supplierKey) continue;
    const contactId = SCENARIO.suppliers[truth.supplierKey];
    if (!candidates.has(contactId)) {
      candidates.set(contactId, {
        contactId,
        name: truth.extraction.supplier.name,
        taxId: truth.extraction.supplier.taxId ?? null,
      });
    }
    const catalog = (catalogs[contactId] ??= { supplierProducts: [], aliases: [], packUnits: [] });
    truth.lines.forEach((meta, index) => {
      if (!meta.productKey) return;
      const productId = SCENARIO.products[meta.productKey];
      const line = truth.extraction.lines[index];
      if (!products.has(productId)) {
        products.set(productId, {
          id: productId,
          name: line.description,
          sku: null,
          barcode: null,
          active: true,
          taxRateCode: null,
          hasRecipe: false,
        });
      }
      if (!catalog.supplierProducts.some((link) => link.productId === productId)) {
        catalog.supplierProducts.push({ supplierProductId: `sp:${contactId}:${productId}`, productId, supplierSku: null });
      }
      const size = line.unitsPerPack;
      if (size && !catalog.packUnits.some((pack) => pack.productId === productId && pack.unitsPerPack === size)) {
        const pack: MatchPackUnit = { id: `pu:${productId}:${size}`, productId, label: `x${size}`, unitsPerPack: size };
        catalog.packUnits.push(pack);
      }
      catalog.aliases.push({ aliasNorm: normalizeAlias(line.rawText), productId, packLabel: null, unitsPerPack: null, hits: 9 });
    });
  }

  const calls: string[] = [];
  const loadContext = async (truth: InvoiceTruth, extraction: InvoiceExtraction): Promise<MatchContext> => {
    calls.push(truth.id);
    const fuzzy: MatchContext["fuzzy"] = {};
    for (const pair of alignLines(extraction.lines, truth.extraction.lines)) {
      const key = truth.lines[pair.truthIndex].productKey;
      if (key) fuzzy[pair.predictedIndex] = [{ productId: SCENARIO.products[key], score: 0.8, via: "name" }];
    }
    return {
      storeId: "store-lab",
      supplierCandidates: [...candidates.values()],
      supplierCatalogs: structuredClone(catalogs),
      products: [...products.values()],
      fuzzy,
      taxRates: [],
      previousScans: [{ scanId: "viejo", supplierId: SCENARIO.suppliers[truth.supplierKey ?? ""] ?? null, number: truth.extraction.number ?? null }],
    };
  };
  return { loadContext, calls };
}

function readPage(path: string): BenchPage {
  return { data: encoder.encode(path), mediaType: "image/jpeg" };
}

const BY_PAGE = new Map(TRUTHS.map((truth) => [truth.pages[0], truth]));

function truthOfPage(page: BenchPage): InvoiceTruth {
  const truth = BY_PAGE.get(decoder.decode(page.data));
  if (!truth) throw new Error("página desconocida");
  return truth;
}

function fakeExtractor(options: { failFor?: string; error?: unknown; calls?: BenchExtractInput[] } = {}): BenchExtractor {
  return async (input) => {
    options.calls?.push(input);
    const truth = truthOfPage(input.pages[0]);
    if (truth.id === options.failFor) throw options.error;
    const result: BenchExtractResult = {
      extraction: structuredClone(truth.extraction),
      provider: "fake",
      modelId: "gemini-2.5-flash-lite",
      inputTokens: 1000,
      outputTokens: 200,
      durationMs: 1500,
      pages: input.pages.length,
    };
    return result;
  };
}

function options(overrides: Partial<BenchOptions> = {}): BenchOptions {
  return {
    truths: TRUTHS,
    extractor: fakeExtractor(),
    loadContext: buildLoadContext(TRUTHS).loadContext,
    scenario: SCENARIO,
    readPage,
    fewShot: false,
    now: () => new Date("2026-10-15T12:00:00.000Z"),
    ...overrides,
  };
}

function entry(result: BenchResult, id: string, bucket: "sinAlias" | "conAlias") {
  const found = result.perInvoice.find((e) => e.id === id && e.bucket === bucket);
  if (!found) throw new Error(`sin resultado ${id}/${bucket}`);
  return found;
}

describe("runBench", () => {
  it("con extracción perfecta: cabecera, líneas y exactitud al 100 % y sin confirmadas sin alias", async () => {
    const result = await runBench(options({ concurrency: 3 }));
    const sin = result.global.all.byBucket.sinAlias;
    expect(sin.invoices).toBe(TRUTHS.length);
    expect(sin.headerFieldRate).toBe(1);
    expect(sin.linesDetectedRate).toBe(1);
    expect(sin.exactRate).toBe(1);
    expect(sin.matchOkRate).toBe(1);
    // Los alias del contexto se vacían: sin alias nada se confirma.
    expect(sin.matchCounts.confirmed_correct).toBe(0);
    expect(sin.confirmedWrongRate).toBe(0);
    expect(result.meta).toEqual({
      provider: "fake",
      modelId: "gemini-2.5-flash-lite",
      date: "2026-10-15T12:00:00.000Z",
      fewShot: false,
      invoices: { real: 7, synthetic: 1 },
    });
    expect(result.global.synthetic.total.invoices).toBe(1);
    expect(result.global.real.byBucket.sinAlias.invoices).toBe(7);
    expect(entry(result, "f01", "sinAlias").costUsd).toBeCloseTo((1000 * 0.1 + 200 * 0.4) / 1e6, 10);
  });

  it("con alias: la 2.ª factura del proveedor confirma las líneas aprendidas de la 1.ª", async () => {
    const result = await runBench(options());
    const f01 = TRUTHS[0];
    const f02 = entry(result, "f02", "conAlias");
    const learned = new Set(f01.lines.map((line) => line.productKey));
    const expectedConfirmed = f02.metrics.matching.perLine.filter((line) => learned.has(line.productKey));
    expect(expectedConfirmed.length).toBeGreaterThan(0);
    expect(expectedConfirmed.every((line) => line.outcome === "confirmed_correct")).toBe(true);
    expect(f02.metrics.matching.counts.confirmed_wrong).toBe(0);
    // Las no vistas siguen dudosas con el candidato correcto.
    const others = f02.metrics.matching.perLine.filter((line) => !learned.has(line.productKey));
    expect(others.every((line) => line.outcome === "doubtful_correct")).toBe(true);
    // La 1.ª de cada proveedor no entra en "con alias"; sin few-shot la extracción se reutiliza.
    expect(result.perInvoice.some((e) => e.id === "f01" && e.bucket === "conAlias")).toBe(false);
    expect(f02.reusedExtraction).toBe(true);
    expect(f02.tokens).toEqual({ input: null, output: null });
  });

  it("detecta f03 como duplicado de f02 y f16 de f07, pero no f14 de f11", async () => {
    const result = await runBench(options());
    for (const bucket of ["sinAlias", "conAlias"] as const) {
      expect(entry(result, "f03", bucket).duplicateOfScanId).toBe("f02");
      expect(entry(result, "f16", bucket).duplicateOfScanId).toBe("f07");
      expect(entry(result, "f14", bucket).duplicateOfScanId).toBeUndefined();
    }
    expect(entry(result, "f11", "sinAlias").duplicateOfScanId).toBeUndefined();
    expect(entry(result, "f02", "sinAlias").duplicateOfScanId).toBeUndefined();
    expect(result.global.all.byBucket.sinAlias.duplicates).toMatchObject({ expected: 2, truePositive: 2, falsePositive: 0 });
    const pairs = result.pairs.filter((pair) => pair.bucket === "sinAlias");
    expect(pairs.map((pair) => `${pair.duplicateOf}/${pair.id}`)).toEqual(["f02/f03", "f07/f16"]);
    expect(pairs.every((pair) => pair.detected)).toBe(true);
    expect(pairs.find((pair) => pair.id === "f03")?.consistency.consistent).toBe(true);
  });

  it("few-shot: hasta 3 anteriores del proveedor, sin la original ni duplicados de ella", async () => {
    const calls: BenchExtractInput[] = [];
    const result = await runBench(options({ fewShot: true, extractor: fakeExtractor({ calls }) }));
    expect(entry(result, "f03", "conAlias").fewShotIds).toEqual(["f01"]);
    expect(entry(result, "f16", "conAlias").fewShotIds).toEqual(["f02", "f03", "f14"]);
    expect(entry(result, "f02", "conAlias").fewShotIds).toEqual(["f01"]);
    const f03Call = calls.find((call) => call.fewShot && truthOfPage(call.pages[0]).id === "f03");
    expect(f03Call?.fewShot?.map((example) => truthOfPage(example.page as BenchPage).id)).toEqual(["f01"]);
    expect(f03Call?.fewShot?.[0].confirmed).toEqual(TRUTHS[0].extraction);
    const f03 = entry(result, "f03", "conAlias");
    expect(f03.reusedExtraction).toBe(false);
    expect(f03.tokens).toEqual({ input: 1000, output: 200 });
    expect(result.meta.fewShot).toBe(true);
  });

  it("empareja con la extracción normalizada como producción: taxId vacío no llega al contexto ni al match", async () => {
    const base = fakeExtractor();
    const extractor: BenchExtractor = async (input) => {
      const result = await base(input);
      return { ...result, extraction: { ...result.extraction, supplier: { ...result.extraction.supplier, taxId: "  " } } };
    };
    const seen: InvoiceExtraction[] = [];
    const { loadContext } = buildLoadContext(TRUTHS);
    const result = await runBench(
      options({
        truths: [TRUTHS[0]],
        extractor,
        loadContext: async (truth, extraction) => {
          seen.push(extraction);
          return loadContext(truth, extraction);
        },
      }),
    );
    expect(seen).toHaveLength(1);
    expect("taxId" in seen[0].supplier).toBe(false);
    const f01 = entry(result, "f01", "sinAlias");
    // Lo medido es la lectura cruda (la que producción guarda en `extracted`).
    expect(f01.predicted?.supplier.taxId).toBe("  ");
    expect(f01.matched).not.toBeNull();
  });

  it("un extractor que lanza deja la factura con error y la corrida sigue", async () => {
    const quota = Object.assign(new Error("Se agotó la cuota"), { code: "QUOTA" });
    const progress: string[] = [];
    const result = await runBench(
      options({
        extractor: fakeExtractor({ failFor: "f02", error: quota }),
        onProgress: (event) => progress.push(`${event.phase}:${event.bucket}:${event.id}${event.error ? "!" : ""}`),
      }),
    );
    const failed = entry(result, "f02", "sinAlias");
    expect(failed.error).toEqual({ message: "Se agotó la cuota", code: "QUOTA" });
    expect(failed.predicted).toBeNull();
    expect(failed.metrics.lines.fn).toBe(TRUTHS[1].lines.length);
    expect(entry(result, "f02", "conAlias").error?.code).toBe("QUOTA");
    expect(entry(result, "f01", "sinAlias").error).toBeUndefined();
    expect(entry(result, "f14", "sinAlias").metrics.exact.rate).toBe(1);
    expect(progress).toContain("extract:sinAlias:f02!");
    expect(progress).toContain("match:sinAlias:s01");
  });
});

describe("learnAliases", () => {
  it("acumula hits y reasigna si el mismo texto cambia de producto", () => {
    const base = TRUTHS[0];
    const reassigned: InvoiceTruth = structuredClone(base);
    reassigned.lines[0] = { ...reassigned.lines[0], productKey: base.lines[1].productKey };
    const aliases = learnAliases(
      [
        { truth: base, extraction: base.extraction },
        { truth: base, extraction: base.extraction },
        { truth: reassigned, extraction: reassigned.extraction },
      ],
      SCENARIO,
    );
    const first = aliases.find((alias) => alias.aliasNorm.includes("glup cola 2l"));
    expect(first).toMatchObject({ productId: SCENARIO.products[base.lines[1].productKey ?? ""], hits: 1, unitsPerPack: 6, packLabel: "bulto" });
    const second = aliases.find((alias) => alias.productId === SCENARIO.products[base.lines[2].productKey ?? ""]);
    expect(second?.hits).toBe(3);
  });
});

describe("toBenchError", () => {
  it("toma code, o status como código", () => {
    expect(toBenchError(Object.assign(new Error("x"), { status: 429 }))).toEqual({ message: "x", code: "429" });
    expect(toBenchError("texto")).toEqual({ message: "texto" });
  });
});

describe("report", () => {
  it("renderMarkdown trae metas, tablas, sintéticas y casos no inventar; writeRunFiles no sobrescribe", async () => {
    const result = await runBench(
      options({ extractor: fakeExtractor({ failFor: "f11", error: Object.assign(new Error("caído"), { status: 429 }) }) }),
    );
    const markdown = renderMarkdown(result);
    expect(markdown).toContain("## Metas (plan §10)");
    expect(markdown).toContain("| Ámbito | Métrica | Valor | Meta | Resultado |");
    expect(markdown).toContain("Campos de cabecera");
    expect(markdown).toContain("s01 (sintética)");
    expect(markdown).toContain("## Pares duplicados");
    expect(markdown).toContain("f02 / f03");
    expect(markdown).toContain('## Casos "no inventar"');
    expect(markdown).toMatch(/- f07 \(sin alias\): ✓ ninguna línea inventada/);
    expect(markdown).toContain("f11 (sin alias) [429]: caído");
    expect(JSON.parse(toJson(result)).meta.provider).toBe("fake");

    const dir = mkdtempSync(join(tmpdir(), "invoice-eval-runs-"));
    try {
      const first = writeRunFiles(result, dir);
      const second = writeRunFiles(result, dir);
      expect(first.markdownPath).toBe(join(dir, "2026-10-15-fake.md"));
      expect(second.jsonPath).toBe(join(dir, "2026-10-15-fake-2.json"));
      expect(existsSync(first.jsonPath) && existsSync(second.markdownPath)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("modos sin modelo (SCN-10l)", () => {
  it("oráculo: la extracción es la verdad; cabecera/exactitud al 100 %, emparejamiento calculado, 0 tokens", async () => {
    const result = await runBench(options({ extractor: createOracleExtractor(), concurrency: 3 }));
    const sin = result.global.all.byBucket.sinAlias;
    expect(sin.headerFieldRate).toBe(1);
    expect(sin.linesDetectedRate).toBe(1);
    expect(sin.exactRate).toBe(1);
    expect(sin.matchOkRate).toBe(1);
    expect(sin.matchCounts.doubtful_correct).toBeGreaterThan(0);
    expect(result.global.all.byBucket.conAlias.matchCounts.confirmed_correct).toBeGreaterThan(0);
    expect(result.meta).toMatchObject({ provider: "oracle", modelId: "verdad" });
    const f01 = entry(result, "f01", "sinAlias");
    expect(f01.predicted).toEqual(TRUTHS[0].extraction);
    expect(f01.predicted).not.toBe(TRUTHS[0].extraction);
    expect(f01.tokens).toEqual({ input: null, output: null });
    expect(f01.costUsd).toBeNull();
    expect(f01.durationMs).toBe(0);
  });

  it("el runner indica factura y pasada al extractor", async () => {
    const calls: BenchExtractInput[] = [];
    await runBench(options({ fewShot: true, extractor: fakeExtractor({ calls }) }));
    const refs = calls.map((call) => `${call.invoice?.id}:${call.invoice?.bucket}`);
    expect(refs).toContain("f01:sinAlias");
    expect(refs).toContain("f02:conAlias");
    expect(calls.every((call) => call.invoice?.truth.id === truthOfPage(call.pages[0]).id)).toBe(true);
  });

  /** run.json mínimo: f01/f02 sinAlias con extracción; f02 conAlias con otra (few-shot); f03 sin nada (error). */
  function replaySourceJson() {
    const tweak = (truth: InvoiceTruth, total: number) => ({ ...structuredClone(truth.extraction), total });
    return {
      run: { requested: { provider: "google", model: "gemini-2.5-flash" }, fewShot: true },
      meta: { provider: "google", modelId: "gemini-2.5-flash", fewShot: true },
      perInvoice: [
        { id: "f01", bucket: "sinAlias", predicted: tweak(TRUTHS[0], 111), tokens: { input: 1000, output: 200 }, durationMs: 4000 },
        { id: "f02", bucket: "sinAlias", predicted: tweak(TRUTHS[1], 222), tokens: { input: 900, output: 100 }, durationMs: 3000 },
        { id: "f02", bucket: "conAlias", predicted: tweak(TRUTHS[1], 333), tokens: { input: 2000, output: 150 }, durationMs: 5000 },
        { id: "f03", bucket: "sinAlias", predicted: null, error: { message: "cuota", code: "QUOTA" }, tokens: { input: null, output: null }, durationMs: null },
      ],
    };
  }

  it("replay: toma la extracción guardada de cada (factura, pasada) con tokens/tiempo de la original", async () => {
    const source = parseReplaySource(replaySourceJson(), "runs/origen.json");
    const replay = createReplayExtractor(source);
    const truths = TRUTHS.filter((t) => ["f01", "f02"].includes(t.id));
    const result = await runBench(options({ truths, extractor: replay.extractor, fewShot: source.fewShot }));
    expect(entry(result, "f01", "sinAlias").predicted?.total).toBe(111);
    expect(entry(result, "f02", "sinAlias").predicted?.total).toBe(222);
    const f02b = entry(result, "f02", "conAlias");
    expect(f02b.predicted?.total).toBe(333);
    expect(f02b.tokens).toEqual({ input: 2000, output: 150 });
    expect(f02b.durationMs).toBe(5000);
    expect(f02b.matched).not.toBeNull();
    expect(result.meta).toMatchObject({ provider: "google", modelId: "gemini-2.5-flash", fewShot: true });
    expect(replay.state).toEqual({ replayed: 3, missing: 0, filled: 0 });
  });

  it("replay sin --fill-missing: la factura sin extracción queda con error REPLAY_MISSING y la corrida sigue", async () => {
    const source = parseReplaySource(replaySourceJson(), "runs/origen.json");
    const replay = createReplayExtractor(source);
    const truths = TRUTHS.filter((t) => ["f01", "f02", "f03"].includes(t.id));
    const result = await runBench(options({ truths, extractor: replay.extractor, fewShot: source.fewShot }));
    const f03 = entry(result, "f03", "sinAlias");
    expect(f03.error).toEqual({ message: REPLAY_MISSING_MESSAGE, code: REPLAY_MISSING_CODE });
    expect(f03.predicted).toBeNull();
    expect(entry(result, "f03", "conAlias").error?.code).toBe(REPLAY_MISSING_CODE);
    expect(entry(result, "f01", "sinAlias").error).toBeUndefined();
    expect(replay.state.missing).toBe(2);
    expect(renderMarkdown(result)).toContain("f03 (sin alias) [REPLAY_MISSING]: sin extracción en el replay");
  });

  it("replay con --fill-missing: solo las faltantes van al extractor real", async () => {
    const source = parseReplaySource(replaySourceJson(), "runs/origen.json");
    const calls: BenchExtractInput[] = [];
    const replay = createReplayExtractor(source, fakeExtractor({ calls }));
    const truths = TRUTHS.filter((t) => ["f01", "f02", "f03"].includes(t.id));
    const result = await runBench(options({ truths, extractor: replay.extractor, fewShot: source.fewShot }));
    expect(calls.map((call) => `${call.invoice?.id}:${call.invoice?.bucket}`).sort()).toEqual(["f03:conAlias", "f03:sinAlias"]);
    expect(entry(result, "f03", "sinAlias").predicted).toEqual(TRUTHS.find((t) => t.id === "f03")?.extraction);
    expect(replay.state).toEqual({ replayed: 3, missing: 2, filled: 2 });
  });

  it("informe del oráculo: aviso explícito y cabecera/líneas/exactitud como n/a", async () => {
    const result = await runBench(options({ extractor: createOracleExtractor() }));
    const markdown = renderMarkdown(result, { kind: "oracle" });
    expect(markdown).toContain(ORACLE_BANNER);
    expect(markdown).toContain("# Banco de evaluación del escaneo: ORÁCULO (solo emparejamiento)");
    expect(markdown).toMatch(/\| sin alias \| Campos de cabecera \| n\/a \(oráculo\) \|/);
    expect(markdown).toMatch(/\| todas \| sin alias \| 8 \| n\/a \(oráculo\) \| n\/a \(oráculo\) \| n\/a \(oráculo\) \| 100\.0 % \|/);
    expect(markdown).toContain("solo metas de emparejamiento");
    const replayMd = renderMarkdown(result, { kind: "replay", source: "runs/x.json", fillMissing: false, replayed: 3, missing: 1, filled: 0 });
    expect(replayMd).toContain("**REPLAY** de runs/x.json");
    expect(replayMd).toContain("Tokens, tiempo y costo: de la corrida original");
    expect(replayMd).not.toContain("n/a (oráculo)");
  });
});

describe("writeRun en modos sin modelo (SCN-10l)", () => {
  it("oráculo: archivo marcado, aviso en .md y en el JSON; replay registra la corrida de origen", async () => {
    const result = await runBench(options({ extractor: createOracleExtractor() }));
    const dir = mkdtempSync(join(tmpdir(), "invoice-eval-oracle-"));
    try {
      const now = new Date("2026-10-15T15:00:00Z");
      const oracleMeta: RunMeta = { mode: "oracle", notice: ORACLE_BANNER, requested: { provider: "oracle" }, fewShot: false, quotaCut: false, quotaSkipped: 0 };
      const files = writeRun(result, oracleMeta, dir, now);
      expect(files.markdownPath).toBe(join(dir, "2026-10-15-oraculo-solo-emparejamiento.md"));
      const markdown = readFileSync(files.markdownPath, "utf8");
      expect(markdown).toContain("few-shot no (no aplica en oráculo)");
      expect(markdown).toContain(ORACLE_BANNER);
      expect(JSON.parse(readFileSync(files.jsonPath, "utf8")).run.notice).toBe(ORACLE_BANNER);

      const replayMeta: RunMeta = {
        mode: "replay",
        requested: {},
        fewShot: true,
        quotaCut: false,
        quotaSkipped: 0,
        replay: { source: "runs/o.json", sourceProvider: "google", sourceModel: "m", fillMissing: false, replayed: 3, missing: 1, filled: 0, usage: "de la corrida original" },
      };
      const replayResult = { ...result, meta: { ...result.meta, provider: "google", modelId: "gemini-2.5-flash" } };
      const replayFiles = writeRun(replayResult, replayMeta, dir, now);
      expect(replayFiles.jsonPath).toBe(join(dir, "2026-10-15-replay-google-gemini-2.5-flash.json"));
      expect(renderRunMarkdown(replayResult, replayMeta)).toContain("> Pedido: --replay runs/o.json; few-shot sí");
      expect(JSON.parse(readFileSync(replayFiles.jsonPath, "utf8")).run.replay.source).toBe("runs/o.json");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("pares no evaluables y fecha de la corrida (SCN-10m)", () => {
  it("si falla una extracción del par: no evaluable con motivo, '—' en el resto y fuera del denominador", async () => {
    const result = await runBench(
      options({ extractor: fakeExtractor({ failFor: "f03", error: Object.assign(new Error("caído"), { status: 503 }) }) }),
    );
    const sin = result.pairs.filter((pair) => pair.bucket === "sinAlias");
    const f03 = sin.find((pair) => pair.id === "f03");
    expect(f03?.consistency).toMatchObject({ evaluable: false, notEvaluableReason: "b_failed", consistent: false });
    expect(sin.find((pair) => pair.id === "f16")?.consistency).toMatchObject({ evaluable: true, consistent: true });
    expect(pairSummary(sin)).toBe("Consistentes: 1/1 evaluables. No evaluables: 1.");

    const markdown = renderMarkdown(result);
    const row = markdown.split("\n").find((line) => line.startsWith("| sin alias | f02 / f03 |"));
    expect(row).toBe(
      `| sin alias | f02 / f03 | ${PAIR_NA} | no evaluable (falló la extracción del duplicado) | ${PAIR_NA} | ${PAIR_NA} | ${PAIR_NA} | ${PAIR_NA} |`,
    );
    const evaluable = result.pairs.filter((pair) => pair.consistency.evaluable);
    const consistent = evaluable.filter((pair) => pair.consistency.consistent).length;
    const notEvaluable = result.pairs.length - evaluable.length;
    expect(notEvaluable).toBeGreaterThanOrEqual(1);
    expect(markdown).toContain(`Consistentes: ${consistent}/${evaluable.length} evaluables. No evaluables: ${notEvaluable}.`);
  });

  it("el costo usa el precio vigente en la fecha de la corrida (`at`), no el reloj", async () => {
    const base = fakeExtractor();
    const extractor: BenchExtractor = async (input) => ({ ...(await base(input)), modelId: "gemini-3.8-flash" });
    const run = (iso: string) => runBench(options({ truths: [TRUTHS[0]], extractor, now: () => new Date(iso) }));
    const before = await run("2026-10-15T12:00:00.000Z");
    const after = await run("2027-02-01T12:00:00.000Z");
    expect(entry(before, "f01", "sinAlias").costUsd).toBeCloseTo((1000 * 0.75 + 200 * 3.75) / 1e6, 10);
    expect(entry(after, "f01", "sinAlias").costUsd).toBeCloseTo((1000 * 1.5 + 200 * 7.5) / 1e6, 10);
    expect(after.meta.date).toBe("2027-02-01T12:00:00.000Z");
  });
});
