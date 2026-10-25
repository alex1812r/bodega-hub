/**
 * REP10-02 · B1: el aviso de la consulta fallida se lee natural en sus dos variantes.
 * B-p10-1: el chip del producto de la línea que no está entre los candidatos solo dice
 * «Propuesto por el emparejamiento» si lo propuso él; elegido en el buscador o creado en el
 * alta, lo dice.
 */
import type { InvoiceLineMatch } from "@/modules/invoice-scan/contracts";

import { makeReviewResponse, productUuid, REVIEW_TAX_RATES, type ReviewFixtureLine } from "../reviewFixtures";
import {
  createInvoiceReviewState,
  reviewReducer,
  type InvoiceReviewAction,
  type InvoiceReviewState,
} from "../reviewModel";
import { getChoiceChips, lineNeedMessages } from "./invoiceReviewView";

const HARINA = productUuid(1);
const PROPUESTO = productUuid(9);
const BUSCADO = productUuid(500);
const CREADO = productUuid(600);

/** 4.500 Bs ÷ 900 = 5,00 REF/u; candidato con último 0,50. */
function harina(match: Partial<InvoiceLineMatch> = {}): ReviewFixtureLine {
  return {
    read: {
      rawText: "Harina Maiz 1kg 1 4.500,00 4.500,00",
      description: "Harina Maiz 1kg",
      unit: "unidad",
      quantity: 1,
      unitPrice: 4500,
      lineTotal: 4500,
    },
    match: {
      status: "doubtful",
      productId: undefined,
      taxRateCode: "exento",
      candidates: [{ productId: HARINA, name: "Harina Maiz 1kg", score: 1, reason: "nombre parecido 1,00", lastUnitCostRef: 0.5 }],
      lastUnitCostRef: 0.5,
      issues: [],
      ...match,
    },
  };
}

function run(state: InvoiceReviewState, ...actions: InvoiceReviewAction[]): InvoiceReviewState {
  return actions.reduce(reviewReducer, state);
}

const build = (match: Partial<InvoiceLineMatch> = {}) =>
  createInvoiceReviewState(makeReviewResponse({ lines: [harina(match)] }), { systemRateVes: 900, taxRates: REVIEW_TAX_RATES });

const searched: InvoiceReviewAction = {
  type: "chooseProduct",
  index: 0,
  product: { productId: BUSCADO, name: "Harina buscada" },
};
const searchFailed: InvoiceReviewAction = { type: "setLastUnitCost", index: 0, productId: BUSCADO, result: "error" };

describe("REP10-02 · B1 aviso con la consulta del costo previo fallida", () => {
  it("sin elegir la opción: texto neutro (D48-a), sin coma ni «y» de más", () => {
    const state = run(build(), searched, searchFailed);
    expect(lineNeedMessages(state, state.lines[0])).toContain(
      "No se pudo consultar el costo previo: elige cómo viene (Por unidad o Por bulto), revisa el costo y confírmalo.",
    );
  });

  it("con la opción elegida: pide confirmarlo con su botón", () => {
    const state = run(build(), searched, searchFailed, { type: "editEntryMode", index: 0, entryMode: "unit" });
    expect(lineNeedMessages(state, state.lines[0])).toContain(
      "No se pudo consultar el costo previo: revisa el costo y, si es correcto, confírmalo con «Sí, el costo es…».",
    );
  });
});

describe("REP10-02 · B-p10-1 origen del producto fuera de los candidatos", () => {
  it("el propuesto por el emparejamiento lo dice", () => {
    const state = build({ productId: PROPUESTO });
    expect(getChoiceChips(state.lines[0])[0]).toMatchObject({
      productId: PROPUESTO,
      detail: "Propuesto por el emparejamiento",
    });
  });

  it("elegido en el buscador: no se presenta como propuesto", () => {
    const state = run(build({ productId: PROPUESTO }), searched);
    expect(getChoiceChips(state.lines[0])[0]).toEqual({
      productId: BUSCADO,
      name: "Harina buscada",
      detail: "Elegido por ti (buscador o alta)",
    });
  });

  it("creado en el alta: no se presenta como propuesto", () => {
    const state = run(build(), {
      type: "chooseProduct",
      index: 0,
      product: { productId: CREADO, name: "Harina nueva" },
      created: true,
    });
    expect(getChoiceChips(state.lines[0])[0]).toEqual({
      productId: CREADO,
      name: "Harina nueva",
      detail: "Elegido por ti (buscador o alta)",
    });
  });

  it("volver al propuesto tras el buscador lo presenta otra vez como propuesto", () => {
    const state = run(build({ productId: PROPUESTO }), searched, {
      type: "chooseProduct",
      index: 0,
      product: { productId: PROPUESTO, name: "Producto propuesto" },
    });
    expect(getChoiceChips(state.lines[0])[0]).toMatchObject({
      productId: PROPUESTO,
      detail: "Propuesto por el emparejamiento",
    });
  });
});
