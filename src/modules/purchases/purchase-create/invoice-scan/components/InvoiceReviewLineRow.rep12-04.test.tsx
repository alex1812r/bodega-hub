/**
 * REP12-04 · B-p12-1 (QA p12, f19): una línea «Sin producto» con un candidato marcado (el que
 * aceptaría Enter) no decía qué faltaba y el chip salía pulsado (`aria-pressed=true`) sin producto
 * enlazado. La fila dice que falta elegir el producto y el chip solo sale pulsado cuando es el
 * producto de la línea.
 */
import "@testing-library/jest-dom";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useReducer } from "react";

import { makeReviewResponse, productUuid, REVIEW_TAX_RATES, type ReviewFixtureLine } from "../reviewFixtures";
import { createInvoiceReviewState, reviewReducer, type InvoiceReviewState } from "../reviewModel";
import { buildReviewTaxRates } from "./invoiceReviewView";
import { InvoiceReviewLineRow } from "./InvoiceReviewLineRow";

const LINE: ReviewFixtureLine = {
  read: { rawText: "ACETAMINOFEN 500MG 1 1.750,00 1.750,00", description: "Acetaminofen 500mg", quantity: 1, unitPrice: 1750, lineTotal: 1750 },
  match: {
    status: "doubtful",
    productId: undefined,
    candidates: [
      { productId: productUuid(1), name: "CAOSG Acetaminofen 500mg", reason: "nombre parecido", score: 0.71 },
      { productId: productUuid(2), name: "CAOSG Acetaminofen 650mg", reason: "nombre parecido", score: 0.52 },
    ],
    entryMode: "unit",
    taxRateCode: "exento",
    issues: [],
  },
};

function initialState(): InvoiceReviewState {
  return createInvoiceReviewState(makeReviewResponse({ lines: [LINE] }), { systemRateVes: 900, taxRates: REVIEW_TAX_RATES });
}

function Harness() {
  const [state, dispatch] = useReducer(reviewReducer, undefined, initialState);
  const noop = () => undefined;
  return (
    <ul>
      <InvoiceReviewLineRow
        canCreateProduct={false}
        line={state.lines[0]}
        mismatch={false}
        onAcceptByKey={dispatch}
        onAction={dispatch}
        onNewProduct={noop}
        onOpenSearch={noop}
        onPickProduct={noop}
        onRowKeyDown={noop}
        searchOpen={false}
        state={state}
        taxRates={buildReviewTaxRates(state.taxRates)}
      />
    </ul>
  );
}

function chips() {
  return within(screen.getByRole("group", { name: "Candidatos" })).getAllByRole("button");
}

describe("REP12-04 · B-p12-1: «Sin producto» con candidato marcado", () => {
  it("dice qué falta y ningún chip sale pulsado sin producto enlazado", () => {
    render(<Harness />);
    expect(screen.getByText("Sin producto")).toBeInTheDocument();
    expect(chips().map((chip) => chip.getAttribute("aria-pressed"))).toEqual(["false", "false"]);
    expect(screen.getByRole("group", { name: /Línea 1/ })).toHaveTextContent(
      "Falta elegir el producto: toca «CAOSG Acetaminofen 500mg» o pulsa Enter para confirmarlo.",
    );
  });

  it("al tocar el candidato queda pulsado y el aviso de producto se va", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(chips()[0]);
    expect(chips().map((chip) => chip.getAttribute("aria-pressed"))).toEqual(["true", "false"]);
    expect(screen.getByRole("group", { name: /Línea 1/ })).not.toHaveTextContent("Falta elegir el producto");
  });
});
