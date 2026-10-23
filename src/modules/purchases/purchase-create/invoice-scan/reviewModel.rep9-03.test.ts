/**
 * REP9-03 · M-p9-2 (D41-b): Enter y toda aceptación actúan sobre el producto que el usuario ya
 * eligió (chip, buscador, alta), no sobre el 1.º candidato.
 */
import {
  createInvoiceReviewState,
  enterTargetProductId,
  type InvoiceReviewContext,
  type InvoiceReviewState,
  reviewReducer,
} from "./reviewModel";
import { doubtfulLine, makeReviewResponse, productUuid, REVIEW_TAX_RATES } from "./reviewFixtures";

const CONTEXT: InvoiceReviewContext = { systemRateVes: 900, taxRates: REVIEW_TAX_RATES };

/** Candidatos sin empate: «Producto 10» (0,75) y «Otro 10» (0,50); propone el 1.º. */
const initial = () => createInvoiceReviewState(makeReviewResponse({ lines: [doubtfulLine(10, 0.75)] }), CONTEXT);

function enter(state: InvoiceReviewState): InvoiceReviewState {
  return reviewReducer(state, { type: "acceptMarked", index: 0 });
}

describe("REP9-03 · enterTargetProductId / acceptMarked con producto ya elegido", () => {
  it("sin elección del usuario, Enter sigue aceptando el 1.º candidato", () => {
    const state = initial();
    expect(enterTargetProductId(state.lines[0])).toBe(productUuid(10));
    expect(enter(state).lines[0].productId).toBe(productUuid(10));
  });

  it("elegido el 2.º candidato con el chip, Enter no lo cambia por el 1.º", () => {
    const chosen = reviewReducer(initial(), { type: "acceptCandidate", index: 0, productId: productUuid(110) });
    expect(enterTargetProductId(chosen.lines[0])).toBe(productUuid(110));
    expect(enter(chosen).lines[0].productId).toBe(productUuid(110));
  });

  it("elegido en el buscador (fuera de los candidatos), Enter lo conserva", () => {
    const product = { productId: productUuid(500), name: "Malta Polar 1.5L" };
    const chosen = reviewReducer(initial(), { type: "chooseProduct", index: 0, product });
    expect(enterTargetProductId(chosen.lines[0])).toBe(productUuid(500));
    const after = enter(chosen).lines[0];
    expect(after.productId).toBe(productUuid(500));
    expect(after.productName).toBe("Malta Polar 1.5L");
  });
});
