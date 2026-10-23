/**
 * REP9-04 · B-r9-1 (QA p9, D43): elegir una opción cuyo costo se desvía NUNCA reconoce ese costo.
 * Repro f04 real (L0 Mayonesa, 0,50 a 40.675,41 Bs, último 3,83 REF): chip, «Por bulto», 12 por
 * bulto y «Cargar como 6 unidades» (3,77 REF/u, resuelta). Un 2.º toque cae en «Por bulto»
 * (6 bultos = 72 u a 0,31 REF/u) y la línea quedaba resuelta con 12× las unidades.
 * El reconocimiento es una acción aparte (`acknowledgeCost`), solo tras elegir la opción.
 */
import { makeReviewResponse, productUuid, REVIEW_TAX_RATES, type ReviewFixtureLine } from "./reviewFixtures";
import {
  createInvoiceReviewState,
  getLineCostReview,
  reviewReducer,
  type InvoiceReviewAction,
  type InvoiceReviewState,
} from "./reviewModel";

const MAYONESA = productUuid(46);

function mayonesaLine(): ReviewFixtureLine {
  return {
    read: {
      rawText: "001 MAYONESA MAVESA 445GR 0,50 x40,675.41 (E) #46.50 20337.71",
      description: "MAYONESA MAVESA 445GR",
      unit: "unidad",
      quantity: 0.5,
      unitPrice: 40675.41,
      lineTotal: 20337.71,
    },
    match: {
      status: "doubtful",
      productId: MAYONESA,
      entryMode: "unit",
      taxRateCode: "exento",
      candidates: [
        { productId: MAYONESA, name: "Mayonesa Mavesa 445g", score: 0.8, reason: "nombre parecido", lastUnitCostRef: 3.83 },
      ],
      lastUnitCostRef: 3.83,
      // El servidor avisa del precio (f04 real): la opción se elige (D31).
      issues: ["¿Precio por caja o por unidad? Sale a 45,19 REF por unidad y el último costo fue 3,83 REF."],
    },
  };
}

function run(state: InvoiceReviewState, ...actions: InvoiceReviewAction[]): InvoiceReviewState {
  return actions.reduce(reviewReducer, state);
}

/** Paso 1 del repro: la línea queda resuelta como 6 unidades a 3,77 REF/u. */
function convertedToUnits(): InvoiceReviewState {
  const state = createInvoiceReviewState(makeReviewResponse({ lines: [mayonesaLine()] }), {
    systemRateVes: 900,
    taxRates: REVIEW_TAX_RATES,
  });
  return run(
    state,
    { type: "acceptCandidate", index: 0, productId: MAYONESA },
    { type: "editEntryMode", index: 0, entryMode: "pack" },
    { type: "editUnitsPerPack", index: 0, unitsPerPack: 12 },
    { type: "convertPackToUnits", index: 0 },
  );
}

describe("REP9-04 · B-r9-1: elegir la opción desviada no reconoce su costo", () => {
  it("repro f04: tras «Cargar como 6 unidades», elegir «Por bulto» deja la línea sin resolver ni reconocer", () => {
    const converted = convertedToUnits();
    expect(converted.lines[0]).toMatchObject({ status: "resolved", entryMode: "unit", quantity: 6 });

    const state = run(converted, { type: "editEntryMode", index: 0, entryMode: "pack" });

    expect(state.lines[0].entryMode).toBe("pack");
    expect(state.lines[0].status).not.toBe("resolved");
    expect(state.lines[0].costAck).toBeUndefined();
    expect(getLineCostReview(state, state.lines[0])).toEqual({ kind: "acknowledge", reason: "deviates", acknowledged: false });
  });

  it("elegir la misma opción desviada otra vez tampoco la reconoce", () => {
    const state = run(
      convertedToUnits(),
      { type: "editEntryMode", index: 0, entryMode: "pack" },
      { type: "editEntryMode", index: 0, entryMode: "pack" },
    );

    expect(state.lines[0].status).not.toBe("resolved");
  });

  it("«acknowledgeCost» tras elegir la opción la reconoce y la línea queda resuelta", () => {
    const state = run(
      convertedToUnits(),
      { type: "editEntryMode", index: 0, entryMode: "pack" },
      { type: "acknowledgeCost", index: 0 },
    );

    expect(state.lines[0].status).toBe("resolved");
    expect(getLineCostReview(state, state.lines[0])).toEqual({ kind: "acknowledge", reason: "deviates", acknowledged: true });
  });

  it("«acknowledgeCost» sin haber elegido la opción no hace nada", () => {
    const state = createInvoiceReviewState(makeReviewResponse({ lines: [mayonesaLine()] }), {
      systemRateVes: 900,
      taxRates: REVIEW_TAX_RATES,
    });
    // 0,50 por unidad a 40.675,41 Bs = 45,19 REF/u frente a 3,83: desviada, sin elección.
    const accepted = run(state, { type: "acceptCandidate", index: 0, productId: MAYONESA });
    expect(accepted.lines[0].choiceMade).toBeFalsy();

    const next = run(accepted, { type: "acknowledgeCost", index: 0 });

    expect(next.lines[0]).toBe(accepted.lines[0]);
  });

  it("«acknowledgeCost» con el costo coherente no hace nada", () => {
    const converted = convertedToUnits();

    expect(run(converted, { type: "acknowledgeCost", index: 0 })).toBe(converted);
  });

  it("cambiar de opción y volver retira el reconocimiento: hay que reconocer otra vez", () => {
    const state = run(
      convertedToUnits(),
      { type: "editEntryMode", index: 0, entryMode: "pack" },
      { type: "acknowledgeCost", index: 0 },
      { type: "editEntryMode", index: 0, entryMode: "unit" },
      { type: "editEntryMode", index: 0, entryMode: "pack" },
    );

    expect(state.lines[0].status).not.toBe("resolved");
    expect(state.lines[0].costAck).toBeUndefined();
  });
});
