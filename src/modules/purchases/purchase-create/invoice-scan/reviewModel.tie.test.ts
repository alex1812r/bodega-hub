/**
 * REP-04 · caos-global B2 / D24-d: dos candidatos empatados sin desempate (mismo
 * motivo y mismo score a la vista) → ninguno premarcado (Enter no elige al azar)
 * y los chips llevan el SKU para distinguirlos.
 */
import { getChoiceChips } from "./components/invoiceReviewView";
import { REVIEW_TAX_RATES, makeReviewResponse, productUuid } from "./reviewFixtures";
import { createInvoiceReviewState, enterTargetProductId, pressEnter, type InvoiceReviewState } from "./reviewModel";

const A = productUuid(1);
const B = productUuid(2);

function stateWith(candidates: { productId: string; name: string; score: number; reason: string; sku?: string }[], productId?: string): InvoiceReviewState {
  return createInvoiceReviewState(
    makeReviewResponse({ lines: [{ match: { candidates, productId, status: "doubtful" } }] }),
    { systemRateVes: 900, taxRates: REVIEW_TAX_RATES },
  );
}

describe("premarcado con candidatos empatados (REP-04 · D24-d)", () => {
  it("dos candidatos con el mismo motivo y score y sin propuesto: ninguno premarcado y Enter no elige", () => {
    const state = stateWith([
      { name: "CAOSG Jabon Azul 250g", productId: A, reason: "nombre parecido 0,73", score: 0.7312, sku: "JAB-01" },
      { name: "CAOSG Jabon Azul 250g", productId: B, reason: "nombre parecido 0,73", score: 0.7298, sku: "JAB-02" },
    ]);
    const line = state.lines[0]!;

    expect(enterTargetProductId(line)).toBeUndefined();
    expect(pressEnter(state, 0).state.lines[0]?.productId).toBeUndefined();
  });

  it("sin empate se premarca el primero", () => {
    const state = stateWith([
      { name: "Jabón Azul", productId: A, reason: "nombre parecido 0,81", score: 0.81 },
      { name: "Jabón Rosa", productId: B, reason: "nombre parecido 0,73", score: 0.73 },
    ]);

    expect(enterTargetProductId(state.lines[0]!)).toBe(A);
  });

  it("mismo score con distinto motivo (desempate del emparejamiento): se premarca el primero", () => {
    const state = stateWith([
      { name: "Jabón Azul", productId: A, reason: "nombre parecido 0,73 · vinculado al proveedor", score: 0.73 },
      { name: "Jabón Azul", productId: B, reason: "nombre parecido 0,73", score: 0.73 },
    ]);

    expect(enterTargetProductId(state.lines[0]!)).toBe(A);
  });

  it("el marcado con las flechas manda aunque haya empate", () => {
    const state = stateWith([
      { name: "Jabón", productId: A, reason: "nombre parecido 0,73", score: 0.73 },
      { name: "Jabón", productId: B, reason: "nombre parecido 0,73", score: 0.73 },
    ]);

    expect(enterTargetProductId({ ...state.lines[0]!, markedProductId: B })).toBe(B);
  });

  it("los chips muestran el SKU del producto para distinguir candidatos de igual nombre", () => {
    const state = stateWith([
      { name: "CAOSG Jabon Azul 250g", productId: A, reason: "nombre parecido 0,73", score: 0.73, sku: "JAB-01" },
      { name: "CAOSG Jabon Azul 250g", productId: B, reason: "nombre parecido 0,73", score: 0.73 },
    ]);

    const [first, second] = getChoiceChips(state.lines[0]!);
    expect(first?.detail).toBe("SKU JAB-01 · nombre parecido 0,73 · 0,73");
    expect(second?.detail).toBe("nombre parecido 0,73 · 0,73");
  });
});
