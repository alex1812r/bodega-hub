/**
 * REP14-04 · B-p15A-1 (caos p15 A): `totals.mismatch` del servidor = el de la revisión
 * también en facturas en USD. El mínimo de la tolerancia sale del mismo predicado
 * (documento en dólares → 0,01; si no, 1 Bs).
 */
import type { InvoiceExtraction } from "@/modules/invoice-scan/contracts";
import type { InvoiceTaxLine } from "@/modules/invoice-scan/invoiceTaxCheck";
import { computeTotals } from "@/modules/invoice-scan/server/match/money";

import { makeReviewResponse } from "./reviewFixtures";
import { createInvoiceReviewState, getInvoiceReviewTotals, type InvoiceReviewContext } from "./reviewModel";

const ctx: InvoiceReviewContext = { systemRateVes: 900, taxRates: { exento: 0, general: 16, reducida: 8 } };
const code = (pct: number) => (pct === 16 ? "general" : pct === 8 ? "reducida" : "exento");

type Figures = Pick<InvoiceExtraction, "subtotal" | "tax" | "total">;

function serverMismatch(currency: "VES" | "USD", lines: InvoiceTaxLine[], figures: Figures): boolean {
  const extraction = { supplier: { name: "x" }, currency, lines: [], confidence: 1, warnings: [], ...figures };
  return computeTotals(extraction as InvoiceExtraction, lines).mismatch;
}

function clientMismatch(currency: "VES" | "USD", lines: InvoiceTaxLine[], figures: Figures): boolean {
  const state = createInvoiceReviewState(
    makeReviewResponse({
      lines: lines.map((line) => ({
        read: { quantity: 1, unitPrice: line.amount, lineTotal: line.amount },
        match: { taxRateCode: code(line.ratePct) },
      })),
      extraction: { currency, ...figures },
    }),
    ctx,
  );
  return getInvoiceReviewTotals(state).mismatch;
}

describe("REP14-04 · B-p15A-1 · tolerancia de totales en USD: servidor = revisión", () => {
  it.each([
    ["exenta 9,50 frente a total 10", [{ amount: 9.5, ratePct: 0 }], { total: 10 }, true],
    ["exenta 99,20 frente a total 100", [{ amount: 99.2, ratePct: 0 }], { total: 100 }, true],
    ["exenta 0,40 frente a total 1,20", [{ amount: 0.4, ratePct: 0 }], { total: 1.2 }, true],
    ["exenta 9,99 frente a total 10 (dentro del 1 %)", [{ amount: 9.99, ratePct: 0 }], { total: 10 }, false],
    ["6,52 con IVA 0,90 incluido (se sugiere incluido)", [{ amount: 6.52, ratePct: 16 }], { tax: 0.9, total: 6.52 }, false],
  ] as const)("USD %s", (_name, lines, figures, expected) => {
    expect(serverMismatch("USD", [...lines], figures)).toBe(expected);
    expect(clientMismatch("USD", [...lines], figures)).toBe(expected);
  });

  it("en Bs sigue el mínimo de 1 Bs (9,50 frente a 10 cuadra en los dos)", () => {
    expect(serverMismatch("VES", [{ amount: 9.5, ratePct: 0 }], { total: 10 })).toBe(false);
    expect(clientMismatch("VES", [{ amount: 9.5, ratePct: 0 }], { total: 10 })).toBe(false);
  });

  it("fuzz de coherencia (semillas 15 y 1515): 0 diferencias en VES y en USD", () => {
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const diffs: string[] = [];
    for (const seed0 of [15, 1515]) {
      let sd = seed0;
      const rr = () => (sd = (sd * 1103515245 + 12345) % 2147483648) / 2147483648;
      for (let i = 0; i < 3000; i++) {
        const incl = rr() < 0.3;
        const scale = rr() < 0.15 ? 50 : 200000;
        const E = rr() < 0.5 ? 0 : r2(rr() * scale);
        const G16 = rr() < 0.1 ? 0 : r2(0.5 + rr() * scale);
        const G8 = rr() < 0.25 ? r2((rr() * scale) / 4) : 0;
        const base = [
          { amount: E, ratePct: 0 },
          { amount: G16, ratePct: 16 },
          { amount: G8, ratePct: 8 },
        ].filter((line) => line.amount > 0);
        if (!base.length) continue;
        const shown = incl ? base.map((l) => ({ ...l, amount: r2(l.amount * (1 + l.ratePct / 100)) })) : base;
        const plainTax = r2(r2(G16 * 0.16) + r2(G8 * 0.08));
        const sub = r2(E + G16 + G8);
        const variants: Figures[] = [
          { subtotal: sub, tax: plainTax, total: r2(sub + plainTax) },
          { tax: plainTax, total: r2(sub + plainTax) },
          { subtotal: r2(sub + plainTax), tax: plainTax, total: r2(sub + plainTax) },
          { subtotal: sub, tax: 0, total: r2(sub + plainTax) },
          { total: r2(sub + plainTax) },
          { subtotal: sub },
        ];
        const figures = variants[Math.floor(rr() * variants.length)];
        for (const currency of ["VES", "USD"] as const) {
          const srv = serverMismatch(currency, shown, figures);
          const cli = clientMismatch(currency, shown, figures);
          if (srv !== cli) diffs.push(`${currency} srv=${srv} cli=${cli} ${JSON.stringify({ shown, ...figures })}`);
        }
      }
    }
    expect(diffs).toEqual([]);
  });
});
