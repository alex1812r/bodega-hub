/**
 * REP11-01 · M-p11-1 (D48-a): los textos de aviso de la fila nunca recomiendan una opción
 * concreta («Por unidad» / «Por caja») salvo la que deja el costo coherente con el último
 * (dentro de PRICE_DEVIATION_LIMIT). Si ninguna lo es, o no hay último costo con qué comparar,
 * el texto es neutro («elige cómo viene…»). Tabla que cruza texto × desvío.
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
/** El precio leído deja 1,43 REF/u «Por unidad» y 0,12 REF/u «Por caja» de 12. */
const PRICE_UNIT_COHERENT = LAST * RATE;
/** El precio leído deja 1,43 REF/u «Por caja» de 12 y 17,16 REF/u «Por unidad». */
const PRICE_PACK_COHERENT = LAST * 12 * RATE;
/** 5,00 REF/u «Por unidad» y 0,42 REF/u «Por caja»: ninguna cerca de 1,43. */
const PRICE_NONE_COHERENT = 5 * RATE;
const RECIPE_ISSUE =
  "El empaque es de 12 unidades, pero este producto es componente de una receta de 12 unidades por empaque: confirma las unidades por empaque (la compra solo acepta 12).";

type Case = {
  name: string;
  unitPrice: number;
  match: Partial<InvoiceLineMatch>;
  actions?: InvoiceReviewAction[];
  /** Opción que el texto debe recomendar; `null`: ninguna (neutro o sin aviso). */
  recommends: "Por unidad" | "Por caja" | null;
  /** Si hay aviso de costo en la fila. */
  warns: boolean;
};

/** f05 L4: «PASTA HORIZONTE CORTA ( TODOS) 1KG ( ) [CAJA X 12.0]», chip alias parecido 0,82. */
function doubtfulAlias(entryMode: "unit" | "pack", lastUnitCostRef: number | undefined): Partial<InvoiceLineMatch> {
  return {
    status: "doubtful",
    productId: undefined,
    entryMode,
    unitsPerPack: 12,
    taxRateCode: "exento",
    candidates: [
      {
        productId: PASTA,
        name: "Pasta Horizonte corta 1 Kg",
        score: 0.82,
        reason: "alias parecido 0,82",
        ...(lastUnitCostRef !== undefined ? { lastUnitCostRef } : {}),
      },
    ],
    ...(lastUnitCostRef !== undefined ? { lastUnitCostRef } : {}),
    issues: [],
  };
}

/** Línea por alias aprendido (confirmada), por unidad o por empaque. */
function confirmedAlias(entryMode: "unit" | "pack", unitsPerPack?: number): Partial<InvoiceLineMatch> {
  return {
    status: "confirmed",
    productId: PASTA,
    entryMode,
    ...(unitsPerPack !== undefined ? { unitsPerPack } : {}),
    taxRateCode: "exento",
    lastUnitCostRef: LAST,
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
  {
    name: "f05 Pasta: «Por caja» actual desviado (0,12 vs 1,43), «Por unidad» coherente",
    unitPrice: PRICE_UNIT_COHERENT,
    match: doubtfulAlias("pack", LAST),
    recommends: "Por unidad",
    warns: true,
  },
  {
    name: "«Por caja» actual coherente",
    unitPrice: PRICE_PACK_COHERENT,
    match: doubtfulAlias("pack", LAST),
    recommends: null,
    warns: false,
  },
  {
    name: "«Por unidad» actual desviado, «Por caja» coherente",
    unitPrice: PRICE_PACK_COHERENT,
    match: doubtfulAlias("unit", LAST),
    recommends: "Por caja",
    warns: true,
  },
  {
    name: "«Por unidad» actual coherente",
    unitPrice: PRICE_UNIT_COHERENT,
    match: doubtfulAlias("unit", LAST),
    recommends: null,
    warns: false,
  },
  {
    name: "«Por caja» actual desviado y «Por unidad» también",
    unitPrice: PRICE_NONE_COHERENT,
    match: doubtfulAlias("pack", LAST),
    recommends: null,
    warns: true,
  },
  {
    name: "«Por unidad» actual desviado y «Por caja» también",
    unitPrice: PRICE_NONE_COHERENT,
    match: doubtfulAlias("unit", LAST),
    recommends: null,
    warns: true,
  },
  {
    name: "sin último costo (por caja)",
    unitPrice: PRICE_UNIT_COHERENT,
    match: doubtfulAlias("pack", undefined),
    recommends: null,
    warns: false,
  },
  {
    name: "consulta fallida, por caja, sin elegir la opción",
    unitPrice: PRICE_UNIT_COHERENT,
    match: doubtfulAlias("pack", LAST),
    actions: [searched, searchFailed],
    recommends: null,
    warns: true,
  },
  {
    name: "consulta fallida, por unidad, sin elegir la opción",
    unitPrice: PRICE_UNIT_COHERENT,
    match: doubtfulAlias("unit", LAST),
    actions: [searched, searchFailed],
    recommends: null,
    warns: true,
  },
  {
    name: "consulta fallida con la opción elegida",
    unitPrice: PRICE_UNIT_COHERENT,
    match: doubtfulAlias("pack", LAST),
    actions: [searched, searchFailed, { type: "editEntryMode", index: 0, entryMode: "pack" }],
    recommends: null,
    warns: true,
  },
  {
    name: "«Por caja» desviado elegido a mano: pide confirmar, no recomienda",
    unitPrice: PRICE_UNIT_COHERENT,
    match: doubtfulAlias("unit", LAST),
    actions: [{ type: "editEntryMode", index: 0, entryMode: "pack" }],
    recommends: null,
    warns: true,
  },
  {
    name: "alias por unidad desviado, «Por caja» de 12 coherente",
    unitPrice: PRICE_PACK_COHERENT,
    match: confirmedAlias("unit", 12),
    recommends: "Por caja",
    warns: true,
  },
  {
    name: "alias por unidad desviado sin unidades por empaque: nada que recomendar",
    unitPrice: PRICE_PACK_COHERENT,
    match: confirmedAlias("unit"),
    recommends: null,
    warns: true,
  },
  {
    name: "alias por empaque desviado, «Por unidad» coherente",
    unitPrice: PRICE_UNIT_COHERENT,
    match: confirmedAlias("pack", 12),
    recommends: "Por unidad",
    warns: true,
  },
  {
    name: "receta (aviso de empaque) con costo desviado",
    unitPrice: PRICE_UNIT_COHERENT,
    match: { ...confirmedAlias("pack", 12), disassembleOnReceive: true, issues: [RECIPE_ISSUE] },
    recommends: null,
    warns: false,
  },
  {
    name: "receta (aviso de empaque) con la consulta fallida",
    unitPrice: PRICE_UNIT_COHERENT,
    match: { ...doubtfulAlias("pack", LAST), disassembleOnReceive: true, issues: [RECIPE_ISSUE] },
    actions: [searched, searchFailed],
    recommends: null,
    warns: true,
  },
];

function build(testCase: Case): InvoiceReviewState {
  const line: ReviewFixtureLine = {
    read: {
      rawText: "PASTA HORIZONTE CORTA ( TODOS) 1KG ( ) [CAJA X 12.0]",
      description: "PASTA HORIZONTE CORTA ( TODOS) 1KG ( )",
      unit: "caja",
      quantity: 12,
      unitPrice: testCase.unitPrice,
      lineTotal: testCase.unitPrice * 12,
    },
    match: testCase.match,
  };
  const state = createInvoiceReviewState(makeReviewResponse({ lines: [line] }), {
    systemRateVes: RATE,
    taxRates: REVIEW_TAX_RATES,
  });
  return (testCase.actions ?? []).reduce(reviewReducer, state);
}

const COST_WARNING = /costo/;
/** Una recomendación nombra la opción entre comillas angulares: «Por unidad» / «Por caja». */
const RECOMMENDED_OPTION = /«(Por [a-záéíóúñ]+)»/g;

describe("REP11-01 · D48-a texto × desvío", () => {
  it.each(CASES)("$name", (testCase) => {
    const state = build(testCase);
    const line = state.lines[0];
    const texts = [...lineNeedMessages(state, line), ...getDisplayedLineIssues(state, line).map((issue) => issue.text)];
    const named = texts.flatMap((text) => [...text.matchAll(RECOMMENDED_OPTION)].map((match) => match[1]));

    // Afirmación genérica: si el texto nombra una opción, su costo no se aparta del último.
    for (const option of named) {
      const outcome = getEntryModeOutcome(state, line, option === "Por unidad" ? "unit" : "pack");
      expect({ option, lastUnitCostRef: outcome?.lastUnitCostRef, deviates: outcome?.deviates }).toEqual({
        option,
        lastUnitCostRef: expect.any(Number),
        deviates: false,
      });
      expect(outcome?.unitCost?.currency).toBe("REF");
    }
    expect([...new Set(named)]).toEqual(testCase.recommends === null ? [] : [testCase.recommends]);
    expect(texts.some((text) => COST_WARNING.test(text))).toBe(testCase.warns);
  });

  it("f05 Pasta: el aviso no manda elegir «Por caja» (0,12) y sí «Por unidad» (1,43)", () => {
    const state = build(CASES[0]);
    const messages = lineNeedMessages(state, state.lines[0]).join(" ");
    expect(messages).toContain("El costo sale a 0,12 REF por unidad y el último fue 1,43 REF");
    expect(messages).not.toContain("Por caja");
    expect(messages).toContain("«Por unidad»");
  });

  it("ninguna coherente: texto neutro que nombra las dos sin recomendar", () => {
    const state = build(CASES[4]);
    expect(lineNeedMessages(state, state.lines[0])).toContain(
      "El costo sale a 0,42 REF por unidad y el último fue 1,43 REF (se aparta más del 40 %): elige cómo viene (Por unidad o Por caja), revisa el costo y confírmalo.",
    );
  });

  it("consulta fallida sin elegir: texto neutro", () => {
    const state = build(CASES[7]);
    expect(lineNeedMessages(state, state.lines[0])).toContain(
      "No se pudo consultar el costo previo: elige cómo viene (Por unidad o Por caja), revisa el costo y confírmalo.",
    );
  });
});
