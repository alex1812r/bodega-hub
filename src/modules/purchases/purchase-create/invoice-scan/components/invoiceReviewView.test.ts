import { createInvoiceReviewState } from "../reviewModel";
import { doubtfulLine, makeReviewResponse, productUuid, REVIEW_TAX_RATES, unmatchedLine } from "../reviewFixtures";
import {
  buildNewProductInitialValues,
  buildReviewTaxRates,
  confirmedToggleLabel,
  getChoiceChips,
  getDisplayedTotals,
} from "./invoiceReviewView";

describe("invoiceReviewView", () => {
  it("precarga el producto nuevo con el costo REF por unidad con IVA, también en empaque", () => {
    const state = createInvoiceReviewState(
      makeReviewResponse({
        lines: [
          unmatchedLine(1, false, {
            read: { description: "Refresco 1,5L", quantity: 1, unitPrice: 10800, lineTotal: 10800, unit: "bulto" },
            match: { entryMode: "pack", unitsPerPack: 6, taxRateCode: "exento" },
          }),
        ],
      }),
      { systemRateVes: 900, taxRates: REVIEW_TAX_RATES },
    );

    expect(buildNewProductInitialValues(state, state.lines[0])).toEqual({ currentCostRef: 2, name: "Refresco 1,5L" });
  });

  it("sin tasa no precarga costo", () => {
    const state = createInvoiceReviewState(makeReviewResponse({ lines: [unmatchedLine(1, false)] }), {
      taxRates: REVIEW_TAX_RATES,
    });

    expect(buildNewProductInitialValues(state, state.lines[0])).toEqual({ name: "Harina PAN 1kg" });
  });

  it("elige el calculado más cercano al leído y solo da diferencia con descuadre", () => {
    expect(getDisplayedTotals({ computed: 200, computedWithTax: 232, lineMismatches: [], mismatch: false, read: 200 })).toEqual({
      computed: 200,
      ok: true,
      read: 200,
    });
    expect(getDisplayedTotals({ computed: 200, computedWithTax: 232, lineMismatches: [], mismatch: false })).toEqual({
      computed: 232,
      ok: true,
    });
  });

  it("chips: candidatos y el propuesto si no está entre ellos", () => {
    const state = createInvoiceReviewState(
      makeReviewResponse({ lines: [doubtfulLine(2), {}], extraction: { currency: "USD" } }),
      { systemRateVes: 900, taxRates: REVIEW_TAX_RATES },
    );

    expect(getChoiceChips(state.lines[0]).map((chip) => chip.productId)).toEqual([productUuid(2), productUuid(102)]);
    expect(getChoiceChips(state.lines[1])).toEqual([
      { detail: "Propuesto por el emparejamiento", name: "Producto propuesto", productId: productUuid(2) },
    ]);
  });

  it("catálogo de alícuotas y etiqueta de confirmadas", () => {
    expect(buildReviewTaxRates(REVIEW_TAX_RATES).map((rate) => [rate.code, rate.label, rate.pct])).toEqual([
      ["exento", "Exento", 0],
      ["reducida", "Reducida", 8],
      ["general", "General", 16],
    ]);
    expect(confirmedToggleLabel(12, false)).toBe("12 líneas confirmadas · ver");
    expect(confirmedToggleLabel(1, true)).toBe("1 línea confirmada · ocultar");
  });
});
