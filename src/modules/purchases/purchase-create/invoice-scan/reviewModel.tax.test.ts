/**
 * REP3-01 (D27, caos p3 C3-M1, N11, N12): tabla de casos de la regla única de IVA y cuadre
 * de totales (`assessInvoiceTax`) vista desde la revisión.
 */
import type { InvoiceExtraction } from "@/modules/invoice-scan/contracts";

import { makeReviewResponse, REVIEW_TAX_RATES, type ReviewFixtureLine } from "./reviewFixtures";
import {
  createInvoiceReviewState,
  getInvoiceReviewBlockers,
  getInvoiceTaxAssessment,
  getInvoiceReviewTotals,
  getTaxInclusion,
  getTotalsDifference,
  type InvoiceReviewContext,
  needsDifferenceConfirmation,
  reviewReducer,
} from "./reviewModel";

const ctx: InvoiceReviewContext = { systemRateVes: 900, taxRates: REVIEW_TAX_RATES };

function line(quantity: number, unitPrice: number, taxRateCode = "general"): ReviewFixtureLine {
  return {
    read: { quantity, unitPrice, lineTotal: Math.round(quantity * unitPrice * 100) / 100 },
    match: { taxRateCode },
  };
}

type Totals = Pick<Partial<InvoiceExtraction>, "subtotal" | "tax" | "total">;

function review(lines: ReviewFixtureLine[], totals: Totals) {
  return createInvoiceReviewState(makeReviewResponse({ lines, extraction: totals }), ctx);
}

type Case = {
  name: string;
  lines: ReviewFixtureLine[];
  totals: Totals;
  suggested: boolean;
  registered: number;
  /** Total de referencia que muestra el pie (leído o subtotal + IVA). */
  read?: number;
  /** Diferencia que exige la casilla; `undefined` = cuadra o no hay referencia. */
  difference?: number;
  /** IVA 0,00 y Σ líneas = total con líneas gravadas: se pregunta (exenta o IVA incluido). */
  ask?: boolean;
};

const cases: Case[] = [
  {
    name: "f18 real: desglose y la línea ya trae el IVA",
    lines: [line(1, 2412.02)],
    totals: { subtotal: 2079.33, tax: 332.69, total: 2412.02 },
    suggested: true,
    registered: 2412.02,
    read: 2412.02,
  },
  {
    name: "C3-M1 sin total: subtotal 90 + IVA 14,4 y línea 104,40",
    lines: [line(1, 104.4)],
    totals: { subtotal: 90, tax: 14.4 },
    suggested: true,
    registered: 104.4,
    read: 104.4,
  },
  {
    name: "sin desglose y Σ líneas = total",
    lines: [line(2, 58)],
    totals: { total: 116 },
    suggested: true,
    registered: 116,
    read: 116,
  },
  {
    name: "precios sin IVA con desglose: Σ líneas = subtotal",
    lines: [line(1, 600)],
    totals: { subtotal: 600, tax: 96, total: 696 },
    suggested: false,
    registered: 696,
    read: 696,
  },
  {
    name: "exenta con IVA 0,00 y líneas exentas",
    lines: [line(2, 100, "exento"), line(1, 300, "exento")],
    totals: { subtotal: 500, tax: 0, total: 500 },
    suggested: false,
    registered: 500,
    read: 500,
  },
  {
    name: "exenta con IVA 0,00 y productos de categoría 16 % (N12): nunca incluido; la diferencia es real",
    lines: [line(2, 100), line(1, 300)],
    totals: { subtotal: 500, tax: 0, total: 500 },
    suggested: false,
    registered: 580,
    read: 500,
    difference: -80,
    ask: true,
  },
  {
    name: "nota de despacho (f01/f02): IVA 0,00 y subtotal = total con líneas gravadas: se pregunta, sin preselección",
    lines: [line(1, 4358.64), line(2, 4163.12)],
    totals: { subtotal: 12684.88, tax: 0, total: 12684.88 },
    suggested: false,
    registered: 14714.46,
    read: 12684.88,
    difference: -2029.58,
    ask: true,
  },
  {
    name: "mixta con parte gravada 5 % y desglose (N11)",
    lines: [line(1, 950, "exento"), line(1, 50)],
    totals: { subtotal: 993.1, tax: 6.9, total: 1000 },
    suggested: true,
    registered: 1000,
    read: 1000,
  },
  {
    name: "mixta grande con parte gravada 6 % y desglose (N11, S1c)",
    lines: [line(1, 90000, "exento"), line(1, 6000)],
    totals: { subtotal: 95172.41, tax: 827.59, total: 96000 },
    suggested: true,
    registered: 96000,
    read: 96000,
  },
  {
    name: "mixta con parte gravada 5 % sin desglose",
    lines: [line(1, 950, "exento"), line(1, 50)],
    totals: { total: 1000 },
    suggested: true,
    registered: 1000,
    read: 1000,
  },
  {
    name: "mixta con parte gravada 5 % y precios sin IVA",
    lines: [line(1, 950, "exento"), line(1, 50)],
    totals: { subtotal: 1000, tax: 8, total: 1008 },
    suggested: false,
    registered: 1008,
    read: 1008,
  },
  {
    name: "descuento global sin campo propio: no se adivina, se pide confirmar la diferencia",
    lines: [line(1, 600), line(1, 400)],
    totals: { subtotal: 900, tax: 144, total: 1044 },
    suggested: false,
    registered: 1160,
    read: 1044,
    difference: -116,
  },
  {
    name: "redondeo +0,02 con IVA incluido",
    lines: [line(1, 2412)],
    totals: { subtotal: 2079.33, tax: 332.69, total: 2412.02 },
    suggested: true,
    registered: 2412,
    read: 2412.02,
  },
  {
    name: "redondeo −0,02 sin IVA",
    lines: [line(1, 600.02)],
    totals: { subtotal: 600, tax: 96, total: 696 },
    suggested: false,
    registered: 696.02,
    read: 696,
  },
  {
    name: "redondeo por línea: 7 × 3,33 con IVA incluido",
    lines: Array.from({ length: 7 }, () => line(1, 3.33)),
    totals: { subtotal: 20.09, tax: 3.22, total: 23.31 },
    suggested: true,
    registered: 23.31,
    read: 23.31,
  },
  {
    name: "C4-M1 B02: solo subtotal 1000 y línea 1160: la base incluida cuadra el subtotal, se sugiere incluido",
    lines: [line(1, 1160)],
    totals: { subtotal: 1000 },
    suggested: true,
    registered: 1160,
    read: 1000,
  },
  {
    name: "C4-M1 B03: solo subtotal 1000 y línea 1000 sin IVA: cuadra la base",
    lines: [line(1, 1000)],
    totals: { subtotal: 1000 },
    suggested: false,
    registered: 1160,
    read: 1000,
  },
  {
    name: "C4-M1 u7: solo subtotal 90 y línea 1 × 104,40 al 16 %: incluido cuadra la base 90",
    lines: [line(1, 104.4)],
    totals: { subtotal: 90 },
    suggested: true,
    registered: 104.4,
    read: 90,
  },
  {
    name: "C4-M1: solo subtotal que no cuadra con ninguna hipótesis: casilla frente a la base",
    lines: [line(1, 1300)],
    totals: { subtotal: 1000 },
    suggested: false,
    registered: 1508,
    read: 1000,
    difference: -300,
  },
  {
    name: "C4-M1 B04: solo IVA 160 y línea 1160: el IVA incluido cuadra el leído, se sugiere incluido",
    lines: [line(1, 1160)],
    totals: { tax: 160 },
    suggested: true,
    registered: 1160,
    read: 160,
  },
  {
    name: "C4-M1 B05: solo IVA 160 y línea 1000 sin IVA: cuadra el IVA",
    lines: [line(1, 1000)],
    totals: { tax: 160 },
    suggested: false,
    registered: 1160,
    read: 160,
  },
  {
    name: "C4-M1 u8: solo IVA 14,4 y línea 1 × 104,40 al 16 %: incluido cuadra el IVA 14,40",
    lines: [line(1, 104.4)],
    totals: { tax: 14.4 },
    suggested: true,
    registered: 104.4,
    read: 14.4,
  },
  {
    name: "C4-M1 B09e: solo IVA 0,00 con productos de categoría 16 %: nunca incluido (D28), casilla frente al IVA",
    lines: [line(2, 100), line(1, 300)],
    totals: { tax: 0 },
    suggested: false,
    registered: 580,
    read: 0,
    difference: -80,
  },
  {
    name: "C4-M1: solo IVA 0,00 con líneas exentas: cuadra",
    lines: [line(2, 100, "exento"), line(1, 300, "exento")],
    totals: { tax: 0 },
    suggested: false,
    registered: 500,
    read: 0,
  },
  {
    name: "sin nada leído: sin referencia, sin casilla",
    lines: [line(1, 100)],
    totals: {},
    suggested: false,
    registered: 116,
  },
];

describe("REP3-01 · IVA incluido y cuadre de totales (tabla de casos)", () => {
  it.each(cases)("$name", ({ lines, totals, suggested, registered, read, difference, ask = false }) => {
    const state = review(lines, totals);
    const reviewTotals = getInvoiceReviewTotals(state);

    expect(getTaxInclusion(state)).toEqual({ suggested, included: suggested });
    expect(reviewTotals.registered).toBe(registered);
    expect(reviewTotals.read).toBe(read);
    expect(reviewTotals.mismatch).toBe(difference !== undefined);
    expect(getTotalsDifference(state)).toBe(difference);
    expect(needsDifferenceConfirmation(state)).toBe(difference !== undefined);
    expect(getInvoiceTaxAssessment(state).exemptOrIncluded).toBe(ask);
  });
});

describe("REP3-01 · la casilla aparece con cualquier total de referencia que no cuadre", () => {
  it("C3-M1: sin total leído y forzando «sin IVA», 121,10 frente a 104,40 exige confirmar", () => {
    let state = review([line(1, 104.4)], { subtotal: 90, tax: 14.4 });
    state = reviewReducer(state, { type: "setPricesIncludeTax", included: false });

    expect(getInvoiceReviewTotals(state)).toMatchObject({ registered: 121.1, read: 104.4, mismatch: true });
    expect(getTotalsDifference(state)).toBe(-16.7);
    expect(needsDifferenceConfirmation(state)).toBe(true);

    state = reviewReducer(state, { type: "confirmTotalsDifference", confirmed: true });
    expect(needsDifferenceConfirmation(state)).toBe(false);
  });

  it("N11: mixta con parte gravada 5 % forzando «sin IVA», 8 Bs de más no se esconden en el 1 %", () => {
    let state = review([line(1, 950, "exento"), line(1, 50)], { subtotal: 993.1, tax: 6.9, total: 1000 });
    state = reviewReducer(state, { type: "setPricesIncludeTax", included: false });

    expect(getInvoiceReviewTotals(state)).toMatchObject({ registered: 1008, mismatch: true });
    expect(getTotalsDifference(state)).toBe(-8);
  });

  it("el total de referencia dice de dónde sale (total leído o subtotal + IVA)", () => {
    expect(getInvoiceReviewTotals(review([line(1, 104.4)], { subtotal: 90, tax: 14.4 })).readSource).toBe(
      "subtotalPlusTax",
    );
    expect(getInvoiceReviewTotals(review([line(1, 116)], { total: 116 })).readSource).toBe("total");
    expect(getInvoiceReviewTotals(review([line(1, 116)], { tax: 16 })).readSource).toBe("tax");
    expect(getInvoiceReviewTotals(review([line(1, 116)], { subtotal: 100 })).readSource).toBe("subtotal");
    expect(getInvoiceReviewTotals(review([line(1, 116)], {})).readSource).toBeUndefined();
  });

  it("C4-M1 u7: solo subtotal y forzando «sin IVA», la base 104,40 frente al subtotal 90 exige confirmar", () => {
    let state = review([line(1, 104.4)], { subtotal: 90 });
    state = reviewReducer(state, { type: "setPricesIncludeTax", included: false });

    expect(getInvoiceReviewTotals(state)).toMatchObject({ base: 104.4, registered: 121.1, read: 90, mismatch: true });
    expect(getTotalsDifference(state)).toBe(-14.4);
    expect(needsDifferenceConfirmation(state)).toBe(true);
    expect(getInvoiceReviewBlockers(state)).toContain(
      "La base a registrar no cuadra con el subtotal leído: corrige las líneas o confirma la diferencia.",
    );

    state = reviewReducer(state, { type: "confirmTotalsDifference", confirmed: true });
    expect(needsDifferenceConfirmation(state)).toBe(false);
  });

  it("C4-M1 u8: solo IVA y forzando «sin IVA», el IVA 16,70 frente al leído 14,40 exige confirmar", () => {
    let state = review([line(1, 104.4)], { tax: 14.4 });
    state = reviewReducer(state, { type: "setPricesIncludeTax", included: false });

    expect(getInvoiceReviewTotals(state)).toMatchObject({ tax: 16.7, registered: 121.1, read: 14.4, mismatch: true });
    expect(getTotalsDifference(state)).toBe(-2.3);
    expect(needsDifferenceConfirmation(state)).toBe(true);
    expect(getInvoiceReviewBlockers(state)).toContain(
      "El IVA a registrar no cuadra con el IVA leído: corrige las líneas o confirma la diferencia.",
    );
  });

  it("C4-M1 B18d: factura en dólares con solo subtotal 10 y línea 11,60: se sugiere incluido y registra 11,60", () => {
    const state = createInvoiceReviewState(
      makeReviewResponse({ lines: [line(1, 11.6)], extraction: { currency: "USD", subtotal: 10 } }),
      ctx,
    );

    expect(getTaxInclusion(state)).toEqual({ suggested: true, included: true });
    expect(getInvoiceReviewTotals(state)).toMatchObject({ base: 10, registered: 11.6, read: 10, mismatch: false });
    expect(needsDifferenceConfirmation(state)).toBe(false);
  });
});
