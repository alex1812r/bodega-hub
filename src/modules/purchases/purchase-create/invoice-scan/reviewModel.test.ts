/**
 * SCN-08a · Modelo de la revisión del escaneo (plan factura-escaneo §5.3 SCN-08;
 * caos 6.7, 6.8, 6.16, 6.17, 6.19, 6.20, 6.21).
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { USD_DOCUMENT_ISSUE, priceCoherenceIssue, resolveRate } from "@/modules/invoice-scan/server/match/money";

import {
  makeReviewResponse,
  productUuid,
  REVIEW_TAX_RATES,
  doubtfulLine,
  unmatchedLine,
  type ReviewFixtureLine,
} from "./reviewFixtures";
import {
  awaitsCostAcknowledgement,
  canLoad,
  createInvoiceReviewState,
  getEffectiveRate,
  getInvoiceReviewBlockers,
  getInvoiceReviewTotals,
  getLineCosts,
  getLineNeeds,
  getPendingCount,
  getRateOptions,
  getTaxInclusion,
  getReviewSections,
  isExplicitChoiceIssue,
  isLineMismatch,
  needsExplicitChoice,
  nextPendingIndex,
  orderedLineIndices,
  pressEnter,
  pressEscape,
  priceIssueLastUnitCostRef,
  reviewReducer,
  summarizeInvoiceReview,
  type InvoiceReviewAction,
  type InvoiceReviewContext,
  type InvoiceReviewState,
} from "./reviewModel";

const ctx: InvoiceReviewContext = { systemRateVes: 900, taxRates: REVIEW_TAX_RATES };

function stateOf(
  lines: ReviewFixtureLine[],
  extra: Omit<Parameters<typeof makeReviewResponse>[0], "lines"> = {},
  context: InvoiceReviewContext = ctx,
) {
  return createInvoiceReviewState(makeReviewResponse({ lines, ...extra }), context);
}

const confirmed: ReviewFixtureLine = {};

describe("orden por urgencia", () => {
  it("sin emparejar, dudosas y confirmadas, estable por índice; confirmadas aparte con su conteo", () => {
    const state = stateOf([confirmed, doubtfulLine(2), unmatchedLine(3), confirmed, unmatchedLine(5), doubtfulLine(6)]);

    expect(orderedLineIndices(state)).toEqual([2, 4, 1, 5, 0, 3]);
    const sections = getReviewSections(state);
    expect(sections.review.map((line) => line.index)).toEqual([2, 4, 1, 5]);
    expect(sections.confirmed.map((line) => line.index)).toEqual([0, 3]);
    expect(sections.confirmedCount).toBe(2);
    expect(state.lines.map((line) => line.status)).toEqual([
      "confirmed_by_match",
      "pending_doubtful",
      "pending_unmatched",
      "confirmed_by_match",
      "pending_unmatched",
      "pending_doubtful",
    ]);
  });

  it("las filas no saltan al resolver: el orden sale del estado de origen", () => {
    let state = stateOf([confirmed, doubtfulLine(2), unmatchedLine(3)]);
    state = reviewReducer(state, { type: "acceptCandidate", index: 1, productId: productUuid(2) });

    expect(orderedLineIndices(state)).toEqual([2, 1, 0]);
  });
});

describe("6.16 · score 0,99 no se resuelve sola", () => {
  it("una dudosa con candidato 0,99 sigue pendiente hasta que el usuario la acepta", () => {
    let state = stateOf([doubtfulLine(1, 0.99)]);

    expect(state.lines[0].status).toBe("pending_doubtful");
    expect(getPendingCount(state)).toBe(1);
    expect(canLoad(state)).toBe(false);

    state = reviewReducer(state, { type: "markCandidate", index: 0, productId: productUuid(1) });
    expect(state.lines[0].status).toBe("pending_doubtful");

    state = reviewReducer(state, { type: "acceptCandidate", index: 0, productId: productUuid(1) });
    expect(state.lines[0]).toMatchObject({ status: "resolved", accepted: true, productId: productUuid(1) });
    expect(canLoad(state)).toBe(true);
  });

  it("aceptar un producto que no es candidato no hace nada (eso va por chooseProduct)", () => {
    const state = stateOf([doubtfulLine(1, 0.99)]);
    const next = reviewReducer(state, { type: "acceptCandidate", index: 0, productId: productUuid(77) });

    expect(next).toBe(state);
  });
});

describe("6.17 · 20 líneas, 15 confirmadas: las 5 pendientes solo con teclado", () => {
  it("Enter acepta y salta a la siguiente pendiente; las confirmadas nunca reciben foco", () => {
    const pendingAt = new Set([2, 7, 11, 15, 19]);
    const lines = Array.from({ length: 20 }, (_, index) =>
      pendingAt.has(index) ? doubtfulLine(index + 1) : confirmed,
    );
    let state = stateOf(lines);
    const visited: number[] = [];
    let focus = nextPendingIndex(state, null);

    while (focus !== null) {
      visited.push(focus);
      expect(state.lines[focus].status).toMatch(/^pending_/);
      const result = pressEnter(state, focus);
      state = result.state;
      focus = result.next;
      expect(visited.length).toBeLessThanOrEqual(5);
    }

    expect(visited).toEqual([2, 7, 11, 15, 19]);
    expect(getPendingCount(state)).toBe(0);
    expect(getReviewSections(state).confirmedCount).toBe(15);
    expect(canLoad(state)).toBe(true);
  });

  it("Enter acepta el candidato marcado y no el primero", () => {
    let state = stateOf([doubtfulLine(1)]);
    state = reviewReducer(state, { type: "markCandidate", index: 0, productId: productUuid(101) });
    const { state: next, next: focus } = pressEnter(state, 0);

    expect(next.lines[0]).toMatchObject({ status: "resolved", productId: productUuid(101), productName: "Otro 1" });
    expect(focus).toBeNull();
  });

  it("Enter en una sin emparejar acepta el primer parecido; sin candidatos el foco se queda", () => {
    const state = stateOf([unmatchedLine(1), unmatchedLine(2, false)]);
    const first = pressEnter(state, 0);

    expect(first.state.lines[0].status).toBe("resolved");
    expect(first.next).toBe(1);
    const second = pressEnter(first.state, 1);
    expect(second.state.lines[1].status).toBe("pending_unmatched");
    expect(second.next).toBe(1);
  });
});

describe("Esc · dejar sin emparejar", () => {
  it("quita el producto, la línea queda sin emparejar y el foco pasa a la siguiente pendiente", () => {
    const state = stateOf([doubtfulLine(1), confirmed, doubtfulLine(3)]);
    const { state: next, next: focus } = pressEscape(state, 0);

    expect(next.lines[0]).toMatchObject({ status: "pending_unmatched", accepted: false });
    expect(next.lines[0].productId).toBeUndefined();
    expect(focus).toBe(2);
    expect(canLoad(next)).toBe(false);
    // Sigue pudiendo elegirse un candidato después de Esc.
    expect(next.lines[0].candidates).toHaveLength(2);
  });

  it("Esc en una confirmada la sube con las dudosas", () => {
    const state = stateOf([confirmed, doubtfulLine(2)]);
    const { state: next } = pressEscape(state, 0);

    expect(next.lines[0].status).toBe("pending_unmatched");
    expect(orderedLineIndices(next)).toEqual([0, 1]);
  });
});

describe("canLoad y pendingCount", () => {
  it("descartar explícitamente cuenta como resuelto; restaurar vuelve a pendiente", () => {
    let state = stateOf([confirmed, unmatchedLine(2, false)]);
    expect(getPendingCount(state)).toBe(1);
    expect(canLoad(state)).toBe(false);

    state = reviewReducer(state, { type: "discardLine", index: 1 });
    expect(state.lines[1].status).toBe("discarded");
    expect(getPendingCount(state)).toBe(0);
    expect(canLoad(state)).toBe(true);

    state = reviewReducer(state, { type: "restoreLine", index: 1 });
    expect(state.lines[1].status).toBe("pending_unmatched");
    expect(canLoad(state)).toBe(false);
  });

  it("exige proveedor confirmado y al menos una línea sin descartar", () => {
    let state = stateOf([confirmed], {
      matched: {
        supplier: { candidates: [{ contactId: "c1", name: "Chevere", score: 0.8, reason: "RIF parecido" }] },
      },
    });
    expect(getInvoiceReviewBlockers(state)).toEqual(["Elige el proveedor."]);

    state = reviewReducer(state, { type: "setSupplier", supplier: { contactId: "c1", name: "Chevere" } });
    expect(canLoad(state)).toBe(true);

    state = reviewReducer(state, { type: "discardLine", index: 0 });
    expect(getInvoiceReviewBlockers(state)).toEqual(["No queda ninguna línea para cargar."]);
  });

  it("BAJO-N3 (CIE-03a): el proveedor confirmado lleva el nombre del contacto, no el leído", () => {
    const state = stateOf([confirmed], {
      extraction: { supplier: { name: "PROVEEDOR UNO, C.A" } },
      matched: {
        supplier: {
          contactId: "c1",
          candidates: [{ contactId: "c1", name: "Chevere Depot", score: 0.95, reason: "RIF igual" }],
        },
      },
    });

    expect(state.header.supplier).toMatchObject({ contactId: "c1", name: "Chevere Depot", readName: "PROVEEDOR UNO, C.A" });
  });

  it("buscador: chooseProduct resuelve una sin emparejar sin candidatos", () => {
    let state = stateOf([unmatchedLine(1, false)]);
    state = reviewReducer(state, {
      type: "chooseProduct",
      index: 0,
      product: { productId: productUuid(50), name: "Nuevo" },
    });
    // REP9-02 (D42): hasta que llega su último costo (aquí, sin costo previo) no se resuelve.
    expect(state.lines[0].status).toBe("pending_doubtful");
    state = reviewReducer(state, { type: "setLastUnitCost", index: 0, productId: productUuid(50), result: null });

    expect(state.lines[0]).toMatchObject({ status: "resolved", productName: "Nuevo" });
  });

  it("una cantidad inválida deja pendiente incluso una confirmada", () => {
    let state = stateOf([confirmed]);
    state = reviewReducer(state, { type: "editQuantity", index: 0, quantity: 1.5 });

    expect(state.lines[0].status).toBe("pending_doubtful");
    expect(getLineNeeds(state.lines[0])).toEqual(["quantity"]);
    state = reviewReducer(state, { type: "editQuantity", index: 0, quantity: 3 });
    expect(state.lines[0].status).toBe("confirmed_by_match");
  });

  it("editTaxRate solo admite alícuotas del catálogo", () => {
    let state = stateOf([confirmed]);
    state = reviewReducer(state, { type: "editTaxRate", index: 0, taxRateCode: "exento" });
    expect(state.lines[0].taxRateCode).toBe("exento");
    expect(reviewReducer(state, { type: "editTaxRate", index: 0, taxRateCode: "inexistente" })).toBe(state);
  });
});

describe("totales y lineMismatch", () => {
  it("compara leído con calculado y marca las líneas cuyo cantidad × precio no da su total", () => {
    let state = stateOf(
      [
        { read: { quantity: 2, unitPrice: 100, lineTotal: 200 } },
        { read: { quantity: 3, unitPrice: 33.33, lineTotal: 100 } },
        { read: { quantity: 4, unitPrice: 50, lineTotal: 2400 } },
      ],
      { extraction: { total: 2700 } },
    );
    let totals = getInvoiceReviewTotals(state);

    // 200 + 99,99 + 200 = 499,99 frente a 2700 leídos.
    expect(totals).toMatchObject({ read: 2700, computed: 499.99, mismatch: true, lineMismatches: [2] });
    expect(isLineMismatch(state, state.lines[1])).toBe(false);

    // CAJA x12: el precio impreso era por unidad dentro; el usuario lo corrige.
    state = reviewReducer(state, { type: "editUnitPrice", index: 2, unitPrice: 600 });
    totals = getInvoiceReviewTotals(state);
    expect(totals).toMatchObject({ computed: 2699.99, mismatch: false, lineMismatches: [] });
  });

  it("el total leído con IVA también cuadra; las descartadas no suman", () => {
    let state = stateOf([{ read: { quantity: 1, unitPrice: 100, lineTotal: 100 } }, { read: { quantity: 1, unitPrice: 50, lineTotal: 50 } }], {
      extraction: { total: 174 },
    });
    // 150 neto, 174 con 16 %: el pie compara lo que se registra (base + IVA) con el leído.
    expect(getInvoiceReviewTotals(state)).toMatchObject({ computed: 150, registered: 174, mismatch: false });

    state = reviewReducer(state, { type: "discardLine", index: 1 });
    expect(getInvoiceReviewTotals(state)).toMatchObject({ computed: 100, mismatch: true });
  });

  it("con subtotal leído compara contra el subtotal (tolerancia 1 % o 1 Bs)", () => {
    const state = stateOf([{ read: { quantity: 1, unitPrice: 100.5, lineTotal: 100.5 } }], {
      extraction: { subtotal: 100, tax: 16, total: 116 },
    });
    expect(getInvoiceReviewTotals(state).mismatch).toBe(false);
  });
});

describe("6.20 · tasa impresa 875,65 vs sistema 900,00", () => {
  it("avisa (> 2 %, D8), ofrece la impresa y recalcula el REF con la elegida", () => {
    let state = stateOf([{ read: { quantity: 1, unitPrice: 9000, lineTotal: 9000 } }], {
      extraction: { printedRate: 875.65 },
    });

    expect(state.rate.choice).toBe("system");
    expect(state.rate.warning).toMatch(/875,65.*900,00/);
    expect(getRateOptions(state)).toEqual(["system", "printed", "manual"]);
    expect(getLineCosts(state, state.lines[0])).toEqual({ ves: 9000, ref: 10 });

    state = reviewReducer(state, { type: "setRateChoice", choice: "printed" });
    expect(getEffectiveRate(state)).toBe(875.65);
    expect(getLineCosts(state, state.lines[0])).toEqual({ ves: 9000, ref: 10.28 });
  });

  it("una diferencia de 2 % o menos no avisa", () => {
    const state = stateOf([confirmed], { extraction: { printedRate: 890 } });
    expect(state.rate.warning).toBeUndefined();
  });

  it.each([
    [882, false],
    [918, false],
    [881.91, true],
    [918.09, true],
  ])("borde exacto D8 frente a 900: impresa %p avisa = %p, igual que matched.rate.warning", (printedRate, warns) => {
    const state = stateOf([confirmed], { extraction: { printedRate } });
    const serverWarning = resolveRate(900, printedRate).info?.warning;

    expect(state.rate.choice).toBe("system");
    expect(state.rate.warning !== undefined).toBe(warns);
    expect(serverWarning !== undefined).toBe(warns);
  });
});

describe("6.7 · sin tasa del sistema", () => {
  it("usa la impresa con aviso", () => {
    const state = stateOf([confirmed], { extraction: { printedRate: 875.65 } }, { taxRates: REVIEW_TAX_RATES });

    expect(state.rate).toMatchObject({ choice: "printed", printed: 875.65 });
    expect(state.rate.notice).toMatch(/tasa impresa/);
    expect(canLoad(state)).toBe(true);
  });

  it("sin impresa exige la tasa manual: nada se precarga en REF y no se puede cargar", () => {
    let state = stateOf([confirmed], {}, { taxRates: REVIEW_TAX_RATES });

    expect(state.rate.choice).toBe("manual");
    expect(state.rate.notice).toMatch(/escribe la tasa/);
    expect(getLineCosts(state, state.lines[0]).ref).toBeUndefined();
    expect(canLoad(state)).toBe(false);
    expect(getInvoiceReviewBlockers(state)).toContain("Escribe la tasa para convertir los costos a REF.");

    state = reviewReducer(state, { type: "setRateChoice", choice: "manual", manualRate: 0 });
    expect(canLoad(state)).toBe(false);
    state = reviewReducer(state, { type: "setRateChoice", choice: "manual", manualRate: 1000 });
    expect(getLineCosts(state, state.lines[0])).toEqual({ ves: 100, ref: 0.1 });
    expect(canLoad(state)).toBe(true);
  });

  it("no deja elegir una tasa que no existe", () => {
    const state = stateOf([confirmed], {}, { taxRates: REVIEW_TAX_RATES });
    expect(reviewReducer(state, { type: "setRateChoice", choice: "system" })).toBe(state);
    expect(reviewReducer(state, { type: "setRateChoice", choice: "printed" })).toBe(state);
  });
});

describe("6.21 · factura en dólares", () => {
  it("todas las líneas dudosas con aviso, nada como Bs; tras aceptar los costos van como REF", () => {
    let state = stateOf([confirmed, doubtfulLine(2)], { extraction: { currency: "USD" } });

    expect(state.usd.anomaly).toBe(true);
    expect(state.lines.map((line) => line.status)).toEqual(["pending_doubtful", "pending_doubtful"]);
    expect(state.lines.every((line) => line.issues.includes(USD_DOCUMENT_ISSUE))).toBe(true);
    expect(getLineCosts(state, state.lines[0])).toEqual({});

    state = reviewReducer(state, { type: "acceptMarked", index: 0 });
    state = reviewReducer(state, { type: "acceptMarked", index: 1 });
    expect(getPendingCount(state)).toBe(0);
    expect(getInvoiceReviewBlockers(state)).toEqual([
      "Confirma que la factura está en dólares para cargar los costos como REF.",
    ]);

    state = reviewReducer(state, { type: "acceptUsdAnomaly" });
    expect(getLineCosts(state, state.lines[0])).toEqual({ ref: 100 });
    expect(canLoad(state)).toBe(true);
  });

  it("también detecta el $ por el aviso del emparejamiento aunque la moneda no diga USD", () => {
    const state = stateOf([{ match: { status: "doubtful", issues: [USD_DOCUMENT_ISSUE] } }]);
    expect(state.usd.anomaly).toBe(true);
  });

  it("con dólares aceptados no exige tasa", () => {
    let state = stateOf([confirmed], { extraction: { currency: "USD" } }, { taxRates: REVIEW_TAX_RATES });
    state = reviewReducer(state, { type: "acceptMarked", index: 0 });
    state = reviewReducer(state, { type: "acceptUsdAnomaly" });
    expect(canLoad(state)).toBe(true);
  });
});

describe("REP5-01 (D31): una línea con aviso de precio o de empaque no se resuelve sin la elección explícita", () => {
  // El aviso sale de la función del servidor: si cambia su texto, este test lo detecta.
  const priceIssue = priceCoherenceIssue({
    line: {
      rawText: "GALLETA MARIA CAJA X6",
      description: "GALLETA MARIA CAJA X6",
      quantity: 1,
      unitPrice: 2700,
      lineTotal: 2700,
      confidence: 0.95,
    },
    unitsPerPack: 6,
    entryMode: "pack",
    rate: 880,
    lastUnitCostRef: 0.05,
  });
  const packIssue =
    'Antes este proveedor lo facturó por unidad; ahora dice caja: confirma si son empaques "Caja x6" de 6 unidades o unidades sueltas.';
  const productId = productUuid(1);
  const acceptances: [string, InvoiceReviewAction][] = [
    ["Enter (acceptMarked)", { type: "acceptMarked", index: 0 }],
    ["chip (acceptCandidate)", { type: "acceptCandidate", index: 0, productId }],
    ["buscador o alta (chooseProduct)", { type: "chooseProduct", index: 0, product: { productId, name: "Producto 1" } }],
  ];
  const choices: [string, InvoiceReviewAction][] = [
    ["Por caja", { type: "editEntryMode", index: 0, entryMode: "pack" }],
    ["Por unidad", { type: "editEntryMode", index: 0, entryMode: "unit" }],
    ["corrige el costo", { type: "editUnitPrice", index: 0, unitPrice: 270 }],
    ["corrige la cantidad", { type: "editQuantity", index: 0, quantity: 2 }],
    ["corrige las unidades", { type: "editUnitsPerPack", index: 0, unitsPerPack: 12 }],
  ];
  const lineWith = (issue: string) =>
    stateOf([
      doubtfulLine(1, 1, {
        read: { unit: "caja", quantity: 1, unitPrice: 2700, lineTotal: 2700, unitsPerPack: 6 },
        match: { entryMode: "pack", unitsPerPack: 6, issues: [issue] },
      }),
    ]);
  // D43 (B-r9-1): el costo desviado se reconoce con su botón, nunca al elegir la opción.
  const ackIfDeviating = (state: InvoiceReviewState): InvoiceReviewState =>
    awaitsCostAcknowledgement(state, state.lines[0]) ? reviewReducer(state, { type: "acknowledgeCost", index: 0 }) : state;

  describe.each([
    ["6.18 precio por caja", priceIssue as string],
    ["empaque nuevo frente a unidades", packIssue],
  ])("%s", (_, issue) => {
    it.each(acceptances)("%s elige el producto pero la línea sigue dudosa", (__, action) => {
      expect(issue).toBeDefined();
      const state = reviewReducer(lineWith(issue), action);
      expect(state.lines[0]).toMatchObject({ status: "pending_doubtful", accepted: true, productId });
      expect(needsExplicitChoice(state.lines[0])).toBe(true);
      expect(canLoad(state)).toBe(false);
    });

    it.each(choices)("aceptada y luego «%s»: resuelta", (name, choice) => {
      let state = reviewReducer(lineWith(issue), { type: "acceptMarked", index: 0 });
      state = reviewReducer(state, choice);
      expect(needsExplicitChoice(state.lines[0])).toBe(false);
      // REP9-02 (D42): con el aviso 6.18 (0,50 REF/u frente a 0,05), solo corregir el costo lo
      // deja coherente. D43: ni elegir la opción ni corregir reconocen el costo desviado.
      const stillDeviating = issue === priceIssue && name !== "corrige el costo";
      expect(awaitsCostAcknowledgement(state, state.lines[0])).toBe(stillDeviating);
      expect(state.lines[0].status).toBe(stillDeviating ? "pending_doubtful" : "resolved");
      state = ackIfDeviating(state);
      expect(state.lines[0].status).toBe("resolved");
    });

    it("elegida antes de aceptar: aceptar la resuelve", () => {
      let state = reviewReducer(lineWith(issue), { type: "editEntryMode", index: 0, entryMode: "pack" });
      state = ackIfDeviating(state);
      expect(state.lines[0].status).toBe("pending_doubtful");
      state = pressEnter(state, 0).state;
      expect(state.lines[0].status).toBe("resolved");
    });

    // REP6-02 (D33-b, C6-M2): cambiar de producto reinicia la elección explícita.
    const otherId = productUuid(101);
    const pickUnit = (): InvoiceReviewState => {
      let state = reviewReducer(lineWith(issue), { type: "acceptCandidate", index: 0, productId });
      state = ackIfDeviating(reviewReducer(state, { type: "editEntryMode", index: 0, entryMode: "unit" }));
      expect(state.lines[0]).toMatchObject({ status: "resolved", entryMode: "unit", choiceMade: true });
      return state;
    };
    const expectPendingChoice = (state: InvoiceReviewState) => {
      expect(state.lines[0]).toMatchObject({ status: "pending_doubtful", accepted: true, productId, choiceMade: false });
      expect(state.lines[0].entryMode).toBe("pack");
      expect(needsExplicitChoice(state.lines[0])).toBe(true);
      expect(canLoad(state)).toBe(false);
    };

    it("R3 · Por unidad → producto B (buscador) → vuelve a A (buscador): pide elegir otra vez", () => {
      let state = pickUnit();
      state = reviewReducer(state, { type: "chooseProduct", index: 0, product: { productId: otherId, name: "Otro 1" } });
      expect(state.lines[0]).toMatchObject({ productId: otherId, choiceMade: false, status: "pending_doubtful" });
      state = reviewReducer(state, { type: "chooseProduct", index: 0, product: { productId, name: "Producto 1" } });
      expectPendingChoice(state);
    });

    it("R3b · Por unidad → chip B → chip A (acceptCandidate): pide elegir otra vez", () => {
      let state = pickUnit();
      state = reviewReducer(state, { type: "acceptCandidate", index: 0, productId: otherId });
      expect(state.lines[0]).toMatchObject({ productId: otherId, choiceMade: false, status: "pending_doubtful" });
      state = reviewReducer(state, { type: "acceptCandidate", index: 0, productId });
      expectPendingChoice(state);
    });

    it("R5 · Por unidad → Esc → chip A: pide elegir otra vez", () => {
      let state = pickUnit();
      state = pressEscape(state, 0).state;
      expect(state.lines[0].productId).toBeUndefined();
      state = reviewReducer(state, { type: "acceptCandidate", index: 0, productId });
      expectPendingChoice(state);
    });

    it("REP6-05 · Por unidad → Esc (leaveUnmatched): la línea sin producto no conserva la elección", () => {
      let state = pickUnit();
      state = reviewReducer(state, { type: "leaveUnmatched", index: 0 });
      expect(state.lines[0]).toMatchObject({ productId: undefined, leftUnmatched: true, choiceMade: false });
      expect(state.lines[0].status).toBe("pending_unmatched");
    });

    it("tras el cambio, elegir el modo vuelve a resolverla", () => {
      let state = pickUnit();
      state = reviewReducer(state, { type: "acceptCandidate", index: 0, productId: otherId });
      state = ackIfDeviating(reviewReducer(state, { type: "editEntryMode", index: 0, entryMode: "unit" }));
      expect(state.lines[0]).toMatchObject({ status: "resolved", choiceMade: true, productId: otherId });
    });
  });

  it("REP6-02 · sin aviso, cambiar de producto sigue resolviendo la línea", () => {
    let state = stateOf([doubtfulLine(1, 1, { match: { entryMode: "unit" } })]);
    state = reviewReducer(state, { type: "editEntryMode", index: 0, entryMode: "unit" });
    state = reviewReducer(state, { type: "acceptCandidate", index: 0, productId: productUuid(101) });
    expect(state.lines[0]).toMatchObject({ status: "resolved", choiceMade: false });
    state = reviewReducer(state, { type: "acceptCandidate", index: 0, productId: productUuid(1) });
    expect(state.lines[0]).toMatchObject({ status: "resolved", choiceMade: false });
  });

  it("6.19 sin tamaño: escribir las unidades ya es la elección", () => {
    let state = stateOf([
      doubtfulLine(1, 1, {
        read: { unit: "bulto" },
        match: { entryMode: "pack", issues: ["La factura no dice cuántas unidades trae cada bulto: indícalo."] },
      }),
    ]);
    state = reviewReducer(state, { type: "acceptMarked", index: 0 });
    state = reviewReducer(state, { type: "editUnitsPerPack", index: 0, unitsPerPack: 20 });
    expect(state.lines[0].status).toBe("resolved");
  });

  /**
   * Ancla de las plantillas de aviso de empaque (`server/match/pack.ts` y la de empaque no
   * registrado de `server/match.ts`): cada una debe reconocerse como aviso de elección, o
   * figurar aquí como excepción deliberada. Un texto nuevo o cambiado rompe este test.
   */
  it("toda plantilla de aviso de empaque del servidor se reconoce (o es excepción declarada)", () => {
    const server = path.join(__dirname, "../../../invoice-scan/server");
    const sources = [
      readFileSync(path.join(server, "match/pack.ts"), "utf8"),
      readFileSync(path.join(server, "match.ts"), "utf8"),
    ].join("\n");
    // Literales de aviso: plantillas `...` y cadenas "..." que terminan en punto, con los ${} rellenados.
    const literals = [
      ...Array.from(sources.matchAll(/`([^`]*\.\)?)`/g), (match) => match[1]),
      ...Array.from(sources.matchAll(/"([^"\n]*[a-z]: [^"\n]*\.)"/g), (match) => match[1]),
    ]
      .map((text) => text.replace(/\$\{[^}]*\}/g, "6"))
      .filter((text) => /unidades|empaque/.test(text) && /: /.test(text));
    // 6.19: falta el tamaño; aceptar no resuelve la línea y escribirlo ya es la elección.
    const exceptions = [/^La factura no dice cuántas unidades trae cada 6: indícalo\.$/];

    expect(literals.length).toBeGreaterThanOrEqual(12);
    const unrecognized = literals.filter(
      (text) => !isExplicitChoiceIssue(text) && !exceptions.some((rule) => rule.test(text)),
    );
    expect(unrecognized).toEqual([]);
    expect(isExplicitChoiceIssue(priceIssue as string)).toBe(true);
  });

  /** REP7-05 (B-p7-3): el último costo de las opciones sale del aviso; si su texto cambia, esto falla. */
  it("el último costo se lee del aviso de precio del servidor (también con miles)", () => {
    const expensive = priceCoherenceIssue({
      line: { rawText: "WHISKY CAJA X6", description: "WHISKY", quantity: 1, unitPrice: 900, lineTotal: 900, confidence: 0.9 },
      unitsPerPack: 6,
      entryMode: "pack",
      rate: 1,
      lastUnitCostRef: 1234.5,
    });

    expect(priceIssueLastUnitCostRef({ issues: [priceIssue as string] })).toBe(0.05);
    expect(priceIssueLastUnitCostRef({ issues: [expensive as string] })).toBe(1234.5);
    expect(priceIssueLastUnitCostRef({ issues: [packIssue] })).toBeUndefined();
  });
});

describe("unitsPerPack obligatorio (6.8, 6.19)", () => {
  it("6.8 CAJA x12 con empaque registrado de 6: dudosa; aceptar no basta; con 12 se resuelve como empaque nuevo", () => {
    let state: InvoiceReviewState = stateOf([
      doubtfulLine(1, 0.95, {
        read: { rawText: "MALTA CAJA X12", unit: "caja", unitsPerPack: 12, quantity: 2, unitPrice: 1200, lineTotal: 2400 },
        match: {
          entryMode: "pack",
          issues: ["La factura dice caja de 12 unidades y el empaque registrado es de 6: confirma las unidades por empaque."],
        },
      }),
    ]);
    expect(state.lines[0]).toMatchObject({ status: "pending_doubtful", entryMode: "pack", packLabel: "Caja" });
    expect(state.lines[0].unitsPerPack).toBeUndefined();

    const entered = pressEnter(state, 0);
    state = entered.state;
    expect(state.lines[0].status).toBe("pending_doubtful");
    expect(getLineNeeds(state.lines[0])).toEqual(["unitsPerPack"]);
    expect(entered.next).toBe(0);
    expect(canLoad(state)).toBe(false);

    state = reviewReducer(state, { type: "editUnitsPerPack", index: 0, unitsPerPack: 12 });
    expect(state.lines[0]).toMatchObject({ status: "resolved", unitsPerPack: 12 });
    expect(state.lines[0].packUnitId).toBeUndefined();
    expect(canLoad(state)).toBe(true);
  });

  it("6.19 BULTO sin número: no entra como 1 unidad; un tamaño no entero tampoco vale", () => {
    let state = stateOf([
      unmatchedLine(1, true, {
        read: { rawText: "ARROZ BULTO", unit: "bulto", quantity: 1, unitPrice: 5000, lineTotal: 5000 },
        match: { entryMode: "pack", issues: ["La factura no dice cuántas unidades trae cada bulto: indícalo."] },
      }),
    ]);
    state = reviewReducer(state, { type: "acceptMarked", index: 0 });
    expect(state.lines[0]).toMatchObject({ status: "pending_doubtful", entryMode: "pack", packLabel: "Bulto" });

    state = reviewReducer(state, { type: "editUnitsPerPack", index: 0, unitsPerPack: 2.5 });
    expect(state.lines[0].status).toBe("pending_doubtful");
    state = reviewReducer(state, { type: "editUnitsPerPack", index: 0, unitsPerPack: 20 });
    expect(state.lines[0].status).toBe("resolved");
  });

  it("volver al tamaño registrado recupera su packUnitId", () => {
    let state = stateOf([
      { match: { entryMode: "pack", unitsPerPack: 6, packUnitId: "pu-6" }, read: { unit: "caja", unitsPerPack: 6 } },
    ]);
    state = reviewReducer(state, { type: "editUnitsPerPack", index: 0, unitsPerPack: 12 });
    expect(state.lines[0].packUnitId).toBeUndefined();
    state = reviewReducer(state, { type: "editUnitsPerPack", index: 0, unitsPerPack: 6 });
    expect(state.lines[0].packUnitId).toBe("pu-6");
  });

  it("otro producto pierde empaque registrado y desarmar; volver al propuesto los recupera", () => {
    let state = stateOf([
      doubtfulLine(1, 0.8, {
        match: { entryMode: "pack", unitsPerPack: 24, packUnitId: "pu-24", disassembleOnReceive: true },
      }),
    ]);
    state = reviewReducer(state, { type: "acceptCandidate", index: 0, productId: productUuid(101) });
    expect(state.lines[0]).toMatchObject({ disassembleOnReceive: false, unitsPerPack: 24 });
    expect(state.lines[0].packUnitId).toBeUndefined();

    state = reviewReducer(state, { type: "acceptCandidate", index: 0, productId: productUuid(1) });
    expect(state.lines[0]).toMatchObject({ disassembleOnReceive: true, packUnitId: "pu-24", unitsPerPack: 24 });
  });
});

describe("summarizeInvoiceReview", () => {
  it("junta pendientes, confirmadas, bloqueos, totales y tasa", () => {
    const summary = summarizeInvoiceReview(stateOf([confirmed, doubtfulLine(2)]));
    expect(summary).toMatchObject({
      pendingCount: 1,
      confirmedCount: 1,
      canLoad: false,
      blockers: ["Queda 1 línea por resolver."],
      effectiveRate: 900,
    });
  });
});

describe("M3 / D25-a · IVA incluido con desglose y confirmación de la diferencia", () => {
  it("sin desglose: la sugerencia de siempre (Σ líneas = total leído → IVA incluido)", () => {
    expect(getTaxInclusion(stateOf([confirmed], { extraction: { total: 200 } }))).toEqual({
      suggested: true,
      included: true,
    });
    expect(getTaxInclusion(stateOf([confirmed], { extraction: { total: 232 } }))).toEqual({
      suggested: false,
      included: false,
    });
  });

  it("desglosada y Σ líneas = total leído ≠ subtotal: preselecciona IVA incluido y cuadra", () => {
    const state = stateOf([{ read: { quantity: 1, unitPrice: 2412.02, lineTotal: 2412.02 } }], {
      extraction: { subtotal: 2079.33, tax: 332.69, total: 2412.02 },
    });
    expect(getTaxInclusion(state)).toEqual({ suggested: true, included: true });
    expect(getInvoiceReviewTotals(state)).toMatchObject({ base: 2079.33, registered: 2412.02, mismatch: false });
    expect(canLoad(state)).toBe(true);
  });

  it("exenta (IVA 0, subtotal = total): no sugiere IVA incluido y se carga", () => {
    const state = stateOf([{ match: { taxRateCode: "exento" } }], {
      extraction: { subtotal: 200, tax: 0, total: 200 },
    });
    expect(getTaxInclusion(state)).toEqual({ suggested: false, included: false });
    expect(getInvoiceReviewTotals(state)).toMatchObject({ registered: 200, mismatch: false });
    expect(canLoad(state)).toBe(true);
  });

  it("mixta (Σ líneas = subtotal): precios sin IVA, sin sugerencia ni regresión", () => {
    const state = stateOf(
      [
        { read: { quantity: 1, unitPrice: 100, lineTotal: 100 }, match: { taxRateCode: "exento" } },
        { read: { quantity: 1, unitPrice: 100, lineTotal: 100 } },
      ],
      { extraction: { subtotal: 200, tax: 16, total: 216 } },
    );
    expect(getTaxInclusion(state)).toEqual({ suggested: false, included: false });
    expect(getInvoiceReviewTotals(state)).toMatchObject({ registered: 216, mismatch: false });
    expect(canLoad(state)).toBe(true);
  });

  it("con diferencia Cargar se bloquea hasta confirmarla; si la diferencia cambia, se vuelve a pedir", () => {
    const blocker = "El total a registrar no cuadra con el leído: corrige las líneas o confirma la diferencia.";
    let state = stateOf([{ read: { lineTotal: 300 } }], { extraction: { total: 1000 } });
    expect(getInvoiceReviewBlockers(state)).toEqual([blocker]);

    state = reviewReducer(state, { type: "confirmTotalsDifference", confirmed: true });
    expect(state.acceptedDifference).toBe(768);
    expect(canLoad(state)).toBe(true);

    state = reviewReducer(state, { type: "editUnitPrice", index: 0, unitPrice: 150 });
    expect(getInvoiceReviewBlockers(state)).toEqual([blocker]);

    state = reviewReducer(state, { type: "confirmTotalsDifference", confirmed: true });
    expect(canLoad(state)).toBe(true);
    state = reviewReducer(state, { type: "confirmTotalsDifference", confirmed: false });
    expect(canLoad(state)).toBe(false);
  });

  it("revertir la preselección de f18 bloquea Cargar (+16 %) hasta volver a IVA incluido o confirmar", () => {
    let state = stateOf([{ read: { quantity: 1, unitPrice: 2412.02, lineTotal: 2412.02 } }], {
      extraction: { subtotal: 2079.33, tax: 332.69, total: 2412.02 },
    });
    state = reviewReducer(state, { type: "setPricesIncludeTax", included: false });
    expect(getInvoiceReviewTotals(state)).toMatchObject({ registered: 2797.94, mismatch: true });
    expect(canLoad(state)).toBe(false);

    state = reviewReducer(state, { type: "setPricesIncludeTax", included: true });
    expect(canLoad(state)).toBe(true);
  });
});
