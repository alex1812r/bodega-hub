/**
 * REP11-04 · B-qa11-1 (D48-a): el texto de la cantidad fraccionaria (0,5) «Por unidad» no
 * recomienda «Por <empaque>» sin mirar el costo. Solo se nombra una opción si deja el costo
 * coherente con el último (PRICE_DEVIATION_LIMIT); si no, el texto explica la fracción sin
 * recomendar. Tabla: unidad coherente / empaque coherente / ninguna / sin último / consulta fallida.
 */
import type { InvoiceLineMatch } from "@/modules/invoice-scan/contracts";

import { makeReviewResponse, productUuid, REVIEW_TAX_RATES, type ReviewFixtureLine } from "../reviewFixtures";
import {
  createInvoiceReviewState,
  getEntryModeOutcome,
  reviewReducer,
  type InvoiceReviewAction,
  type InvoiceReviewState,
} from "../reviewModel";
import { getDisplayedLineIssues, lineNeedMessages } from "./invoiceReviewView";

const RATE = 900;
const LAST = 1.43;
const PASTA = productUuid(4);
const BUSCADO = productUuid(500);
/** 1,43 REF/u «Por unidad» y 0,12 REF/u «Por caja» de 12. */
const PRICE_UNIT_COHERENT = LAST * RATE;
/** 1,43 REF/u «Por caja» de 12 y 17,16 REF/u «Por unidad». */
const PRICE_PACK_COHERENT = LAST * 12 * RATE;
/** 5,00 REF/u «Por unidad» y 0,42 REF/u «Por caja». */
const PRICE_NONE_COHERENT = 5 * RATE;

type Case = {
  name: string;
  unitPrice: number;
  lastUnitCostRef: number | undefined;
  actions?: InvoiceReviewAction[];
  recommends: "Por unidad" | "Por caja" | null;
};

function match(lastUnitCostRef: number | undefined): Partial<InvoiceLineMatch> {
  return {
    status: "confirmed",
    productId: PASTA,
    entryMode: "unit",
    unitsPerPack: 12,
    taxRateCode: "exento",
    ...(lastUnitCostRef !== undefined ? { lastUnitCostRef } : {}),
    issues: [],
  };
}

const searched: InvoiceReviewAction = {
  type: "chooseProduct",
  index: 0,
  product: { productId: BUSCADO, name: "Pasta buscada" },
};
const searchFailed: InvoiceReviewAction = { type: "setLastUnitCost", index: 0, productId: BUSCADO, result: "error" };

const CASES: Case[] = [
  { name: "0,5 «Por unidad» coherente (1,43): no nombra «Por caja» (0,12)", unitPrice: PRICE_UNIT_COHERENT, lastUnitCostRef: LAST, recommends: null },
  { name: "0,5 «Por unidad» desviado, «Por caja» coherente", unitPrice: PRICE_PACK_COHERENT, lastUnitCostRef: LAST, recommends: "Por caja" },
  { name: "0,5 ninguna coherente", unitPrice: PRICE_NONE_COHERENT, lastUnitCostRef: LAST, recommends: null },
  { name: "0,5 sin último costo", unitPrice: PRICE_UNIT_COHERENT, lastUnitCostRef: undefined, recommends: null },
  {
    name: "0,5 consulta fallida",
    unitPrice: PRICE_UNIT_COHERENT,
    lastUnitCostRef: LAST,
    actions: [searched, searchFailed],
    recommends: null,
  },
];

function build(testCase: Case): InvoiceReviewState {
  const line: ReviewFixtureLine = {
    read: {
      rawText: "PASTA HORIZONTE CORTA ( TODOS) 1KG ( ) [CAJA X 12.0]",
      description: "PASTA HORIZONTE CORTA ( TODOS) 1KG ( )",
      unit: "caja",
      quantity: 0.5,
      unitPrice: testCase.unitPrice,
      lineTotal: testCase.unitPrice * 0.5,
    },
    match: match(testCase.lastUnitCostRef),
  };
  const state = createInvoiceReviewState(makeReviewResponse({ lines: [line] }), {
    systemRateVes: RATE,
    taxRates: REVIEW_TAX_RATES,
  });
  return (testCase.actions ?? []).reduce(reviewReducer, state);
}

const RECOMMENDED_OPTION = /«(Por [a-záéíóúñ]+)»/g;

describe("REP11-04 · D48-a cantidad fraccionaria × desvío", () => {
  it.each(CASES)("$name", (testCase) => {
    const state = build(testCase);
    const line = state.lines[0];
    expect(line.quantity).toBe(0.5);
    const texts = [...lineNeedMessages(state, line), ...getDisplayedLineIssues(state, line).map((issue) => issue.text)];
    const named = texts.flatMap((text) => [...text.matchAll(RECOMMENDED_OPTION)].map((found) => found[1]));

    for (const option of named) {
      const outcome = getEntryModeOutcome(state, line, option === "Por unidad" ? "unit" : "pack");
      expect({ option, lastUnitCostRef: outcome?.lastUnitCostRef, deviates: outcome?.deviates }).toEqual({
        option,
        lastUnitCostRef: expect.any(Number),
        deviates: false,
      });
    }
    expect([...new Set(named)]).toEqual(testCase.recommends === null ? [] : [testCase.recommends]);
    // La fracción siempre se explica.
    expect(texts.some((text) => text.includes("La cantidad 0,5 no es entera"))).toBe(true);
  });
});
