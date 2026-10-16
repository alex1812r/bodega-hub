/**
 * @jest-environment node
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  InvoiceExtraction,
  InvoiceExtractionLine,
  InvoiceLineMatch,
  InvoiceMatch,
} from "../../src/modules/invoice-scan/contracts";

import {
  aggregate,
  estimateCostUsd,
  resolvePricedModelId,
  evaluateHeader,
  evaluateInvoice,
  meetsTargets,
  normalizeInvoiceNumber,
  normalizeTaxId,
  pairConsistency,
  percentile,
  type CatalogMap,
  type InvoiceEvalInput,
  type InvoiceMetrics,
} from "./metrics";
import { loadTruth, type InvoiceTruth, type TruthLine } from "./truth";

function line(rawText: string, quantity: number, unitPrice: number, extra: Partial<InvoiceExtractionLine> = {}) {
  const value: InvoiceExtractionLine = {
    rawText,
    description: rawText,
    quantity,
    unitPrice,
    lineTotal: Math.round(quantity * unitPrice * 100) / 100,
    confidence: 1,
    ...extra,
  };
  return value;
}

const LINES: InvoiceExtractionLine[] = [
  line("GLUP SABORES 2L [BULTO X 6]", 2, 1200),
  line("HARINA PAN 1KG [BULTO X 20]", 1, 950.5),
  line("MALTA POLAR 1.5L [CAJA X 6]", 3, 610),
  line("ENVIO", 1, 50),
];

function extraction(overrides: Partial<InvoiceExtraction> = {}): InvoiceExtraction {
  return {
    supplier: { name: "Chevere Depot, C.A.", taxId: "J-50529551-9" },
    number: "00006894",
    date: "2026-09-01",
    currency: "VES",
    lines: LINES,
    total: 6211.5,
    confidence: 1,
    warnings: [],
    ...overrides,
  };
}

const TRUTH_META: TruthLine[] = [
  { productKey: "glup-sabores-2l", occluded: false, uncertainFields: [], note: "" },
  { productKey: "harina-pan-1kg", occluded: false, uncertainFields: [], note: "" },
  { productKey: "malta-polar-1.5l", occluded: false, uncertainFields: [], note: "" },
  { productKey: null, occluded: false, uncertainFields: [], note: "" },
];

function truth(overrides: Partial<InvoiceTruth> = {}): InvoiceTruth {
  return {
    id: "f01",
    synthetic: false,
    pages: ["samples/f01.jpg"],
    supplierKey: "chevere-depot",
    duplicateOf: null,
    extraction: extraction(),
    lines: TRUTH_META,
    verification: { checkedAgainstImage: true, manifestDiffs: [], arithmetic: "ok" },
    ...overrides,
  };
}

const CATALOG: CatalogMap = {
  "glup-sabores-2l": "p-glup",
  "harina-pan-1kg": "p-harina",
  "malta-polar-1.5l": "p-malta",
};
const PRODUCT_BY_INDEX = ["p-glup", "p-harina", "p-malta"];

function lineMatch(index: number, overrides: Partial<InvoiceLineMatch> = {}): InvoiceLineMatch {
  return {
    index,
    status: PRODUCT_BY_INDEX[index] ? "confirmed" : "unmatched",
    productId: PRODUCT_BY_INDEX[index],
    entryMode: "pack",
    taxRateCode: "G",
    issues: [],
    ...overrides,
  };
}

function match(lines: InvoiceLineMatch[], overrides: Partial<InvoiceMatch> = {}): InvoiceMatch {
  return {
    supplier: { contactId: "c-chevere" },
    lines,
    totals: { computed: 6211.5, mismatch: false },
    ...overrides,
  };
}

function perfectMatch(count = LINES.length): InvoiceMatch {
  return match(Array.from({ length: count }, (_, i) => lineMatch(i)));
}

function run(overrides: Partial<InvoiceEvalInput> = {}): InvoiceMetrics {
  return evaluateInvoice({
    truth: truth(),
    predicted: extraction(),
    matched: perfectMatch(),
    catalog: CATALOG,
    bucket: "sinAlias",
    ...overrides,
  });
}

describe("evaluateInvoice", () => {
  it("da 100 % en todo con una lectura perfecta", () => {
    const m = run();
    expect(m.header.headerScore).toBe(1);
    expect(m.header.headerAllOk).toBe(true);
    expect(m.lines).toMatchObject({ tp: 4, fp: 0, fn: 0, rate: 1, invented: [], lost: [] });
    expect(m.exact).toMatchObject({ ok: 4, total: 4, rate: 1 });
    expect(m.matching.counts.confirmed_correct).toBe(3);
    expect(m.matching.counts.ok_none).toBe(1);
    expect(m.matching.inCatalog).toBe(3);
    expect(m.matching.okRate).toBe(1);
    expect(m.matching.confirmedWrongRate).toBe(0);
    expect(m.duplicate).toEqual({ expected: false, detected: false, correct: true, falsePositive: false });
  });

  it("alinea aunque el modelo devuelva las líneas en otro orden y con texto parecido", () => {
    const shuffled = [
      { ...LINES[2], rawText: "MALTA POLAR 1,5L CAJA X6", description: "Malta Polar 1.5 L" },
      LINES[0],
      LINES[3],
      LINES[1],
    ];
    const m = run({ predicted: extraction({ lines: shuffled }), matched: null });
    expect(m.lines.rate).toBe(1);
    expect(m.pairs.map((p) => [p.truthIndex, p.predictedIndex])).toEqual([
      [0, 1],
      [1, 3],
      [2, 0],
      [3, 2],
    ]);
  });

  it("cuenta una línea inventada como FP y como confirmada mal si se confirmó", () => {
    const predicted = extraction({ lines: [...LINES, line("RECIBO BANCARIO TRANSFERENCIA", 1, 6211.5)] });
    const matched = match([...perfectMatch().lines, lineMatch(4, { status: "confirmed", productId: "p-glup" })]);
    const m = run({ predicted, matched });
    expect(m.lines).toMatchObject({ tp: 4, fp: 1, fn: 0 });
    expect(m.lines.rate).toBeCloseTo(4 / 5);
    expect(m.lines.invented).toEqual([{ predictedIndex: 4, rawText: "RECIBO BANCARIO TRANSFERENCIA", reason: "unaligned" }]);
    expect(m.matching.counts.confirmed_wrong).toBe(1);
    expect(m.matching.evaluated).toBe(5);
    expect(m.matching.confirmedWrongRate).toBeCloseTo(1 / 5);
    expect(m.matching.okRate).toBe(1);
  });

  it("una inventada sin confirmar es ok_none en emparejamiento", () => {
    const predicted = extraction({ lines: [...LINES, line("TEXTO SUELTO", 1, 1)] });
    const m = run({ predicted, matched: match([...perfectMatch().lines, lineMatch(4, { status: "unmatched", productId: undefined })]) });
    expect(m.matching.counts.ok_none).toBe(2);
    expect(m.matching.counts.confirmed_wrong).toBe(0);
  });

  it("cuenta una línea perdida como FN, fallo de exactitud y lost", () => {
    const predicted = extraction({ lines: [LINES[0], LINES[2], LINES[3]] });
    const matched = match([lineMatch(0), lineMatch(1, { productId: "p-malta" }), lineMatch(2, { status: "unmatched", productId: undefined })]);
    const m = run({ predicted, matched });
    expect(m.lines).toMatchObject({ tp: 3, fp: 0, fn: 1 });
    expect(m.lines.lost).toEqual([{ truthIndex: 1, rawText: LINES[1].rawText }]);
    expect(m.exact).toMatchObject({ ok: 3, total: 4 });
    expect(m.exact.failures).toEqual([{ truthIndex: 1, fields: ["lost"] }]);
    expect(m.matching.counts.lost).toBe(1);
    expect(m.matching.okRate).toBeCloseTo(2 / 3);
  });

  it("si el escaneo falla todo es perdido", () => {
    const m = run({ predicted: null, matched: null });
    expect(m.lines).toMatchObject({ tp: 0, fn: 4, fp: 0, rate: 0 });
    expect(m.header.okCount).toBe(0);
  });

  describe("líneas tapadas (occluded)", () => {
    const occludedMeta = TRUTH_META.map((meta, i) => (i === 2 ? { ...meta, occluded: true } : meta));
    const occludedTruth = truth({ lines: occludedMeta });

    it("perderla no cuenta como FN ni en exactitud", () => {
      const m = run({
        truth: occludedTruth,
        predicted: extraction({ lines: [LINES[0], LINES[1], LINES[3]] }),
        matched: match([lineMatch(0), lineMatch(1), lineMatch(2, { status: "unmatched", productId: undefined })]),
      });
      expect(m.lines).toMatchObject({ tp: 3, fp: 0, fn: 0, rate: 1 });
      expect(m.exact.total).toBe(3);
      expect(m.matching.inCatalog).toBe(2);
    });

    it("leerla con los mismos valores es TP", () => {
      const m = run({ truth: occludedTruth });
      expect(m.lines).toMatchObject({ tp: 4, fp: 0, fn: 0 });
    });

    it("leerla con valores distintos y confianza baja no es inventada", () => {
      const guessed = { ...LINES[2], quantity: 5, lineTotal: 3050, confidence: 0.4 };
      const m = run({ truth: occludedTruth, predicted: extraction({ lines: [LINES[0], LINES[1], guessed, LINES[3]] }) });
      expect(m.lines.fp).toBe(0);
      expect(m.lines.tp).toBe(4);
    });

    it("leerla con valores distintos y confianza alta es inventada", () => {
      const guessed = { ...LINES[2], quantity: 5, lineTotal: 3050, confidence: 0.9 };
      const m = run({ truth: occludedTruth, predicted: extraction({ lines: [LINES[0], LINES[1], guessed, LINES[3]] }) });
      expect(m.lines).toMatchObject({ tp: 3, fp: 1, fn: 0 });
      expect(m.lines.invented).toEqual([{ predictedIndex: 2, rawText: LINES[2].rawText, reason: "occluded_mismatch" }]);
      // Confirmada (perfectMatch) sobre una inventada: confirmada mal.
      expect(m.matching.counts.confirmed_wrong).toBe(1);
    });
  });

  it("falla exactitud por precio unitario salvo que el campo sea incierto", () => {
    const predicted = extraction({ lines: [LINES[0], { ...LINES[1], unitPrice: 900 }, LINES[2], LINES[3]] });
    const m = run({ predicted });
    expect(m.exact.failures).toEqual([{ truthIndex: 1, fields: ["unitPrice"] }]);
    const uncertain = TRUTH_META.map((meta, i) => (i === 1 ? { ...meta, uncertainFields: ["unitPrice" as const] } : meta));
    expect(run({ predicted, truth: truth({ lines: uncertain }) }).exact.rate).toBe(1);
  });

  it("acepta precio dentro del 0,1 %", () => {
    const predicted = extraction({ lines: [{ ...LINES[0], unitPrice: 1201, lineTotal: 2402 }, LINES[1], LINES[2], LINES[3]] });
    expect(run({ predicted }).exact.rate).toBe(1);
  });

  it("clasifica confirmada mal y dudosa con candidato correcto", () => {
    const matched = match([
      lineMatch(0, { productId: "p-harina" }),
      lineMatch(1, {
        status: "doubtful",
        productId: undefined,
        candidates: [
          { productId: "p-otro", name: "Otro", score: 0.7, reason: "nombre parecido" },
          { productId: "p-harina", name: "Harina PAN", score: 0.65, reason: "nombre parecido" },
        ],
      }),
      lineMatch(2, { status: "doubtful", productId: undefined, candidates: [] }),
      lineMatch(3),
    ]);
    const m = run({ matched });
    expect(m.matching.perLine.map((l) => l.outcome)).toEqual([
      "confirmed_wrong",
      "doubtful_correct",
      "doubtful_wrong",
      "ok_none",
    ]);
    expect(m.matching.okRate).toBeCloseTo(1 / 3);
    expect(m.matching.confirmedWrongRate).toBeCloseTo(1 / 4);
  });

  it("trata productos fuera de catálogo como sin producto esperado", () => {
    const catalog: CatalogMap = { "glup-sabores-2l": "p-glup", "harina-pan-1kg": null };
    const matched = match([
      lineMatch(0),
      lineMatch(1, { status: "confirmed", productId: "p-harina-x" }),
      lineMatch(2, { status: "doubtful", productId: undefined, candidates: [] }),
      lineMatch(3),
    ]);
    const m = run({ catalog, matched });
    expect(m.matching.perLine.map((l) => l.outcome)).toEqual([
      "confirmed_correct",
      "confirmed_wrong",
      "ok_none",
      "ok_none",
    ]);
    expect(m.matching.inCatalog).toBe(1);
    expect(m.matching.okRate).toBe(1);
  });

  it("detecta duplicado esperado, no detectado y falso positivo", () => {
    const dupTruth = truth({ id: "f03", duplicateOf: "f02" });
    const detected = run({ truth: dupTruth, matched: { ...perfectMatch(), duplicateOfScanId: "scan-f02" } });
    expect(detected.duplicate).toEqual({ expected: true, detected: true, correct: true, falsePositive: false });
    const missed = run({ truth: dupTruth });
    expect(missed.duplicate).toEqual({ expected: true, detected: false, correct: false, falsePositive: false });
    const fp = run({ matched: { ...perfectMatch(), duplicateOfScanId: "scan-x" } });
    expect(fp.duplicate).toEqual({ expected: false, detected: true, correct: false, falsePositive: true });
  });

  it("calcula costo cuando hay modelo y tokens", () => {
    const m = run({ modelId: "gemini-2.5-flash", inputTokens: 2000, outputTokens: 1500, durationMs: 4000 });
    expect(m.usage.costUsd).toBeCloseTo((2000 * 0.3 + 1500 * 2.5) / 1e6, 10);
  });
});

describe("cabecera", () => {
  it("compara el número solo por dígitos sin ceros a la izquierda", () => {
    expect(normalizeInvoiceNumber("00006894")).toBe("6894");
    expect(normalizeInvoiceNumber("Nº 6894")).toBe("6894");
    const h = evaluateHeader(extraction(), extraction({ number: "6894" }));
    expect(h.fields.number.ok).toBe(true);
    expect(evaluateHeader(extraction(), extraction({ number: "6895" })).fields.number.ok).toBe(false);
  });

  it("compara el RIF con o sin guiones", () => {
    expect(normalizeTaxId("J-50529551-9")).toBe("J505295519");
    const ok = evaluateHeader(extraction(), extraction({ supplier: { name: "Otro nombre", taxId: "j505295519" } }));
    expect(ok.fields.supplier.ok).toBe(true);
    const noLetter = evaluateHeader(
      extraction({ supplier: { name: "X", taxId: "508357612" } }),
      extraction({ supplier: { name: "X", taxId: "J-50835761-2" } }),
    );
    expect(noLetter.fields.supplier.ok).toBe(true);
    const wrong = evaluateHeader(extraction(), extraction({ supplier: { name: "Chevere Depot", taxId: "J-50529551-8" } }));
    expect(wrong.fields.supplier.ok).toBe(false);
  });

  it("sin RIF en alguno compara el nombre normalizado (≥ 0,8)", () => {
    const h = evaluateHeader(extraction(), extraction({ supplier: { name: "CHEVERE DEPOT CA" } }));
    expect(h.fields.supplier.ok).toBe(true);
    const bad = evaluateHeader(extraction(), extraction({ supplier: { name: "Hiperconfi 66" } }));
    expect(bad.fields.supplier.ok).toBe(false);
  });

  it("acepta el contacto emparejado igual al esperado", () => {
    const h = evaluateHeader(extraction(), extraction({ supplier: { name: "???" } }), {
      expectedContactId: "c-1",
      matchedContactId: "c-1",
    });
    expect(h.fields.supplier.ok).toBe(true);
  });

  it("no cuenta campos ausentes en la verdad y tolera el total", () => {
    const t = extraction({ number: undefined, date: undefined });
    const h = evaluateHeader(t, extraction({ total: 6211.5 * 1.0009 }));
    expect(h.evaluatedCount).toBe(2);
    expect(h.headerScore).toBe(1);
    const off = evaluateHeader(t, extraction({ total: 6230 }));
    expect(off.headerScore).toBe(0.5);
    expect(off.headerAllOk).toBe(false);
  });
});

describe("costo", () => {
  const M = 1_000_000;
  const AT_2026 = new Date("2026-10-15T12:00:00Z");
  const AT_2027 = new Date("2027-01-01T00:00:00Z");

  it.each([
    ["gemini-2.5-flash", 0.3, 2.5],
    ["gemini-2.5-flash-lite", 0.1, 0.4],
    ["gemini-3-flash-preview", 0.5, 3],
    ["gemini-3.1-flash-lite", 0.25, 1.5],
    ["gemini-3.5-flash-lite", 0.3, 2.5],
    ["gemini-3.6-flash", 0.75, 3.75],
    ["gemini-3.8-flash", 0.75, 3.75],
    ["claude-haiku-4-5", 1, 5],
    ["claude-haiku-5-5", 0.1, 0.5],
  ])("%s cobra entrada %p y salida %p por millón (2026)", (id, input, output) => {
    // 100k de entrada: dentro del tramo bajo de Haiku 5.5.
    expect(estimateCostUsd(id, 100_000, 0, AT_2026)).toBeCloseTo(input / 10, 10);
    expect(estimateCostUsd(id, 0, M, AT_2026)).toBeCloseTo(output, 10);
  });

  it("combina entrada y salida", () => {
    expect(estimateCostUsd("claude-haiku-4-5", M, M, AT_2026)).toBe(6);
  });

  it("acepta prefijo models/ y sufijos de fecha o versión por prefijo más largo", () => {
    expect(estimateCostUsd("models/gemini-2.5-flash-lite", M, 0, AT_2026)).toBeCloseTo(0.1, 10);
    expect(estimateCostUsd("models/gemini-2.5-flash", M, 0, AT_2026)).toBeCloseTo(0.3, 10);
    expect(estimateCostUsd("claude-haiku-4-5-20251001", M, M, AT_2026)).toBe(6);
    expect(estimateCostUsd("gemini-2.5-flash-lite-preview-06-17", M, 0, AT_2026)).toBeCloseTo(0.1, 10);
    expect(resolvePricedModelId("gemini-2.5-flash-001")).toBe("gemini-2.5-flash");
    expect(resolvePricedModelId("claude-haiku-5-5@20261001")).toBe("claude-haiku-5-5");
  });

  it("Haiku 5.5 usa el tramo alto en toda la petición si el prompt supera 100k", () => {
    expect(estimateCostUsd("claude-haiku-5-5", 100_000, 10_000, AT_2026)).toBeCloseTo(
      (100_000 * 0.1 + 10_000 * 0.5) / M,
      12,
    );
    expect(estimateCostUsd("claude-haiku-5-5", 100_001, 10_000, AT_2026)).toBeCloseTo(
      (100_001 * 0.5 + 10_000 * 2.5) / M,
      12,
    );
  });

  it("gemini-3.8-flash y 3.6-flash suben desde el 2027-01-01", () => {
    expect(estimateCostUsd("gemini-3.8-flash", M, M, new Date("2026-12-31T23:59:59Z"))).toBeCloseTo(4.5, 10);
    expect(estimateCostUsd("gemini-3.8-flash", M, M, AT_2027)).toBeCloseTo(9, 10);
    expect(estimateCostUsd("gemini-3.6-flash", M, 0, AT_2027)).toBeCloseTo(1.5, 10);
    expect(estimateCostUsd("gemini-3.1-flash-lite", M, 0, AT_2027)).toBeCloseTo(0.25, 10);
  });

  it("sin fecha usa la fecha actual", () => {
    const expected = estimateCostUsd("gemini-3.8-flash", M, 0, new Date());
    expect(estimateCostUsd("gemini-3.8-flash", M, 0)).toBe(expected);
  });

  it("devuelve null si no conoce el modelo o solo coincide sin límite", () => {
    expect(estimateCostUsd("gpt-desconocido", 100, 100)).toBeNull();
    expect(estimateCostUsd("gemini-3.5-flash", 100, 100)).toBeNull();
    expect(estimateCostUsd("gemini-2.5-flashy", 100, 100)).toBeNull();
    expect(resolvePricedModelId("claude-haiku")).toBeNull();
  });
});

describe("agregación", () => {
  it("calcula p95 por rango más cercano", () => {
    const values = Array.from({ length: 20 }, (_, i) => (i + 1) * 1000);
    expect(percentile(values, 95)).toBe(19000);
    expect(percentile([5], 95)).toBe(5);
    expect(percentile([], 95)).toBeNull();
  });

  it("suma numeradores y denominadores por bucket, no media de medias", () => {
    const perfect = run({ bucket: "conAlias", durationMs: 3000, modelId: "claude-haiku-4-5", inputTokens: 1000, outputTokens: 1000 });
    const lostOne = run({
      bucket: "sinAlias",
      predicted: extraction({ lines: [LINES[0], LINES[2], LINES[3]] }),
      matched: match([
        lineMatch(0),
        lineMatch(1, { productId: "p-malta" }),
        lineMatch(2, { status: "unmatched", productId: undefined }),
      ]),
      durationMs: 20000,
    });
    const bigPerfect = run({
      bucket: "sinAlias",
      truth: truth({ id: "f02", pages: ["a.jpg", "b.jpg"] }),
      durationMs: 60000,
    });
    const g = aggregate([perfect, lostOne, bigPerfect]);
    expect(g.byBucket.conAlias.invoices).toBe(1);
    expect(g.byBucket.conAlias.linesDetectedRate).toBe(1);
    expect(g.byBucket.sinAlias.linesTp).toBe(7);
    expect(g.byBucket.sinAlias.linesFn).toBe(1);
    expect(g.byBucket.sinAlias.linesDetectedRate).toBeCloseTo(7 / 8);
    expect(g.byBucket.sinAlias.matchOkRate).toBeCloseTo(5 / 6);
    expect(g.total.exactRate).toBeCloseTo(11 / 12);
    // p95 solo con facturas de 1 página: [3000, 20000].
    expect(g.total.p95DurationMs1Page).toBe(20000);
    expect(g.total.avgCostUsd).toBeCloseTo(6 / 1000);
    expect(g.total.costedInvoices).toBe(1);
    expect(g.total.headerAllOkRate).toBe(1);

    const verdict = meetsTargets(g);
    expect(verdict.ok).toBe(false);
    const failed = verdict.checks.filter((c) => !c.ok).map((c) => `${c.scope}.${c.metric}`);
    expect(failed).toEqual(["sinAlias.linesDetectedRate", "sinAlias.exactRate", "total.p95DurationMs1Page"]);
  });

  it("cumple metas con lecturas perfectas y omite buckets sin datos", () => {
    const verdict = meetsTargets(aggregate([run({ durationMs: 2000 })]));
    expect(verdict.ok).toBe(true);
    expect(verdict.checks.filter((c) => c.skipped).map((c) => `${c.scope}.${c.metric}`)).toContain("conAlias.matchOkRate");
  });
});

describe("pairConsistency", () => {
  it("da consistente para dos lecturas iguales en distinto orden", () => {
    const b = extraction({ number: "6894", lines: [LINES[3], LINES[2], LINES[1], LINES[0]] });
    const r = pairConsistency({ extraction: extraction() }, { extraction: b });
    expect(r.consistent).toBe(true);
  });

  it("señala cabecera y valores distintos", () => {
    const b = extraction({ date: "2026-09-02", lines: [LINES[0], { ...LINES[1], quantity: 2, lineTotal: 1901 }, LINES[2]] });
    const r = pairConsistency({ extraction: extraction() }, { extraction: b });
    expect(r.consistent).toBe(false);
    expect(r.headerDiffs).toEqual(["date"]);
    expect(r.valueDiffs).toEqual([{ indexA: 1, indexB: 1 }]);
    expect(r.unpairedA).toEqual([3]);
  });

  it("compara el emparejamiento si ambos lo traen", () => {
    const m2 = match([lineMatch(0, { productId: "p-otro" }), lineMatch(1), lineMatch(2), lineMatch(3)]);
    const r = pairConsistency({ extraction: extraction(), matched: perfectMatch() }, { extraction: extraction(), matched: m2 });
    expect(r.matchDiffs).toEqual([{ indexA: 0, indexB: 0 }]);
    expect(r.consistent).toBe(false);
  });

  it("marca no evaluable (y no consistente) si ambas extracciones fallaron (f07/f16)", () => {
    const r = pairConsistency({ extraction: null }, { extraction: null });
    expect(r.consistent).toBe(false);
    expect(r.evaluable).toBe(false);
    expect(r.notEvaluableReason).toBe("both_failed");
  });

  it("marca no evaluable si solo una extracción falló", () => {
    const r = pairConsistency({ extraction: extraction() }, { extraction: null });
    expect(r.consistent).toBe(false);
    expect(r.evaluable).toBe(false);
    expect(r.notEvaluableReason).toBe("b_failed");
    expect(pairConsistency({ extraction: null }, { extraction: extraction() }).notEvaluableReason).toBe("a_failed");
  });

  it("es evaluable cuando ambas extracciones existen", () => {
    const r = pairConsistency({ extraction: extraction() }, { extraction: extraction() });
    expect(r.evaluable).toBe(true);
    expect(r.notEvaluableReason).toBeUndefined();
  });
});

describe("evaluateInvoice: fecha del costo", () => {
  it("usa `at` para elegir la fila de precio", () => {
    const base = { modelId: "gemini-3.8-flash", inputTokens: 1_000_000, outputTokens: 0 };
    expect(run({ ...base, at: new Date("2026-10-15T00:00:00Z") }).usage.costUsd).toBeCloseTo(0.75, 10);
    expect(run({ ...base, at: new Date("2027-01-02T00:00:00Z") }).usage.costUsd).toBeCloseTo(1.5, 10);
  });
});

describe("loadTruth", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "invoice-truth-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("lee y ordena por id", () => {
    writeFileSync(join(dir, "f10.json"), JSON.stringify(truth({ id: "f10" })));
    writeFileSync(join(dir, "f02.json"), JSON.stringify(truth({ id: "f02" })));
    mkdirSync(join(dir, "sub"));
    expect(loadTruth(dir).map((t) => t.id)).toEqual(["f02", "f10"]);
  });

  it("falla con el nombre del archivo si las líneas no cuadran", () => {
    writeFileSync(join(dir, "f05.json"), JSON.stringify(truth({ id: "f05", lines: TRUTH_META.slice(1) })));
    expect(() => loadTruth(dir)).toThrow(/f05\.json.*lines/);
  });

  it("falla si el id no coincide o el JSON está roto", () => {
    writeFileSync(join(dir, "f06.json"), JSON.stringify(truth({ id: "f07" })));
    expect(() => loadTruth(dir)).toThrow(/f06\.json.*id "f07"/);
    rmSync(join(dir, "f06.json"));
    writeFileSync(join(dir, "f08.json"), "{ roto");
    expect(() => loadTruth(dir)).toThrow(/f08\.json.*JSON mal formado/);
  });
});

describe("SCN-10-F3: cabecera ocluida (occludedHeaderFields)", () => {
  const occluded = (fields: InvoiceTruth["occludedHeaderFields"]) => truth({ occludedHeaderFields: fields });

  it("un campo ocluido que la predicción omite cuenta como acierto", () => {
    const m = run({ truth: occluded(["date"]), predicted: extraction({ date: undefined }) });
    expect(m.header.fields.date).toMatchObject({ evaluated: true, ok: true });
    expect(m.header.headerAllOk).toBe(true);
  });

  it("igual a la verdad es acierto; distinto es fallo (inventado)", () => {
    expect(run({ truth: occluded(["date"]) }).header.fields.date.ok).toBe(true);
    expect(run({ truth: occluded(["date"]), predicted: extraction({ date: "2026-09-02" }) }).header.fields.date.ok).toBe(false);
  });

  it("los cuatro campos ocluidos omitidos (s09) dan cabecera completa; un número inventado falla", () => {
    const all = occluded(["supplier", "date", "number", "total"]);
    const omitted = extraction({ supplier: { name: "" }, number: undefined, date: undefined, total: undefined });
    const m = run({ truth: all, predicted: omitted, matched: null });
    expect(m.header.okCount).toBe(4);
    expect(m.header.evaluatedCount).toBe(4);
    const invented = run({ truth: all, predicted: { ...omitted, number: "0009999" }, matched: null });
    expect(invented.header.fields.number.ok).toBe(false);
  });

  it("sin ocluir, omitir sigue siendo fallo; un escaneo fallido no cuenta como omitir", () => {
    expect(run({ predicted: extraction({ date: undefined }) }).header.fields.date.ok).toBe(false);
    expect(run({ truth: occluded(["date"]), predicted: null, matched: null }).header.fields.date.ok).toBe(false);
  });
});

describe("SCN-10-F3: fuga de cabecera desde el few-shot", () => {
  const example = extraction({
    supplier: { name: "Mayorista Los Andes, C.A.", taxId: "J-50473921-6" },
    number: "0004000",
    total: 1234.5,
  });

  it("número igual al de un ejemplo y distinto de la verdad cuenta como fuga", () => {
    const m = run({ bucket: "conAlias", fewShot: [example], predicted: extraction({ number: "0004000" }) });
    expect(m.fewShotLeak).toEqual({ evaluated: true, leaked: true, fields: ["number"] });
  });

  it("RIF o nombre del proveedor y total del ejemplo también cuentan", () => {
    const byTax = run({ bucket: "conAlias", fewShot: [example], predicted: extraction({ supplier: { name: "", taxId: "J504739216" } }) });
    expect(byTax.fewShotLeak.fields).toEqual(["supplier"]);
    const byName = run({
      bucket: "conAlias",
      fewShot: [example],
      predicted: extraction({ supplier: { name: "MAYORISTA LOS ANDES" }, total: 1234.5 }),
    });
    expect(byName.fewShotLeak.fields).toEqual(["supplier", "total"]);
  });

  it("igual a la verdad no es fuga aunque coincida con el ejemplo; sin few-shot no se evalúa", () => {
    const sameAsTruth = run({ bucket: "conAlias", fewShot: [extraction()] });
    expect(sameAsTruth.fewShotLeak).toEqual({ evaluated: true, leaked: false, fields: [] });
    expect(run().fewShotLeak).toEqual({ evaluated: false, leaked: false, fields: [] });
  });

  it("se agrega por bucket", () => {
    const leak = run({ bucket: "conAlias", fewShot: [example], predicted: extraction({ number: "4000" }) });
    const clean = run({ bucket: "conAlias", fewShot: [example] });
    const global = aggregate([leak, clean, run()]);
    expect(global.byBucket.conAlias.fewShotLeaks).toBe(1);
    expect(global.byBucket.conAlias.fewShotEvaluated).toBe(2);
    expect(global.byBucket.sinAlias.fewShotLeaks).toBe(0);
    expect(global.total.fewShotLeaks).toBe(1);
  });
});

describe("SCN-10-F3: verdades con cabecera ocluida", () => {
  const real = loadTruth(join(__dirname, "truth"));
  const byId = (id: string) => real.find((t) => t.id === id) as InvoiceTruth;

  it("f03: la fecha la tapa el pulgar", () => {
    expect(byId("f03").occludedHeaderFields).toEqual(["date"]);
  });

  it("s09: toda la cabecera y todas las líneas ocluidas", () => {
    const s09 = byId("s09");
    expect(s09.occludedHeaderFields).toEqual(["supplier", "date", "number", "total"]);
    expect(s09.lines.every((l) => l.occluded)).toBe(true);
  });
});
