/**
 * REP8-01 (D38, QA p8 M-p8-1): cada opción «Por unidad / Por empaque» se compara con el último
 * costo que trae el emparejamiento (`match.lastUnitCostRef`), haya o no aviso de precio.
 */
import { priceCoherenceIssue } from "@/modules/invoice-scan/server/match/money";

import { doubtfulLine, makeReviewResponse, productUuid, REVIEW_TAX_RATES, type ReviewFixtureLine } from "./reviewFixtures";
import { createInvoiceReviewState, getEntryModeOutcome, reviewReducer, type InvoiceReviewState } from "./reviewModel";

/** 18.320,29 Bs ÷ 20 ÷ 880,78 = 1,04 REF/u por bulto; 20,80 REF/u «por unidad». */
const RATE = 880.78;
const CONTRADICTION =
  "Antes este proveedor lo facturó por unidad; ahora dice bulto: confirma si son empaques o unidades sueltas.";
const harinaRead = {
  rawText: "HARINA PAN 1KG (E) [BULTO X 20.0]",
  description: "HARINA PAN 1KG",
  unit: "bulto",
  unitsPerPack: 20,
  quantity: 1,
  unitPrice: 18320.29,
  lineTotal: 18320.29,
} as const;

function harinaState(match: ReviewFixtureLine["match"]): InvoiceReviewState {
  return createInvoiceReviewState(
    makeReviewResponse({
      lines: [doubtfulLine(1, 1, { read: harinaRead, match: { entryMode: "pack", unitsPerPack: 20, ...match } })],
    }),
    { systemRateVes: RATE, taxRates: REVIEW_TAX_RATES },
  );
}

describe("REP8-01 · getEntryModeOutcome con el último costo del emparejamiento", () => {
  it("lectura coherente sin aviso de precio: «Por unidad» sale desviada con último 1,04 y «Por bulto» no", () => {
    const state = harinaState({ issues: [CONTRADICTION], lastUnitCostRef: 1.04 });
    const [line] = state.lines;

    expect(getEntryModeOutcome(state, line, "unit")).toMatchObject({
      units: 1,
      lastUnitCostRef: 1.04,
      deviates: true,
    });
    expect(getEntryModeOutcome(state, line, "pack")).toMatchObject({
      units: 20,
      lastUnitCostRef: 1.04,
      deviates: false,
    });
  });

  it("elegida «Por unidad», la opción sigue marcada como desviada", () => {
    let state = harinaState({ issues: [CONTRADICTION], lastUnitCostRef: 1.04 });
    state = reviewReducer(state, { type: "editEntryMode", index: 0, entryMode: "unit" });

    expect(getEntryModeOutcome(state, state.lines[0], "unit")).toMatchObject({ lastUnitCostRef: 1.04, deviates: true });
  });

  it("otro producto elegido a mano: el último costo del propuesto ya no aplica", () => {
    let state = harinaState({ issues: [CONTRADICTION], lastUnitCostRef: 1.04 });
    state = reviewReducer(state, {
      type: "chooseProduct",
      index: 0,
      product: { productId: productUuid(77), name: "Otra harina" },
    });

    const outcome = getEntryModeOutcome(state, state.lines[0], "unit");
    expect(outcome?.lastUnitCostRef).toBeUndefined();
    expect(outcome?.deviates).toBe(false);
  });

  it("respuesta sin el campo (caché anterior): respaldo en el texto del aviso de precio", () => {
    const priceIssue = priceCoherenceIssue({
      line: { ...harinaRead, confidence: 0.9 },
      unitsPerPack: 1,
      entryMode: "unit",
      rate: RATE,
      lastUnitCostRef: 1.04,
    });
    const state = harinaState({ issues: [CONTRADICTION, priceIssue as string] });

    expect(getEntryModeOutcome(state, state.lines[0], "unit")).toMatchObject({ lastUnitCostRef: 1.04, deviates: true });
  });
});
