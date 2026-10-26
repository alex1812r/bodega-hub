/**
 * REP13-01 (D59, D60-a, M-p14-1): la regla única de IVA sugiere "los precios incluyen IVA"
 * solo si esa hipótesis cuadra con el total leído mejor que la otra y dentro de una
 * tolerancia acotada; el servidor (`computeTotals`, `totals.mismatch`) decide con ella.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { invoiceExtractionSchema, type InvoiceExtraction } from "./contracts";
import {
  assessInvoiceTax,
  getInvoiceRegisteredAmounts,
  getInvoiceTotalsGap,
  type InvoiceTaxInput,
  type InvoiceTaxLine,
} from "./invoiceTaxCheck";
import { computeTotals } from "./server/match/money";

const L = (amount: number, ratePct: number): InvoiceTaxLine => ({ amount, ratePct });
type Figures = Pick<InvoiceTaxInput, "subtotal" | "tax" | "total">;

/** f12 real (QA p14, escaneo d5e9627d): 9 líneas exentas y 32 gravadas al 16 %, sumadas. */
const F12 = [L(100704.69, 0), L(185349.76, 16)];

const RATE_BY_HINT: Record<string, number> = { exento: 0, general: 16, reducida: 8 };

/** Extracción guardada de f12 con el subtotal leído = EXENTO; alícuotas por `taxHint`. */
function f12Extraction(): { lines: InvoiceTaxLine[]; figures: Figures } {
  const file = join(
    __dirname,
    "../../../scripts/invoice-eval/cache/google/gemini-3.5-flash-lite/f12-sinAlias-a7f071bd37dbcefe.json",
  );
  const extraction = invoiceExtractionSchema.parse(JSON.parse(readFileSync(file, "utf8")).extraction);
  const lines = extraction.lines.map((line) => L(line.lineTotal ?? 0, RATE_BY_HINT[line.taxHint ?? "general"] ?? 16));
  return { lines, figures: { subtotal: extraction.subtotal, tax: extraction.tax, total: extraction.total } };
}

function serverTotals(lines: InvoiceTaxLine[], figures: Figures) {
  const extraction: InvoiceExtraction = {
    supplier: { name: "Proveedor" },
    currency: "VES",
    lines: [],
    confidence: 1,
    warnings: [],
    ...figures,
  };
  return computeTotals(extraction, lines);
}

type Case = { name: string; lines: InvoiceTaxLine[]; figures: Figures; suggested: boolean; mismatch: boolean };

const realF12 = f12Extraction();

const cases: Case[] = [
  {
    name: "f12 QA: subtotal leído = EXENTO; sin IVA cuadra",
    lines: F12,
    figures: { subtotal: 100704.69, tax: 29655.74, total: 315708.83 },
    suggested: false,
    mismatch: false,
  },
  {
    name: "f12 extracción guardada (alícuotas del modelo): ninguna cuadra, no se sugiere",
    lines: realF12.lines,
    figures: realF12.figures,
    suggested: false,
    mismatch: true,
  },
  {
    name: "caos B sin modelo: exento 1.000 + gravado 5.000, subtotal = exento",
    lines: [L(1000, 0), L(5000, 16)],
    figures: { subtotal: 1000, tax: 800, total: 6800 },
    suggested: false,
    mismatch: false,
  },
  ...[4800, 5000, 10000, 50000].map((exempt) => ({
    name: `V1 subtotal = BI G (exento ${exempt}, gravado 10.000)`,
    lines: [L(exempt, 0), L(10000, 16)],
    figures: { subtotal: 10000, tax: 1600, total: exempt + 11600 },
    suggested: false,
    mismatch: false,
  })),
  {
    name: "V4a sin subtotal, IVA leído = BI G",
    lines: F12,
    figures: { tax: 185349.76, total: 315708.83 },
    suggested: false,
    mismatch: false,
  },
  {
    name: "V5 mixta exento/8/16 con subtotal = exento",
    lines: [L(50000, 0), L(20000, 8), L(30000, 16)],
    figures: { subtotal: 50000, tax: 6400, total: 106400 },
    suggested: false,
    mismatch: false,
  },
  {
    name: "V5b mixta 8/16 con subtotal = BI 16 %",
    lines: [L(20000, 8), L(30000, 16)],
    figures: { subtotal: 30000, tax: 6400, total: 56400 },
    suggested: false,
    mismatch: false,
  },
  {
    name: "V3a subtotal = EXENTO sin IVA leído",
    lines: F12,
    figures: { subtotal: 100704.69, total: 315708.83 },
    suggested: false,
    mismatch: false,
  },
  {
    name: "f12 con el subtotal bien leído",
    lines: F12,
    figures: { subtotal: 286054.45, tax: 29655.74, total: 315708.83 },
    suggested: false,
    mismatch: false,
  },
  {
    name: "IVA incluido real con desglose",
    lines: [L(11600, 16)],
    figures: { subtotal: 10000, tax: 1600, total: 11600 },
    suggested: true,
    mismatch: false,
  },
  {
    name: "IVA incluido real, mixta con exento",
    lines: [L(5000, 0), L(11600, 16)],
    figures: { subtotal: 15000, tax: 1600, total: 16600 },
    suggested: true,
    mismatch: false,
  },
  {
    name: "IVA incluido real, subtotal leído = exento",
    lines: [L(5000, 0), L(11600, 16)],
    figures: { subtotal: 5000, tax: 1600, total: 16600 },
    suggested: true,
    mismatch: false,
  },
  {
    name: "IVA incluido real, solo total",
    lines: [L(11600, 16)],
    figures: { total: 11600 },
    suggested: true,
    mismatch: false,
  },
  {
    name: "sin IVA real",
    lines: [L(10000, 16)],
    figures: { subtotal: 10000, tax: 1600, total: 11600 },
    suggested: false,
    mismatch: false,
  },
];

describe("assessInvoiceTax · sugerencia de IVA incluido (D59)", () => {
  it.each(cases)("$name", ({ lines, figures, suggested, mismatch }) => {
    const assessment = assessInvoiceTax({ lines, ...figures, minTolerance: 1 });
    const gapIncluded = getInvoiceTotalsGap(assessment, getInvoiceRegisteredAmounts(lines, true));
    const gapPlain = getInvoiceTotalsGap(assessment, getInvoiceRegisteredAmounts(lines, false));

    expect(assessment.includedSuggested).toBe(suggested);
    // La hipótesis elegida nunca descuadra si la otra cuadra.
    const [chosenGap, otherGap] = suggested ? [gapIncluded, gapPlain] : [gapPlain, gapIncluded];
    expect(chosenGap !== undefined && otherGap === undefined).toBe(false);
    // El servidor decide con la misma regla (D60-a).
    expect(serverTotals(lines, figures).mismatch).toBe(mismatch);
  });
});
