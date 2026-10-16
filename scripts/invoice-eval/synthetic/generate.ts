/**
 * Generador del banco sintético de facturas (SCN-10e, plan factura-escaneo-gtm
 * §5.4 SCN-10 y §6.1–6.3).
 *
 * Uso:  npx tsx scripts/invoice-eval/synthetic/generate.ts
 *
 * Escribe, para s01..s10:
 *   - scripts/invoice-eval/samples/sNN.jpg (s02: sNN-p1.jpg y sNN-p2.jpg), JPG q85,
 *     lado mayor ≤ 1600 px, renderizado HTML → imagen con Chromium headless;
 *   - scripts/invoice-eval/truth/sNN.json con `synthetic: true`, validado con
 *     `parseTruth` (truth.ts) e `invoiceExtractionSchema`;
 *   - scripts/invoice-eval/synthetic/keys-sint.txt con las productKey nuevas.
 *
 * Determinista: datos fijos en data.ts, sin aleatoriedad ni fecha actual. La
 * verdad y las plantillas salen del mismo modelo (model.ts), así que lo
 * impreso coincide con la verdad por construcción; la aritmética se revalida aquí.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, type Browser } from "playwright";

import {
  invoiceExtractionSchema,
  type InvoiceExtraction,
  type InvoiceExtractionLine,
} from "../../../src/modules/invoice-scan/contracts";
import { parseTruth, type InvoiceTruth } from "../truth";
import { INVOICES, NEW_PRODUCTS, SUPPLIERS } from "./data";
import { computeTotals, formatBs, fromCents, printedTaxHint, type InvoiceSpec } from "./model";
import { renderInvoice } from "./templates";

const HERE = dirname(fileURLToPath(import.meta.url));
const EVAL_DIR = join(HERE, "..");
const SAMPLES_DIR = join(EVAL_DIR, "samples");
const TRUTH_DIR = join(EVAL_DIR, "truth");
const MAX_SIDE = 1600;
const JPEG_QUALITY = 85;

function pagePaths(spec: InvoiceSpec, count: number): string[] {
  if (count === 1) return [`samples/${spec.id}.jpg`];
  return Array.from({ length: count }, (_, i) => `samples/${spec.id}-p${i + 1}.jpg`);
}

function buildExtraction(spec: InvoiceSpec): InvoiceExtraction {
  if (spec.kind === "poster") {
    return { supplier: { name: "" }, currency: "unknown", lines: [], confidence: 1, warnings: spec.warnings ?? [] };
  }
  const supplier = SUPPLIERS[spec.supplierKey ?? ""];
  if (!supplier) throw new Error(`${spec.id}: proveedor desconocido`);
  const totals = computeTotals(spec);
  const lines: InvoiceExtractionLine[] = spec.lines.map((line, i) => {
    const taxHint = printedTaxHint(line.rawText);
    // Mismo orden de claves que las verdades reales.
    return {
      rawText: line.rawText,
      description: line.description,
      quantity: line.quantity,
      ...(line.unit ? { unit: line.unit } : {}),
      ...(line.unitsPerPack ? { unitsPerPack: line.unitsPerPack } : {}),
      unitPrice: line.unitPrice,
      lineTotal: fromCents(totals.lineTotals[i]),
      ...(taxHint ? { taxHint } : {}),
      ...(line.barcode ? { barcode: line.barcode } : {}),
      ...(line.supplierSku ? { supplierSku: line.supplierSku } : {}),
      confidence: 1,
    };
  });
  const withTax = spec.kind !== "handwritten";
  return {
    supplier: { name: supplier.name, taxId: supplier.taxId, phone: supplier.phone, address: supplier.address },
    ...(spec.number ? { number: spec.number } : {}),
    ...(spec.date ? { date: spec.date } : {}),
    currency: "VES",
    ...(spec.printedRate ? { printedRate: spec.printedRate } : {}),
    lines,
    ...(withTax ? { subtotal: fromCents(totals.subtotal), tax: fromCents(totals.iva) } : {}),
    total: fromCents(totals.total),
    confidence: 1,
    warnings: spec.warnings ?? [],
  };
}

function describeArithmetic(spec: InvoiceSpec): string {
  if (spec.kind === "poster") return `${spec.caseNote} Sin aritmética: no hay importes de factura.`;
  const t = computeTotals(spec);
  const bs = (cents: number) => formatBs(cents / 100);
  const parts = [
    `cantidad × precio × (1 − desc. línea) = lineTotal en las ${spec.lines.length} líneas OK`,
    `sum(lineTotal)=${bs(t.subtotal)}`,
  ];
  if (spec.kind === "handwritten") {
    parts.push(`= TOTAL impreso OK (nota de entrega sin IVA; total sin subtotal ni tax)`);
  } else {
    parts.push(`= SUB-TOTAL/SUBTTL OK`);
    if (spec.globalDiscountPct) {
      parts.push(
        `descuento global ${spec.globalDiscountPct}% = ${bs(t.discount)} (G ${bs(t.sumG - t.baseG)} + E ${bs(t.sumE - t.exento)})`,
      );
    }
    parts.push(`EXENTO ${bs(t.exento)}`, `BI G ${bs(t.baseG)} × 16% = IVA ${bs(t.iva)}`);
    parts.push(`${bs(t.exento)} + ${bs(t.baseG)} + ${bs(t.iva)} = TOTAL ${bs(t.total)} OK`);
  }
  return `${spec.caseNote} ${parts.join("; ")}`;
}

function buildTruth(spec: InvoiceSpec, pageCount: number): InvoiceTruth {
  const extraction = invoiceExtractionSchema.parse(buildExtraction(spec));
  const raw = {
    id: spec.id,
    synthetic: true,
    pages: pagePaths(spec, pageCount),
    supplierKey: spec.supplierKey,
    duplicateOf: null,
    extraction,
    lines: spec.lines.map((line) => ({
      productKey: line.productKey,
      occluded: false,
      uncertainFields: [],
      note: line.note ?? "",
    })),
    verification: {
      checkedAgainstImage: true,
      manifestDiffs: [],
      arithmetic: describeArithmetic(spec),
    },
  };
  const truth = parseTruth(raw, `${spec.id} (sintética)`);
  assertArithmetic(truth);
  return truth;
}

/** Revalida sobre la verdad ya serializable (no sobre el modelo). */
function assertArithmetic(truth: InvoiceTruth): void {
  const { extraction } = truth;
  const cents = (n: number) => Math.round(n * 100);
  const sum = extraction.lines.reduce((acc, line) => acc + cents(line.lineTotal), 0);
  if (extraction.subtotal !== undefined && cents(extraction.subtotal) !== sum) {
    throw new Error(`${truth.id}: sum(lineTotal) ${sum} ≠ subtotal ${extraction.subtotal}`);
  }
  if (extraction.subtotal === undefined && extraction.total !== undefined && cents(extraction.total) !== sum) {
    throw new Error(`${truth.id}: sum(lineTotal) ${sum} ≠ total ${extraction.total}`);
  }
  for (const line of extraction.lines) {
    const gross = Math.round(line.quantity * cents(line.unitPrice));
    if (gross < cents(line.lineTotal)) throw new Error(`${truth.id}: lineTotal mayor que cantidad × precio en ${line.rawText}`);
  }
}

function writeKeys(): void {
  const rows: string[] = [];
  for (const [key, name] of Object.entries(NEW_PRODUCTS)) {
    const uses = INVOICES.flatMap((spec) =>
      spec.lines.filter((line) => line.productKey === key).map((line) => ({ spec, line })),
    );
    if (uses.length === 0) continue;
    const ids = [...new Set(uses.map((use) => use.spec.id))].join(",");
    const packs = [...new Set(uses.map((use) => use.line.unitsPerPack ?? 1))].join("/");
    const last = [...uses].sort((a, b) => (a.spec.date ?? "").localeCompare(b.spec.date ?? "")).at(-1)!;
    const perUnit = last.line.unitPrice / (last.line.unitsPerPack ?? 1);
    rows.push(
      `${key}\t${name}\t${ids}\t${packs}\t${perUnit.toFixed(2)} (${last.spec.id} ${last.line.unitPrice.toFixed(2)}/${last.line.unitsPerPack ?? 1})`,
    );
  }
  writeFileSync(join(HERE, "keys-sint.txt"), `${rows.join("\n")}\n`, "utf8");
}

async function renderAll(browser: Browser): Promise<Map<string, number>> {
  const pageCounts = new Map<string, number>();
  for (const spec of INVOICES) {
    const pages = renderInvoice(spec);
    const paths = pagePaths(spec, pages.length);
    for (const [i, rendered] of pages.entries()) {
      const longest = Math.round(Math.max(rendered.width, rendered.height) * rendered.scale);
      if (longest > MAX_SIDE) throw new Error(`${spec.id}: lado mayor ${longest}px > ${MAX_SIDE}`);
      const context = await browser.newContext({
        viewport: { width: rendered.width, height: rendered.height },
        deviceScaleFactor: rendered.scale,
      });
      try {
        const page = await context.newPage();
        await page.setContent(rendered.html, { waitUntil: "load" });
        await page.evaluate(async () => {
          await document.fonts.ready;
        });
        await page.screenshot({
          path: join(EVAL_DIR, paths[i]),
          type: "jpeg",
          quality: JPEG_QUALITY,
          animations: "disabled",
          caret: "hide",
        });
      } finally {
        await context.close();
      }
    }
    pageCounts.set(spec.id, pages.length);
  }
  return pageCounts;
}

async function main(): Promise<void> {
  mkdirSync(SAMPLES_DIR, { recursive: true });
  mkdirSync(TRUTH_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  let pageCounts: Map<string, number>;
  try {
    pageCounts = await renderAll(browser);
  } finally {
    await browser.close();
  }
  for (const spec of INVOICES) {
    const truth = buildTruth(spec, pageCounts.get(spec.id) ?? 1);
    writeFileSync(join(TRUTH_DIR, `${spec.id}.json`), `${JSON.stringify(truth, null, 2)}\n`, "utf8");
    console.log(`${spec.id}: ${truth.pages.join(", ")} · ${truth.extraction.lines.length} líneas · total ${truth.extraction.total ?? "-"}`);
  }
  writeKeys();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
