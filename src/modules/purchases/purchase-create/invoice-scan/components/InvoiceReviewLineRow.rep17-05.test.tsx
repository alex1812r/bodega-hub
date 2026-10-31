/**
 * REP17-05 · B-p18Q-1 (QA p18, D69(b)): sin la tasa del día, el sitio reservado de las opciones de cada fila con
 * último costo (REP16-01) quedaba en blanco y sin texto; con la tasa caída, para siempre. La reserva dice qué espera
 * («Esperando la tasa del día…») o, si la consulta falló, qué hacer («Sin tasa del día: escríbela arriba»), sin
 * cambiar su caja: el texto va fuera del flujo y la reserva conserva sus clases.
 */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";

import { makeReviewResponse, productUuid, REVIEW_TAX_RATES, type ReviewFixtureLine } from "../reviewFixtures";
import { createInvoiceReviewState, reviewReducer, type InvoiceReviewState } from "../reviewModel";
import { buildReviewTaxRates } from "./invoiceReviewView";
import { InvoiceReviewLineRow } from "./InvoiceReviewLineRow";

const LINE: ReviewFixtureLine = {
  read: { rawText: "ACETAMINOFEN 500MG 2 1.750,00 3.500,00", description: "Acetaminofen 500mg", quantity: 2, unitPrice: 1750, lineTotal: 3500 },
  match: { status: "unmatched", productId: undefined, candidates: [], entryMode: "unit", taxRateCode: "exento", issues: [] },
};

const PENDING_TEXT = "Esperando la tasa del día…";
const FAILED_TEXT = "Sin tasa del día: escríbela arriba";

/** Sin tasa del día, con el producto elegido y su último costo conocido: la fila reserva las opciones. */
function stateWithoutRate(): InvoiceReviewState {
  const opened = createInvoiceReviewState(makeReviewResponse({ lines: [LINE] }), { taxRates: REVIEW_TAX_RATES });
  const chosen = reviewReducer(opened, {
    type: "chooseProduct",
    index: 0,
    product: { productId: productUuid(1), name: "CAOSG Acetaminofen 500mg" },
  });
  return reviewReducer(chosen, { type: "setLastUnitCost", index: 0, productId: productUuid(1), result: 2 });
}

function renderRow(rateFailed: boolean) {
  const state = stateWithoutRate();
  const noop = () => undefined;
  return render(
    <ul>
      <InvoiceReviewLineRow
        canCreateProduct={false}
        line={state.lines[0]}
        mismatch={false}
        onAcceptByKey={noop}
        onAction={noop}
        onNewProduct={noop}
        onOpenSearch={noop}
        onPickProduct={noop}
        onRowKeyDown={noop}
        ratePending
        rateFailed={rateFailed}
        searchOpen={false}
        state={state}
        taxRates={buildReviewTaxRates(state.taxRates)}
      />
    </ul>,
  );
}

describe("REP17-05 · B-p18Q-1: la reserva de las opciones dice qué espera", () => {
  it("mientras la tasa del día está pendiente: «Esperando la tasa del día…» dentro de la reserva", () => {
    renderRow(false);
    const reserve = screen.getByTestId("invoice-review-options-reserve");
    expect(reserve).toHaveTextContent(PENDING_TEXT);
    expect(reserve).not.toHaveTextContent(FAILED_TEXT);
  });

  it("si la consulta de la tasa falló: «Sin tasa del día: escríbela arriba» dentro de la reserva", () => {
    renderRow(true);
    const reserve = screen.getByTestId("invoice-review-options-reserve");
    expect(reserve).toHaveTextContent(FAILED_TEXT);
    expect(reserve).not.toHaveTextContent(PENDING_TEXT);
  });

  it("el texto no cambia la caja: la reserva conserva sus clases y el texto va fuera del flujo, visible", () => {
    const pending = renderRow(false);
    const pendingClass = screen.getByTestId("invoice-review-options-reserve").className;
    pending.unmount();
    renderRow(true);
    const reserve = screen.getByTestId("invoice-review-options-reserve");
    expect(reserve.className).toBe(pendingClass);
    expect(reserve).toHaveClass("invisible");
    const text = screen.getByText(FAILED_TEXT);
    expect(text).toHaveClass("absolute", "visible");
    // Lo reservado sigue siendo lo que mediría la opción desviada (REP16-01): mismo contenido medido.
    expect(reserve.querySelector('[data-choice="unit"]')).not.toBeNull();
  });
});
