/**
 * SCN-UI-Q1 · Revisión con respuestas REALES de Gemini (qa-final, anonimizadas en
 * `__fixtures__`): f01 y f02 son facturas sin desglose de IVA ("SIN DERECHO A CRÉDITO
 * FISCAL") cuyo Σ cantidad × precio ya es el total; f04 trae media caja (0,50) y una
 * "tasa" impresa 86,75 que en realidad es el total REF.
 */
import { draftToPurchaseItemInput, sumDraftPurchaseTotals } from "@bodega/core/purchases";

import type { InvoiceScanResponse } from "@/modules/invoice-scan/contracts";
import { DECIMAL_QUANTITY_ISSUE } from "@/modules/invoice-scan/server/match/money";
import { purchaseItemInputSchema } from "@/modules/purchases/schemas/purchaseItem.schema";
import { roundMoney } from "@/shared/utils/currency";

import f01 from "./__fixtures__/scan-f01.json";
import f02 from "./__fixtures__/scan-f02.json";
import f04 from "./__fixtures__/scan-f04.json";
import { buildInvoiceScanSubmission, type LoadedInvoiceScan } from "./loadedInvoiceScan";
import { buildInvoiceReviewDraft } from "./reviewDraft";
import {
  createInvoiceReviewState,
  getInvoiceReviewTotals,
  getLineBasePrice,
  getLineIssues,
  getLineNeeds,
  getRateOptions,
  getTaxInclusion,
  getUnitConversion,
  reviewReducer,
  type InvoiceReviewContext,
  type InvoiceReviewState,
} from "./reviewModel";

const TAX_RATES = { exento: 0, general: 16, reducida: 8 };
const SYSTEM_RATE = 880.1159;
const ctx: InvoiceReviewContext = { systemRateVes: SYSTEM_RATE, taxRates: TAX_RATES };

function response(fixture: unknown): InvoiceScanResponse {
  return fixture as InvoiceScanResponse;
}

/** Acepta el producto propuesto (o el primer candidato) de cada línea, como en qa-final. */
function acceptAll(state: InvoiceReviewState): InvoiceReviewState {
  return state.lines.reduce((next, line) => reviewReducer(next, { type: "acceptMarked", index: line.index }), state);
}

function registeredTotalVes(state: InvoiceReviewState): number {
  const draft = buildInvoiceReviewDraft(state);
  if (!draft) {
    throw new Error("La revisión no se puede cargar");
  }
  const totals = sumDraftPurchaseTotals(
    draft.lines.map((line) => line.item),
    draft.rateVes,
  );
  // Lo mismo que suma el formulario de compra (`page.tsx`, sin descuento).
  return roundMoney(totals.subtotalVes + totals.taxVes);
}

describe.each([
  ["f01", f01, 40516.32, 46998.93],
  ["f02", f02, 33150.15, 38454.17],
])("ALTO-1 · %s sin desglose de IVA", (_name, fixture, readTotal, inflatedTotal) => {
  it("la compra registra el total leído y el pie muestra ese mismo total", () => {
    const state = acceptAll(createInvoiceReviewState(response(fixture), ctx));
    const totals = getInvoiceReviewTotals(state);

    expect(getTaxInclusion(state)).toEqual({ suggested: true, included: true });
    expect(registeredTotalVes(state)).toBe(readTotal);
    // El pie enseña lo que se va a registrar, no "el calculado más cercano".
    expect(totals.registered).toBe(registeredTotalVes(state));
    expect(totals.mismatch).toBe(false);
  });

  it("«Los precios no incluyen IVA» es visible y reversible: suma el IVA y el pie lo marca", () => {
    let state = acceptAll(createInvoiceReviewState(response(fixture), ctx));
    state = reviewReducer(state, { type: "setPricesIncludeTax", included: false });

    expect(getTaxInclusion(state)).toEqual({ suggested: true, included: false });
    expect(registeredTotalVes(state)).toBe(inflatedTotal);
    expect(getInvoiceReviewTotals(state)).toMatchObject({ registered: inflatedTotal, mismatch: true });

    state = reviewReducer(state, { type: "setPricesIncludeTax", included: true });
    expect(registeredTotalVes(state)).toBe(readTotal);
  });

  it("D10: la extracción corregida conserva los precios leídos (con IVA), no la base convertida", () => {
    const state = acceptAll(createInvoiceReviewState(response(fixture), ctx));
    const draft = buildInvoiceReviewDraft(state);
    const read = response(fixture).extraction.lines;

    expect(draft?.body.invoiceScanExtraction.lines.map((line) => line.unitPrice)).toEqual(
      read.map((line) => line.unitPrice),
    );
    // Lo que de verdad viaja con la compra se rehace desde el formulario: tampoco convierte.
    if (!draft) {
      throw new Error("sin borrador");
    }
    const loaded: LoadedInvoiceScan = {
      extraction: draft.body.invoiceScanExtraction,
      invoiceRateVes: draft.invoiceRateVes,
      lineIndexByItemId: Object.fromEntries(draft.lines.map((line) => [line.item.id, line.lineIndex])),
      ...(draft.pricesIncludeTax ? { pricesIncludeTax: true as const } : {}),
      scanId: draft.body.invoiceScanId,
    };
    const submitted = buildInvoiceScanSubmission(
      loaded,
      draft.lines.map((line) => ({ item: line.item, tax: { code: line.taxRateCode } })),
      { costCurrency: draft.costCurrency, taxRates: TAX_RATES },
    );
    expect(submitted.invoiceScanExtraction.lines.map((line) => line.unitPrice)).toEqual(
      read.map((line) => line.unitPrice),
    );
    // La base va a la compra: precio ÷ 1,16 por línea.
    const first = draft?.lines[0].item;
    expect(first?.entryMode === "pack" ? first.packCostVes : first?.unitCostVes).toBe(
      Math.round((read[0].unitPrice / 1.16) * 100) / 100,
    );
  });
});

describe("BAJO-N1 (CIE-03a) · f02: el residuo de quitar el IVA línea a línea", () => {
  // Dos bultos a 4.163,12 y 4.032,77: la base por bulto redondeada × 2 se pasa un céntimo cada una.
  it("se reparte en las bases y la compra registra 33.150,15, no 33.150,17", () => {
    const state = acceptAll(createInvoiceReviewState(response(f02), ctx));
    const plain = state.lines.map((line) => roundMoney(line.unitPrice / 1.16));
    const bases = state.lines.map((line) => getLineBasePrice(state, line));

    expect(getInvoiceReviewTotals(state)).toMatchObject({ registered: 33150.15, mismatch: false });
    expect(registeredTotalVes(state)).toBe(33150.15);
    // Un céntimo menos en la base del último bulto doble (2 × 3.476,52) absorbe los 0,02.
    expect(bases.map((base, index) => roundMoney(base - plain[index]))).toEqual([0, 0, 0, 0, -0.01]);
  });

  it("descartar una línea vuelve a cuadrar con lo que queda", () => {
    let state = acceptAll(createInvoiceReviewState(response(f02), ctx));
    state = reviewReducer(state, { type: "discardLine", index: 2 });

    expect(getInvoiceReviewTotals(state).registered).toBe(roundMoney(33150.15 - 7226.39));
    expect(registeredTotalVes(state)).toBe(roundMoney(33150.15 - 7226.39));
  });
});

describe("ALTO-1 · f04 con IVA desglosado", () => {
  it("no sugiere precios con IVA y el pie da el total con IVA leído", () => {
    let state = createInvoiceReviewState(response(f04), ctx);
    expect(getTaxInclusion(state)).toEqual({ suggested: false, included: false });
    state = reviewReducer(state, { type: "editUnitPrice", index: 1, unitPrice: 41474.6 });
    expect(Math.abs(getInvoiceReviewTotals(state).registered - 75883.7)).toBeLessThanOrEqual(0.1);
  });
});

describe("MEDIO-3 · f04 media caja (0,50)", () => {
  it("sin empaque ni unidades no hay conversión y se explica qué hacer", () => {
    const state = createInvoiceReviewState(response(f04), ctx);
    const mayonesa = state.lines[0];

    expect(getLineNeeds(mayonesa)).toContain("quantity");
    expect(getUnitConversion(mayonesa)).toEqual({
      ok: false,
      reason: expect.stringMatching(/Por caja|empaque/),
    });
  });

  it("en modo empaque con unidades conocidas carga como N unidades al costo por unidad", () => {
    let state = createInvoiceReviewState(response(f04), ctx);
    state = reviewReducer(state, { type: "acceptMarked", index: 0 });
    state = reviewReducer(state, { type: "editEntryMode", index: 0, entryMode: "pack" });
    state = reviewReducer(state, { type: "editUnitsPerPack", index: 0, unitsPerPack: 12 });

    expect(getUnitConversion(state.lines[0])).toEqual({ ok: true, units: 6, unitPrice: 3389.62 });
    state = reviewReducer(state, { type: "convertPackToUnits", index: 0 });

    expect(state.lines[0]).toMatchObject({ entryMode: "unit", quantity: 6, unitPrice: 3389.62, status: "resolved" });
    expect(getLineNeeds(state.lines[0])).toEqual([]);
  });

  it("BAJO-N2 (CIE-03a): convertida a unidades, ya no avisa de la cantidad con decimales", () => {
    let state = createInvoiceReviewState(response(f04), ctx);
    expect(getLineIssues(state.lines[0])).toEqual([DECIMAL_QUANTITY_ISSUE]);

    state = reviewReducer(state, { type: "acceptMarked", index: 0 });
    state = reviewReducer(state, { type: "editEntryMode", index: 0, entryMode: "pack" });
    state = reviewReducer(state, { type: "editUnitsPerPack", index: 0, unitsPerPack: 12 });
    state = reviewReducer(state, { type: "convertPackToUnits", index: 0 });

    expect(getLineIssues(state.lines[0])).toEqual([]);
    // Los demás avisos del servidor siguen; corregida a mano a entero, también se va.
    state = reviewReducer(state, { type: "editQuantity", index: 1, quantity: 1 });
    expect(getLineIssues(state.lines[1])).toEqual([
      "El precio unitario no cuadra con el total de la línea: revísalo.",
    ]);
  });

  it("si cajas × unidades no da entero no convierte y lo explica", () => {
    let state = createInvoiceReviewState(response(f04), ctx);
    state = reviewReducer(state, { type: "editEntryMode", index: 0, entryMode: "pack" });
    state = reviewReducer(state, { type: "editUnitsPerPack", index: 0, unitsPerPack: 3 });

    expect(getUnitConversion(state.lines[0])).toEqual({ ok: false, reason: expect.stringMatching(/1,5/) });
    const before = state;
    expect(reviewReducer(state, { type: "convertPackToUnits", index: 0 })).toBe(before);
  });

  it("la compra resultante pasa purchaseItemInputSchema (cantidades enteras)", () => {
    let state = createInvoiceReviewState(response(f04), ctx);
    for (const index of [0, 1]) {
      state = reviewReducer(state, { type: "acceptMarked", index });
      state = reviewReducer(state, { type: "editEntryMode", index, entryMode: "pack" });
      state = reviewReducer(state, { type: "editUnitsPerPack", index, unitsPerPack: 12 });
      state = reviewReducer(state, { type: "convertPackToUnits", index });
    }
    state = reviewReducer(state, {
      type: "chooseProduct",
      index: 1,
      product: { productId: "00000000-0000-4000-8000-000000000077", name: "Salsa de tomate" },
    });
    state = acceptAll(state);
    state = reviewReducer(state, { type: "chooseProduct", index: 2, product: { productId: "00000000-0000-4000-8000-000000000078", name: "De Todito" } });
    const draft = buildInvoiceReviewDraft(state);

    expect(draft).not.toBeNull();
    for (const line of draft?.lines ?? []) {
      const input = { ...draftToPurchaseItemInput(line.item, draft?.rateVes), taxRateCode: line.taxRateCode };
      expect(purchaseItemInputSchema.safeParse(input).success).toBe(true);
    }
  });
});

describe("MEDIO-4 · tasa impresa inverosímil (f04: 86,75 es el total REF)", () => {
  it("no se ofrece y se avisa que se ignora", () => {
    const state = createInvoiceReviewState(response(f04), ctx);

    expect(state.rate.printed).toBeUndefined();
    expect(getRateOptions(state)).toEqual(["system", "manual"]);
    expect(state.rate.ignoredWarning).toBe("La tasa leída (86,75) no parece una tasa Bs/USD; se ignora.");
    expect(reviewReducer(state, { type: "setRateChoice", choice: "printed" })).toBe(state);
  });

  it.each([
    [659.9, false],
    [660.09, true],
    [1100.14, true],
    [1100.3, false],
  ])("borde ±25 %% (PRINTED_RATE_MAX_DEVIATION) frente a 880,12: %p se ofrece = %p", (printedRate, offered) => {
    const fixture = { ...response(f04), extraction: { ...response(f04).extraction, printedRate } };
    const state = createInvoiceReviewState(fixture, ctx);
    expect(state.rate.printed !== undefined).toBe(offered);
  });

  it("sin tasa del día: acota con la última conocida (0,5×–2×); sin ninguna, se ofrece con aviso fuerte", () => {
    const noSystem = { taxRates: TAX_RATES };
    let state = createInvoiceReviewState(response(f04), { ...noSystem, lastKnownRateVes: 880 });
    expect(state.rate).toMatchObject({ choice: "manual", ignoredWarning: expect.stringContaining("86,75") });
    expect(getRateOptions(state)).toEqual(["manual"]);

    state = createInvoiceReviewState(response(f01), { ...noSystem, lastKnownRateVes: 880 });
    expect(state.rate).toMatchObject({ choice: "printed", printed: 875.65 });
    expect(state.rate.unverified).toBeUndefined();

    state = createInvoiceReviewState(response(f04), noSystem);
    expect(state.rate).toMatchObject({ choice: "printed", printed: 86.75, unverified: true });
    expect(state.rate.notice).toMatch(/sin verificar/);
  });

  it("f01: 875,65 frente a 880,12 sí se ofrece", () => {
    const state = createInvoiceReviewState(response(f01), ctx);
    expect(state.rate.printed).toBe(875.65);
    expect(state.rate.ignoredWarning).toBeUndefined();
  });
});
