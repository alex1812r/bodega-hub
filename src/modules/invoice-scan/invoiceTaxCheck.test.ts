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

type Case = {
  name: string;
  lines: InvoiceTaxLine[];
  figures: Figures;
  suggested: boolean;
  mismatch: boolean;
  /** 0,01 en dólares; por defecto 1 Bs. */
  minTolerance?: number;
  /** B20: sin total leído, la hipótesis incluida cuadra el subtotal leído aunque el IVA leído sea erróneo. */
  fitsSubtotalOnly?: boolean;
};

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
  // REP13-04 (QA REP13-01): ninguna hipótesis cuadra; "incluido" es solo la más cercana y no se sugiere.
  {
    name: "QA REP13-01: descuento global, sin IVA real; ninguna cuadra",
    lines: [L(46876.64, 16)],
    figures: { subtotal: 41374.49, tax: 6619.92, total: 47994.41 },
    suggested: false,
    mismatch: true,
  },
  {
    name: "descuento global sin subtotal (USD); ninguna cuadra",
    lines: [L(280.24, 16)],
    figures: { tax: 39.84, total: 288.81 },
    suggested: false,
    mismatch: true,
    minTolerance: 0.01,
  },
  {
    name: "IVA incluido real con el total redondeado a 10 (USD); ninguna cuadra",
    lines: [L(112.73, 16)],
    figures: { subtotal: 97.18, tax: 15.55, total: 110 },
    suggested: false,
    mismatch: true,
    minTolerance: 0.01,
  },
  {
    name: "IVA incluido real, IVA leído al 8 % de la base; ninguna cuadra",
    lines: [L(70174.85, 0), L(116094.81, 16), L(5589.21, 8)],
    figures: { subtotal: 175431.77, tax: 14034.54, total: 189466.31 },
    suggested: false,
    mismatch: true,
  },
  {
    name: "B20 caos p5: IVA leído como 16 (la alícuota); el subtotal cuadra con IVA incluido",
    lines: [L(104.4, 16)],
    figures: { subtotal: 90, tax: 16 },
    suggested: true,
    mismatch: true,
    fitsSubtotalOnly: true,
  },
  // REP13-06 (D59, D61): sin total, solo subtotal o solo IVA: ninguna hipótesis cuadra → no se preselecciona.
  {
    name: "QA REP13-05 qa-04 sin total: incluido roza el subtotal, sin IVA da el IVA leído exacto; no se sugiere",
    lines: [L(162.19, 0), L(127.72, 0), L(680.82, 16)],
    figures: { subtotal: 881.2, tax: 108.93 },
    suggested: false,
    mismatch: true,
  },
  {
    name: "sin total, IVA incluido real con desglose",
    lines: [L(11600, 16)],
    figures: { subtotal: 10000, tax: 1600 },
    suggested: true,
    mismatch: false,
  },
  {
    name: "sin total, sin IVA real",
    lines: [L(10000, 16)],
    figures: { subtotal: 10000, tax: 1600 },
    suggested: false,
    mismatch: false,
  },
  {
    name: "sin total, mixta con exento e IVA incluido",
    lines: [L(5000, 0), L(11600, 16)],
    figures: { subtotal: 15000, tax: 1600 },
    suggested: true,
    mismatch: false,
  },
  {
    name: "solo subtotal: incluido a 200 de 10.200 (tolerancia del pie 102); ninguna cuadra",
    lines: [L(11600, 16)],
    figures: { subtotal: 10200 },
    suggested: false,
    mismatch: true,
  },
  {
    name: "solo subtotal, IVA incluido real",
    lines: [L(11600, 16)],
    figures: { subtotal: 10000 },
    suggested: true,
    mismatch: false,
  },
  {
    name: "solo subtotal, mixta con exento e IVA incluido",
    lines: [L(5000, 0), L(11600, 16)],
    figures: { subtotal: 15000 },
    suggested: true,
    mismatch: false,
  },
  {
    name: "solo subtotal, exenta",
    lines: [L(5000, 0)],
    figures: { subtotal: 5000 },
    suggested: false,
    mismatch: false,
  },
  {
    name: "solo IVA: incluido a 50 de 1.650 (tolerancia del pie 16,50); ninguna cuadra",
    lines: [L(11600, 16)],
    figures: { tax: 1650 },
    suggested: false,
    mismatch: true,
  },
  {
    name: "solo IVA, IVA incluido real",
    lines: [L(11600, 16)],
    figures: { tax: 1600 },
    suggested: true,
    mismatch: false,
  },
  {
    name: "solo IVA, mixta sin IVA",
    lines: [L(5000, 0), L(10000, 16)],
    figures: { tax: 1600 },
    suggested: false,
    mismatch: false,
  },
  {
    name: "solo IVA 0,00, exenta",
    lines: [L(5000, 0)],
    figures: { tax: 0 },
    suggested: false,
    mismatch: false,
  },
];

describe("assessInvoiceTax · sugerencia de IVA incluido (D59)", () => {
  it.each(cases)("$name", ({ lines, figures, suggested, mismatch, minTolerance = 1, fitsSubtotalOnly }) => {
    const assessment = assessInvoiceTax({ lines, ...figures, minTolerance });
    const gapIncluded = getInvoiceTotalsGap(assessment, getInvoiceRegisteredAmounts(lines, true));
    const gapPlain = getInvoiceTotalsGap(assessment, getInvoiceRegisteredAmounts(lines, false));

    expect(assessment.includedSuggested).toBe(suggested);
    // La hipótesis elegida nunca descuadra si la otra cuadra.
    const [chosenGap, otherGap] = suggested ? [gapIncluded, gapPlain] : [gapPlain, gapIncluded];
    expect(chosenGap !== undefined && otherGap === undefined).toBe(false);
    // REP13-04: la sugerida cuadra con el mismo criterio que el ✓ del pie (o, B20, con el subtotal leído).
    if (assessment.includedSuggested) {
      const fitted = fitsSubtotalOnly
        ? assessInvoiceTax({ lines, subtotal: figures.subtotal, minTolerance })
        : assessment;
      expect(getInvoiceTotalsGap(fitted, getInvoiceRegisteredAmounts(lines, true))).toBeUndefined();
    }
    // El servidor decide con la misma regla (D60-a).
    expect(serverTotals(lines, figures).mismatch).toBe(mismatch);
  });
});

/**
 * REP13-06 (D59): fuzz determinista sin total / solo subtotal / solo IVA, con la verdad conocida y
 * una cifra mal leída. Si se sugiere "incluye IVA", la hipótesis incluida cuadra con la tolerancia
 * del pie la referencia o (sin total, B20) el subtotal leído, y la de "sin IVA" no cuadra mejor
 * ninguna cifra leída.
 */
describe("assessInvoiceTax · sin total, solo subtotal o solo IVA: no sugiere si la incluida no cuadra (D59)", () => {
  /** Desajuste de una hipótesis con una cifra leída, en tolerancias del pie (≤ 1: cuadra). */
  function misfit(lines: InvoiceTaxLine[], figure: "subtotal" | "tax", read: number, included: boolean): number {
    const single = assessInvoiceTax({ lines, [figure]: read, minTolerance: 1 });
    const registered = getInvoiceRegisteredAmounts(lines, included);
    const compared = figure === "subtotal" ? registered.base : registered.tax;
    return Math.abs(read - compared) / single.tolerance;
  }

  it("20.000 casos con semilla 1306: 0 sugerencias que no cuadran", () => {
    let seed = 1306;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const kinds = ["sub+tax", "sub", "tax"] as const;
    const errors = ["ok", "sub=exento", "sub=BIG", "sub×1.02", "tax=2x", "tax=16", "tax×1.04"] as const;
    const failures: string[] = [];
    for (let i = 0; i < 20000; i++) {
      const incl = rnd() < 0.4;
      const E = rnd() < 0.5 ? 0 : r2(rnd() * 20000);
      const G16 = r2(10 + rnd() * 20000);
      const G8 = rnd() < 0.2 ? r2(rnd() * 5000) : 0;
      const plainLines = [L(E, 0), L(G16, 16), L(G8, 8)].filter((line) => line.amount > 0);
      const lines = incl ? plainLines.map((l) => L(r2(l.amount * (1 + l.ratePct / 100)), l.ratePct)) : plainLines;
      let subtotal = r2(E + G16 + G8);
      let tax = r2(G16 * 0.16 + G8 * 0.08);
      const error = errors[Math.floor(rnd() * errors.length)];
      if (error === "sub=exento" && E) subtotal = E;
      if (error === "sub=BIG" && E) subtotal = r2(G16 + G8);
      if (error === "sub×1.02") subtotal = r2(subtotal * 1.02);
      if (error === "tax=2x") tax = r2(tax * 2);
      if (error === "tax=16") tax = 16;
      if (error === "tax×1.04") tax = r2(tax * 1.04);
      const kind = kinds[Math.floor(rnd() * kinds.length)];
      const figures: Figures = kind === "sub+tax" ? { subtotal, tax } : kind === "sub" ? { subtotal } : { tax };
      const assessment = assessInvoiceTax({ lines, ...figures, minTolerance: 1 });
      if (!assessment.includedSuggested) continue;
      const fitsReference =
        getInvoiceTotalsGap(assessment, getInvoiceRegisteredAmounts(lines, true)) === undefined;
      const fitsSubtotalBetter =
        kind === "sub+tax" &&
        misfit(lines, "subtotal", subtotal, true) <= 1 &&
        misfit(lines, "subtotal", subtotal, true) <
          Math.min(misfit(lines, "subtotal", subtotal, false), misfit(lines, "tax", tax, false));
      if (!fitsReference && !fitsSubtotalBetter) {
        failures.push(JSON.stringify({ kind, error, incl, lines, ...figures }));
      }
    }
    expect(failures.slice(0, 3)).toEqual([]);
  });
});
