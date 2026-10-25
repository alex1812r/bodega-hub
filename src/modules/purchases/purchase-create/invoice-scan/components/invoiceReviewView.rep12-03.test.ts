/**
 * REP12-03 · C12B-M2 (D54-b): las opciones de modo de una línea no dependen de la opción elegida.
 * Caso `t-unitdev.json`: leída «unidad» con `unitsPerPack: 6`, el servidor la propone «Por bulto»
 * (1 bulto = 6 u · 0,05 REF/u, coherente). Elegir «Por unidad» (0,30 REF/u, desviada) no retira
 * «Por bulto»: sigue ofrecida hasta descartar la línea y, al volver a elegirla, aplica 6 u a 0,05.
 * Los textos (D48-a) no recomiendan la opción desviada ni una opción que no se ofrece.
 */
import type { InvoiceLineMatch } from "@/modules/invoice-scan/contracts";

import { makeReviewResponse, productUuid, REVIEW_TAX_RATES, type ReviewFixtureLine } from "../reviewFixtures";
import {
  createInvoiceReviewState,
  getEntryModeOutcome,
  lineOffersPack,
  reviewReducer,
  type InvoiceReviewAction,
  type InvoiceReviewState,
} from "../reviewModel";
import { lineNeedMessages } from "./invoiceReviewView";

const RATE = 900;
const GALLETA = productUuid(2);

function unitDevLine(match: Partial<InvoiceLineMatch>): ReviewFixtureLine {
  return {
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
      ...match,
    },
  };
}

function build(match: Partial<InvoiceLineMatch> = {}, actions: InvoiceReviewAction[] = []): InvoiceReviewState {
  const state = createInvoiceReviewState(makeReviewResponse({ lines: [unitDevLine(match)] }), {
    systemRateVes: RATE,
    taxRates: REVIEW_TAX_RATES,
  });
  return actions.reduce(reviewReducer, state);
}

const toUnit: InvoiceReviewAction = { type: "editEntryMode", index: 0, entryMode: "unit" };
const toPack: InvoiceReviewAction = { type: "editEntryMode", index: 0, entryMode: "pack" };

describe("REP12-03 · C12B-M2: «Por bulto» no desaparece al elegir «Por unidad»", () => {
  it("propuesta por bulto: se ofrece «Por bulto»", () => {
    const state = build();
    expect(lineOffersPack(state, state.lines[0])).toBe(true);
  });

  it("tras elegir «Por unidad» (desviada) «Por bulto» sigue ofrecida", () => {
    const state = build({}, [toUnit]);
    expect(state.lines[0].entryMode).toBe("unit");
    expect(getEntryModeOutcome(state, state.lines[0], "unit")?.deviates).toBe(true);
    expect(lineOffersPack(state, state.lines[0])).toBe(true);
  });

  it("volver a «Por bulto» aplica 1 bulto = 6 u a 0,05 REF/u, coherente", () => {
    const state = build({}, [toUnit, toPack]);
    const line = state.lines[0];
    expect(line.entryMode).toBe("pack");
    expect(line.quantity).toBe(1);
    expect(line.unitsPerPack).toBe(6);
    const outcome = getEntryModeOutcome(state, line, "pack");
    expect(outcome?.deviates).toBe(false);
    expect(outcome?.unitCost).toEqual({ currency: "REF", amount: 0.05 });
    expect(outcome?.units).toBe(6);
  });

  it("sigue ofrecida tras «Cambiar producto» al mismo, descartar y restaurar", () => {
    const state = build({}, [
      toUnit,
      { type: "chooseProduct", index: 0, product: { productId: GALLETA, name: "CAOSG Galleta Maria 200g" } },
      { type: "discardLine", index: 0 },
      { type: "restoreLine", index: 0 },
    ]);
    expect(state.lines[0].entryMode).toBe("unit");
    expect(lineOffersPack(state, state.lines[0])).toBe(true);
  });

  it("control: leída «unidad» y propuesta por unidad sin aviso no se inventa «Por bulto»", () => {
    const state = build({ entryMode: "unit", unitsPerPack: undefined, lastUnitCostRef: 0.3 });
    expect(lineOffersPack(state, state.lines[0])).toBe(false);
  });

  it("D48-a: el texto tras elegir la desviada no recomienda «Por unidad»", () => {
    const state = build({}, [toUnit]);
    const texts = lineNeedMessages(state, state.lines[0]).join(" ");
    expect(texts).not.toMatch(/«Por unidad»/);
  });

  it("D48-a: sin «Por bulto» ofrecida, el texto no la recomienda", () => {
    // Propuesta por unidad, desviada, sin aviso explícito: solo se ofrece «Por unidad».
    const state = build({ entryMode: "unit", unitsPerPack: 6, lastUnitCostRef: 0.05 });
    expect(lineOffersPack(state, state.lines[0])).toBe(false);
    const texts = lineNeedMessages(state, state.lines[0]).join(" ");
    expect(texts).not.toMatch(/«Por bulto»/);
  });
});
