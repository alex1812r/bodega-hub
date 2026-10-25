/**
 * REP12-03 · C12B-M2 (D54-b), en la fila: con `t-unitdev.json` (leída «unidad», propuesta «Por bulto»
 * de 6), elegir «Por unidad» deja «Por bulto» visible y habilitada; elegirla de nuevo la marca y
 * restaura 1 bulto = 6 u a 0,05 REF/u sin aviso de desvío.
 */
import "@testing-library/jest-dom";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useReducer } from "react";

import { makeReviewResponse, productUuid, REVIEW_TAX_RATES, type ReviewFixtureLine } from "../reviewFixtures";
import { createInvoiceReviewState, reviewReducer, type InvoiceReviewState } from "../reviewModel";
import { buildReviewTaxRates } from "./invoiceReviewView";
import { InvoiceReviewLineRow } from "./InvoiceReviewLineRow";

const GALLETA = productUuid(2);

const LINE: ReviewFixtureLine = {
  read: {
    rawText: "GALLETA MARIA 200G X6 1 270,00 270,00",
    description: "CAOSG Galleta Maria 200g X6",
    unit: "unidad",
    unitsPerPack: 6,
    quantity: 1,
    unitPrice: 270,
    lineTotal: 270,
  },
  match: {
    status: "confirmed",
    productId: GALLETA,
    candidates: [{ productId: GALLETA, name: "CAOSG Galleta Maria 200g", reason: "nombre", score: 0.95 }],
    entryMode: "pack",
    unitsPerPack: 6,
    taxRateCode: "exento",
    lastUnitCostRef: 0.05,
    issues: [],
  },
};

function initialState(): InvoiceReviewState {
  return createInvoiceReviewState(makeReviewResponse({ lines: [LINE] }), {
    systemRateVes: 900,
    taxRates: REVIEW_TAX_RATES,
  });
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

function options() {
  return within(screen.getByRole("group", { name: "Cómo se compra" }));
}

describe("REP12-03 · C12B-M2 en la fila", () => {
  it("elegir «Por unidad» no retira «Por bulto» y volver a ella la restaura", async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness />);
    expect(container.querySelectorAll('[data-choice="pack"]')).toHaveLength(1);

    await user.click(options().getByRole("button", { name: /Por unidad/ }));
    expect(options().getByRole("button", { name: /Por unidad/ })).toHaveAttribute("aria-pressed", "true");
    const pack = options().getByRole("button", { name: /Por bulto/ });
    expect(pack).toBeEnabled();
    expect(pack).toHaveAttribute("aria-pressed", "false");

    await user.click(pack);
    const packAgain = options().getByRole("button", { name: /Por bulto/ });
    expect(packAgain).toHaveAttribute("aria-pressed", "true");
    expect(packAgain).not.toHaveAttribute("data-deviates");
    expect(packAgain).toHaveTextContent(/6 u/);
    expect(packAgain).toHaveTextContent(/0,05 REF/);
    expect(container.querySelector("[data-cost-ack]")).toBeNull();
  });
});
