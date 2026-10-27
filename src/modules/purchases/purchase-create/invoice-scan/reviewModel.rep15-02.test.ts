/**
 * REP15-02 · fecha leída y aviso de duplicado en la revisión.
 * - B-p16B-1 (caos p16 B): una fecha leída DD/MM/AAAA o DD-MM-AAAA se normaliza a AAAA-MM-DD al
 *   abrir la revisión; si no, el `<input type=date>` la muestra vacía y no hay forma de comprobarla.
 * - B-p16B-3: con una fecha leída imposible, el motivo junto al campo se da en DD/MM/AAAA.
 * - B-p16Q-1 (QA p16): el criterio del aviso de duplicado sale de los valores EFECTIVOS de la
 *   cabecera (número tecleado, fecha de la cabecera), no de lo leído. `duplicateCriterionLabel`
 *   recibe los efectivos; el aviso (InvoiceReviewHeader) debe pasarle `state.header`.
 */
import { duplicateCriterionLabel } from "./components/invoiceReviewView";
import { makeReviewResponse, REVIEW_TAX_RATES } from "./reviewFixtures";
import {
  createInvoiceReviewState,
  getHeaderDateMessage,
  needsNoDateConfirmation,
  reviewReducer,
  type InvoiceReviewState,
} from "./reviewModel";

function stateWith(extraction: Parameters<typeof makeReviewResponse>[0]["extraction"]): InvoiceReviewState {
  return createInvoiceReviewState(makeReviewResponse({ lines: [{}], extraction }), {
    systemRateVes: 900,
    taxRates: REVIEW_TAX_RATES,
  });
}

describe("fecha leída · REP15-02 (B-p16B-1)", () => {
  it.each([
    ["17/10/2026", "2026-10-17"],
    ["7-10-2026", "2026-10-07"],
    ["17/10/2026\u00a0", "2026-10-17"],
    ["2026-10-17", "2026-10-17"],
  ])("leída %j: el campo trae %s, sin motivo ni confirmación", (read, iso) => {
    const state = stateWith({ date: read });

    expect(state.header.date).toBe(iso);
    expect(getHeaderDateMessage(state)).toBeUndefined();
    expect(needsNoDateConfirmation(state)).toBe(false);
  });
});

describe("fecha leída imposible · REP15-02 (B-p16B-3)", () => {
  it.each(["2026-02-31", "31/02/2026"])("leída %s: el motivo pide DD/MM/AAAA", (read) => {
    const message = getHeaderDateMessage(stateWith({ date: read }));

    expect(message).toMatch(/no existe/);
    expect(message).toContain("DD/MM/AAAA");
    expect(message).not.toContain("AAAA-MM-DD");
  });
});

describe("duplicateCriterionLabel · REP15-02 (B-p16Q-1)", () => {
  it("número tecleado sin número leído: el criterio es el número", () => {
    const state = reviewReducer(stateWith({ number: undefined, date: "09/10/2026" }), {
      type: "editHeader",
      number: "00001028",
    });

    expect(duplicateCriterionLabel(state.header)).toBe("mismo proveedor y número igual o casi igual");
  });

  it("número leído borrado en la cabecera: el criterio es fecha y total", () => {
    const state = reviewReducer(stateWith({ number: "000123", date: "2026-10-14" }), { type: "editHeader", number: "" });

    expect(duplicateCriterionLabel(state.header)).toBe("mismo proveedor, fecha y total");
  });

  it("sin número y fecha leída borrada: el criterio es el total", () => {
    const state = reviewReducer(stateWith({ number: undefined, date: "2026-10-14" }), { type: "editHeader", date: "" });

    expect(duplicateCriterionLabel(state.header)).toBe("mismo proveedor y total");
  });

  it("sin número y fecha tecleada sin fecha leída: el criterio es fecha y total", () => {
    const state = reviewReducer(stateWith({ number: undefined, date: undefined }), {
      type: "editHeader",
      date: "2026-10-14",
    });

    expect(duplicateCriterionLabel(state.header)).toBe("mismo proveedor, fecha y total");
  });
});
