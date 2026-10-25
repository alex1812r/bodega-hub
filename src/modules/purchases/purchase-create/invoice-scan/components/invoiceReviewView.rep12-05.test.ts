/**
 * REP12-05 · B-qa-rep12-3: los textos de las opciones de modo citaban la cantidad redondeada a 3
 * decimales («Por unidad 3 u», «3 bultos» con 2,9999; «1 bultos» con 1,0001). Se citan como el aviso
 * de cantidad (REP12-04: hasta 15 cifras significativas) y el singular solo vale para exactamente 1.
 */
import type { EntryModeOutcome } from "../reviewModel";
import { createInvoiceReviewState } from "../reviewModel";
import { makeReviewResponse, productUuid, REVIEW_TAX_RATES } from "../reviewFixtures";
import { entryModeOutcomeText } from "./invoiceReviewView";

function bultoLine() {
  const state = createInvoiceReviewState(
    makeReviewResponse({ lines: [{ match: { productId: productUuid(1), taxRateCode: "exento" } }] }),
    { systemRateVes: 900, taxRates: REVIEW_TAX_RATES },
  );
  return { ...state.lines[0], packLabel: "bulto" };
}

const outcome = (entryMode: "unit" | "pack", quantity: number, units?: number): EntryModeOutcome => ({
  entryMode,
  quantity,
  units,
  deviates: false,
});

describe("REP12-05 · B-qa-rep12-3: la cantidad de las opciones no se redondea", () => {
  it.each([
    [2.9999, "2,9999 u"],
    [1.0001, "1,0001 u"],
    [0.0001, "0,0001 u"],
    [1, "1 u"],
  ])("«Por unidad» con %p dice «%s»", (quantity, text) => {
    expect(entryModeOutcomeText(bultoLine(), outcome("unit", quantity))).toBe(text);
  });

  it.each([
    [2.9999, undefined, "2,9999 bultos · indica las unidades por bulto"],
    [1.0001, undefined, "1,0001 bultos · indica las unidades por bulto"],
    [1, undefined, "1 bulto · indica las unidades por bulto"],
    [0.1, 0.1 * 3, "0,1 bultos = 0,3 u"],
    [2.9999, 2.9999 * 6, "2,9999 bultos = 17,9994 u"],
  ])("«Por bulto» con %p (unidades %p) dice «%s»", (quantity, units, text) => {
    expect(entryModeOutcomeText(bultoLine(), outcome("pack", quantity, units))).toBe(text);
  });
});
