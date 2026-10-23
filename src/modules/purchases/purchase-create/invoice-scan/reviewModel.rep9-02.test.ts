/**
 * REP9-02 · D42 (invariante única de coherencia de costo en el cliente).
 * Para TODA línea con producto + modo + costo se calcula el costo unitario REF resultante y se
 * compara con el último costo unitario de ESE producto (propuesto, candidato o consultado para
 * el buscador). Desvío > 40 % → la línea no queda resuelta (ni `confirmed_by_match`) hasta que el
 * usuario lo reconozca (D43: con su botón, tras elegir la opción); sin último costo, «sin costo previo» y sin bloqueo.
 * Repros: caos p9 C9-M1 (A–E, fixtures `caos-global/p9/ex/c9-*.json`) y QA p9 M-p9-1.
 */
import type { InvoiceLineMatch } from "@/modules/invoice-scan/contracts";
import { NO_RATE_PRICE_ISSUE } from "@/modules/invoice-scan/server/match/money";

import { getDisplayedLineIssues, lineNeedMessages } from "./components/invoiceReviewView";
import { makeReviewResponse, productUuid, REVIEW_TAX_RATES, type ReviewFixtureLine } from "./reviewFixtures";
import {
  createInvoiceReviewState,
  getEntryModeOutcome,
  getInvoiceReviewBlockers,
  getPendingCount,
  getReviewSections,
  pressEnter,
  reviewReducer,
  type InvoiceReviewAction,
  type InvoiceReviewContext,
  type InvoiceReviewState,
} from "./reviewModel";

const RATE_900: InvoiceReviewContext = { systemRateVes: 900, taxRates: REVIEW_TAX_RATES };
const COST_BLOCKER = "Falta confirmar el costo en 1 línea.";

const HARINA = productUuid(1);
const MARY = productUuid(77);
const BUSCADO = productUuid(500);

function build(lines: ReviewFixtureLine[], ctx: InvoiceReviewContext = RATE_900, extraction = {}): InvoiceReviewState {
  return createInvoiceReviewState(makeReviewResponse({ lines, extraction }), ctx);
}

function run(state: InvoiceReviewState, ...actions: InvoiceReviewAction[]): InvoiceReviewState {
  return actions.reduce(reviewReducer, state);
}

const enter = (state: InvoiceReviewState, index = 0) => pressEnter(state, index).state;
const status = (state: InvoiceReviewState, index = 0) => state.lines[index].status;
const chooseMode = (entryMode: "unit" | "pack", index = 0): InvoiceReviewAction => ({
  type: "editEntryMode",
  index,
  entryMode,
});
/** D43 (B-r9-1): elegir la opción y, aparte, reconocer su costo con el botón propio. */
const ackMode = (entryMode: "unit" | "pack", index = 0): InvoiceReviewAction[] => [
  chooseMode(entryMode, index),
  { type: "acknowledgeCost", index },
];

/** C9-M1 A (`c9-cand-unit.json`): por nombre, sin aviso del servidor; 4.500 Bs ÷ 900 = 5,00 frente a 0,50. */
function harinaByName(match: Partial<InvoiceLineMatch> = {}, unitPrice = 4500): ReviewFixtureLine {
  return {
    read: {
      rawText: "CAOSG Harina Maiz 1kg P3 1 4.500,00 4.500,00",
      description: "CAOSG Harina Maiz 1kg",
      unit: "unidad",
      quantity: 1,
      unitPrice,
      lineTotal: unitPrice,
    },
    match: {
      status: "doubtful",
      productId: undefined,
      taxRateCode: "exento",
      candidates: [
        { productId: HARINA, name: "CAOSG Harina Maiz 1kg", score: 1, reason: "nombre parecido 1,00", lastUnitCostRef: 0.5 },
      ],
      lastUnitCostRef: 0.5,
      issues: [],
      ...match,
    },
  };
}

/** C9-M1 B (`c9-cand-galleta.json`): caja x6 a 2.700 Bs, último 0,05. Por caja 0,50 y por unidad 3,00. */
function galletaCaja(): ReviewFixtureLine {
  return {
    read: {
      rawText: "CAOSG Galleta Maria 200g CAJA X6 1 2.700,00 2.700,00",
      description: "CAOSG Galleta Maria 200g CAJA X6",
      unit: "caja",
      unitsPerPack: 6,
      quantity: 1,
      unitPrice: 2700,
      lineTotal: 2700,
    },
    match: {
      status: "doubtful",
      productId: undefined,
      entryMode: "pack",
      unitsPerPack: 6,
      taxRateCode: "exento",
      candidates: [
        { productId: productUuid(2), name: "CAOSG Galleta Maria 200g", score: 0.9, reason: "nombre parecido 0,90", lastUnitCostRef: 0.05 },
      ],
      lastUnitCostRef: 0.05,
      issues: [],
    },
  };
}

/** C9-M1 C (`c9-sku-caja.json`): confirmada por SKU en caja x6 a 270 Bs (0,05/u, coherente). */
function galletaSku(): ReviewFixtureLine {
  return {
    read: {
      rawText: "CG-GALLETA GALLETA MARIA CAJA X6 1 270,00 270,00",
      description: "GALLETA MARIA CAJA X6",
      unit: "caja",
      unitsPerPack: 6,
      quantity: 1,
      unitPrice: 270,
      lineTotal: 270,
    },
    match: {
      status: "confirmed",
      productId: productUuid(2),
      entryMode: "pack",
      unitsPerPack: 6,
      taxRateCode: "exento",
      candidates: [
        { productId: productUuid(2), name: "CAOSG Galleta Maria 200g", score: 1, reason: "SKU del proveedor", lastUnitCostRef: 0.05 },
      ],
      lastUnitCostRef: 0.05,
      issues: [],
    },
  };
}

/** C9-M1 D (`c9-norate.json`): Malta a 9.000 Bs con IVA general, sin tasa del día ni impresa; último 1,00. */
function maltaSinTasa(): ReviewFixtureLine {
  return {
    read: {
      rawText: "CG-MALTA MALTA POLAR 1.5L 1 9.000,00 9.000,00",
      description: "MALTA POLAR 1.5L",
      unit: "unidad",
      quantity: 1,
      unitPrice: 9000,
      lineTotal: 9000,
      taxHint: "general",
    },
    match: {
      status: "doubtful",
      productId: productUuid(3),
      taxRateCode: "general",
      candidates: [
        { productId: productUuid(3), name: "Malta Polar 1.5L", score: 1, reason: "SKU del proveedor", lastUnitCostRef: 1 },
      ],
      lastUnitCostRef: 1,
      issues: [NO_RATE_PRICE_ISSUE],
    },
  };
}

/** C9-M1 E (`c9-homo.json`): dos homónimos empatados (6.9), ambos con último 0,50; 4.500 Bs = 10×. */
function homonimos(): ReviewFixtureLine {
  const candidate = (seed: number, sku: string) => ({
    productId: productUuid(seed),
    name: "Jabón Azul 250g",
    score: 0.8,
    reason: "nombre parecido 0,80",
    sku,
    lastUnitCostRef: 0.5,
  });
  return {
    read: { rawText: "JABON AZUL 250G 1 4.500,00 4.500,00", description: "JABON AZUL 250G", quantity: 1, unitPrice: 4500, lineTotal: 4500 },
    match: {
      status: "doubtful",
      productId: undefined,
      taxRateCode: "exento",
      candidates: [candidate(41, "JA-1"), candidate(42, "JA-2")],
      lastUnitCostRef: 0.5,
      issues: [],
    },
  };
}

/** QA M-p9-1 A: «HARINA PAN 1KG (E) [BULTO X 20.0]», 18.320,29 Bs; alias por unidad; tasa 884,61. */
const PAN_RATE: InvoiceReviewContext = { systemRateVes: 884.61, taxRates: REVIEW_TAX_RATES };
function harinaPanBulto(): ReviewFixtureLine {
  return {
    read: {
      rawText: "HARINA PAN 1KG (E) [BULTO X 20.0]",
      description: "HARINA PAN 1KG",
      unit: "bulto",
      unitsPerPack: 20,
      quantity: 1,
      unitPrice: 18320.29,
      lineTotal: 18320.29,
    },
    match: {
      status: "doubtful",
      productId: HARINA,
      entryMode: "pack",
      unitsPerPack: 20,
      taxRateCode: "exento",
      candidates: [{ productId: HARINA, name: "Harina P.A.N. 1 Kg", score: 1, reason: "alias visto 6 veces", lastUnitCostRef: 1.04 }],
      lastUnitCostRef: 1.04,
      issues: [],
    },
  };
}

/** QA M-p9-1 B (m04): «MALTA 1.5L [BULTO X 6]», 4.203,12 Bs; MALTA 1.5 (1,60) y Malta Polar 1.5L (2,17). */
const M04_RATE: InvoiceReviewContext = { systemRateVes: 884.87, taxRates: REVIEW_TAX_RATES };
function maltaM04(): ReviewFixtureLine {
  return {
    read: { rawText: "MALTA 1.5L [BULTO X 6]", description: "MALTA 1.5L", unit: "bulto", unitsPerPack: 6, quantity: 1, unitPrice: 4203.12, lineTotal: 4203.12 },
    match: {
      status: "doubtful",
      productId: productUuid(10),
      entryMode: "pack",
      unitsPerPack: 6,
      taxRateCode: "exento",
      candidates: [
        { productId: productUuid(10), name: "MALTA 1.5", score: 0.75, reason: "nombre parecido 0,75", lastUnitCostRef: 1.6 },
        { productId: productUuid(11), name: "Malta Polar 1.5L", score: 0.65, reason: "nombre parecido 0,65", lastUnitCostRef: 2.17 },
      ],
      lastUnitCostRef: 1.6,
      issues: [],
    },
  };
}

describe("REP9-02 · C9-M1: un costo desviado no se resuelve sin reconocerlo, haya o no aviso del servidor", () => {
  it("A · Harina Maiz por nombre (5,00 frente a 0,50): Enter NO la resuelve; reconocida con la opción, sí", () => {
    const initial = build([harinaByName()]);
    expect(getEntryModeOutcome(initial, initial.lines[0], "unit")).toMatchObject({
      unitCost: { amount: 5, currency: "REF" },
      lastUnitCostRef: 0.5,
      deviates: true,
    });

    const afterEnter = enter(initial);
    expect(afterEnter.lines[0].productId).toBe(HARINA);
    expect(status(afterEnter)).toBe("pending_doubtful");
    expect(pressEnter(initial, 0).next).toBe(0);
    expect(getInvoiceReviewBlockers(afterEnter)).toContain(COST_BLOCKER);
    expect(lineNeedMessages(afterEnter, afterEnter.lines[0]).join(" ")).toMatch(/último/);

    const acknowledged = run(afterEnter, ...ackMode("unit"));
    expect(status(acknowledged)).toBe("resolved");
    expect(getPendingCount(acknowledged)).toBe(0);
  });

  it("B · Galleta caja x6 (último 0,05): Por caja 0,50 y Por unidad 3,00 salen desviadas; cada una pide reconocerse", () => {
    const state = enter(build([galletaCaja()]));
    const line = state.lines[0];
    expect(getEntryModeOutcome(state, line, "pack")).toMatchObject({ unitCost: { amount: 0.5 }, deviates: true });
    expect(getEntryModeOutcome(state, line, "unit")).toMatchObject({ unitCost: { amount: 3 }, deviates: true });
    expect(status(state)).toBe("pending_doubtful");

    expect(status(run(state, ...ackMode("pack")))).toBe("resolved");
    expect(status(run(state, ...ackMode("unit")))).toBe("resolved");
  });

  it("C · confirmada por SKU (coherente) cambiada a unidad (0,30 frente a 0,05): deja de estar confirmada", () => {
    const initial = build([galletaSku()]);
    expect(status(initial)).toBe("confirmed_by_match");

    const changed = run(initial, chooseMode("unit"));
    expect(getEntryModeOutcome(changed, changed.lines[0], "unit")).toMatchObject({ unitCost: { amount: 0.3 }, deviates: true });
    expect(status(changed)).not.toBe("confirmed_by_match");
    expect(getReviewSections(changed).confirmed).toHaveLength(0);
  });

  it("C · confirmada que pasa a desviarse por la tasa: sale de las confirmadas y queda pendiente", () => {
    const changed = run(build([galletaSku()]), { type: "setRateChoice", choice: "manual", manualRate: 90 });
    expect(status(changed)).toBe("pending_doubtful");
    expect(getReviewSections(changed).confirmed).toHaveLength(0);
    expect(getInvoiceReviewBlockers(changed)).toContain(COST_BLOCKER);
  });

  it("D · sin tasa del día: tasa escrita 900 + IVA incluido (8,62 frente a 1,00) no se resuelve con Enter", () => {
    const initial = build([maltaSinTasa()], { taxRates: REVIEW_TAX_RATES }, { total: 9000, subtotal: 9000 });
    const withRate = run(
      initial,
      { type: "setRateChoice", choice: "manual", manualRate: 900 },
      { type: "setPricesIncludeTax", included: true },
    );
    const afterEnter = enter(withRate);
    const outcome = getEntryModeOutcome(afterEnter, afterEnter.lines[0], "unit");
    expect(outcome?.unitCost?.amount).toBeCloseTo(8.62, 2);
    expect(outcome?.deviates).toBe(true);
    expect(status(afterEnter)).toBe("pending_doubtful");
    // El aviso genérico «Sin tasa no se verificó…» ya no aplica: hay tasa y el cliente lo verificó.
    const issueTexts = getDisplayedLineIssues(afterEnter, afterEnter.lines[0]).map((issue) => issue.text);
    expect(issueTexts).not.toContain(NO_RATE_PRICE_ISSUE);
    expect(lineNeedMessages(afterEnter, afterEnter.lines[0]).join(" ")).toMatch(/8,62/);

    expect(status(run(afterEnter, ...ackMode("unit")))).toBe("resolved");
  });

  it.each([0, 1])("E · homónimos 6.9 a 10×: al elegir el candidato %i no se resuelve sin reconocer", (position) => {
    const initial = build([homonimos()]);
    const productId = initial.lines[0].candidates[position].productId;
    const chosen = run(initial, { type: "acceptCandidate", index: 0, productId });
    expect(status(chosen)).toBe("pending_doubtful");
    expect(status(run(chosen, ...ackMode("unit")))).toBe("resolved");
  });
});

describe("REP9-02 · M-p9-1: el último costo es el del producto elegido, no el del propuesto", () => {
  it("cambiar a Harina Mary (buscador, último 0,84): mientras se consulta no se resuelve; luego Por unidad 20,71 sale desviada", () => {
    const initial = build([harinaPanBulto()], PAN_RATE);
    const chosen = run(initial, { type: "chooseProduct", index: 0, product: { productId: MARY, name: "Harina Mary 900g" } });
    expect(status(chosen)).toBe("pending_doubtful");
    expect(getInvoiceReviewBlockers(chosen).join(" ")).toMatch(/Consultando el costo previo/);

    const looked = run(chosen, { type: "setLastUnitCost", index: 0, productId: MARY, result: 0.84 });
    const unit = getEntryModeOutcome(looked, looked.lines[0], "unit");
    expect(unit?.unitCost?.amount).toBeCloseTo(20.71, 2);
    expect(unit).toMatchObject({ lastUnitCostRef: 0.84, deviates: true });
    // Por bulto 1,04 frente a 0,84 (24 %): coherente, la línea queda resuelta en bulto.
    expect(getEntryModeOutcome(looked, looked.lines[0], "pack")).toMatchObject({ lastUnitCostRef: 0.84, deviates: false });
    expect(status(looked)).toBe("resolved");

    // Al cambiar a Por unidad con el clic queda reconocida; cualquier otra vía hacia unidad pediría reconocerla.
    expect(status(run(looked, ...ackMode("unit")))).toBe("resolved");
  });

  it("chip del 2.º candidato Malta Polar (último 2,17): Por bulto 0,79 sale desviada y la línea pide reconocerla", () => {
    const initial = build([maltaM04()], M04_RATE);
    const first = initial.lines[0];
    expect(getEntryModeOutcome(initial, first, "pack")).toMatchObject({ lastUnitCostRef: 1.6, deviates: true });

    const polar = run(initial, { type: "acceptCandidate", index: 0, productId: productUuid(11) });
    const pack = getEntryModeOutcome(polar, polar.lines[0], "pack");
    expect(pack?.unitCost?.amount).toBeCloseTo(0.79, 2);
    expect(pack).toMatchObject({ lastUnitCostRef: 2.17, deviates: true });
    expect(status(polar)).toBe("pending_doubtful");
    expect(status(run(polar, ...ackMode("pack")))).toBe("resolved");
  });
});

describe("REP9-02 · vías de emparejamiento", () => {
  it("alias confirmado y desviado: no entra como confirmada; reconocido, queda resuelta fuera del grupo de confirmadas", () => {
    const initial = build([
      harinaByName({
        status: "confirmed",
        productId: HARINA,
        candidates: [{ productId: HARINA, name: "CAOSG Harina Maiz 1kg", score: 1, reason: "alias visto 3 veces", lastUnitCostRef: 0.5 }],
      }),
    ]);
    expect(status(initial)).toBe("pending_doubtful");
    expect(getReviewSections(initial).confirmed).toHaveLength(0);
    expect(getInvoiceReviewBlockers(initial)).toContain(COST_BLOCKER);

    const acknowledged = run(initial, ...ackMode("unit"));
    expect(status(acknowledged)).toBe("resolved");
    expect(getReviewSections(acknowledged).confirmed).toHaveLength(0);
  });

  it("propuesto por el emparejamiento (dudosa con productId) y desviado: Enter no lo resuelve", () => {
    const state = enter(build([harinaByName({ productId: HARINA })]));
    expect(status(state)).toBe("pending_doubtful");
  });

  describe("buscador (producto fuera de los candidatos)", () => {
    const pick = (state: InvoiceReviewState) =>
      run(state, { type: "chooseProduct", index: 0, product: { productId: BUSCADO, name: "Harina buscada" } });

    it("en curso: no queda resuelta y Enter tampoco la resuelve", () => {
      const state = pick(build([harinaByName()]));
      expect(state.lines[0].lastCostLookup).toEqual({ productId: BUSCADO, status: "loading" });
      expect(status(state)).toBe("pending_doubtful");
      expect(status(enter(state))).toBe("pending_doubtful");
    });

    it("con costo coherente (5,00): se resuelve sin pedir nada", () => {
      const state = run(pick(build([harinaByName()])), { type: "setLastUnitCost", index: 0, productId: BUSCADO, result: 5 });
      expect(status(state)).toBe("resolved");
    });

    it("con costo desviado (0,50): pide reconocerlo", () => {
      const state = run(pick(build([harinaByName()])), { type: "setLastUnitCost", index: 0, productId: BUSCADO, result: 0.5 });
      expect(status(state)).toBe("pending_doubtful");
      expect(getEntryModeOutcome(state, state.lines[0], "unit")).toMatchObject({ lastUnitCostRef: 0.5, deviates: true });
      expect(status(run(state, ...ackMode("unit")))).toBe("resolved");
    });

    it("sin costo previo (null): «sin costo previo» y sin bloqueo", () => {
      const state = run(pick(build([harinaByName()])), { type: "setLastUnitCost", index: 0, productId: BUSCADO, result: null });
      expect(status(state)).toBe("resolved");
      expect(getEntryModeOutcome(state, state.lines[0], "unit")).toMatchObject({ lastCost: "none", deviates: false });
    });

    it("consulta fallida: lo dice y exige el reconocimiento explícito", () => {
      const state = run(pick(build([harinaByName()])), { type: "setLastUnitCost", index: 0, productId: BUSCADO, result: "error" });
      expect(status(state)).toBe("pending_doubtful");
      expect(lineNeedMessages(state, state.lines[0]).join(" ")).toMatch(/No se pudo consultar el costo previo/);
      expect(status(run(state, ...ackMode("unit")))).toBe("resolved");
    });

    it("una respuesta para otro producto (el usuario ya cambió) se ignora", () => {
      const state = run(
        pick(build([harinaByName()])),
        { type: "chooseProduct", index: 0, product: { productId: productUuid(501), name: "Otra" } },
        { type: "setLastUnitCost", index: 0, productId: BUSCADO, result: 5 },
      );
      expect(state.lines[0].lastCostLookup).toEqual({ productId: productUuid(501), status: "loading" });
      expect(status(state)).toBe("pending_doubtful");
    });

    it("elegir en el buscador un producto que ya es candidato usa su último costo sin consultar", () => {
      const state = run(build([harinaByName()]), {
        type: "chooseProduct",
        index: 0,
        product: { productId: HARINA, name: "CAOSG Harina Maiz 1kg" },
      });
      expect(state.lines[0].lastCostLookup).toBeUndefined();
      expect(status(state)).toBe("pending_doubtful");
    });
  });

  it("alta (producto recién creado): sin costo previo, se resuelve sin pedir nada", () => {
    const state = run(build([harinaByName()]), {
      type: "chooseProduct",
      index: 0,
      product: { productId: productUuid(600), name: "Harina nueva" },
      created: true,
    });
    expect(status(state)).toBe("resolved");
    expect(getEntryModeOutcome(state, state.lines[0], "unit")).toMatchObject({ lastCost: "none", deviates: false });
  });

  it("factura en dólares aceptada (5 USD = 5 REF frente a 0,50): pide reconocer", () => {
    const state = run(
      build([harinaByName({}, 5)], RATE_900, { currency: "USD" }),
      { type: "acceptUsdAnomaly" },
      { type: "acceptMarked", index: 0 },
    );
    expect(getEntryModeOutcome(state, state.lines[0], "unit")).toMatchObject({ unitCost: { amount: 5, currency: "REF" }, deviates: true });
    expect(status(state)).toBe("pending_doubtful");
    expect(status(run(state, ...ackMode("unit")))).toBe("resolved");
  });
});

describe("REP9-02 · el reconocimiento queda ligado a (producto, modo, unidades por empaque, costo REF)", () => {
  const acknowledged = () => run(enter(build([harinaByName()])), ...ackMode("unit"));

  it("cambio de tasa que sigue desviado lo invalida; a una coherente, resuelve sola", () => {
    expect(status(run(acknowledged(), { type: "setRateChoice", choice: "manual", manualRate: 450 }))).toBe("pending_doubtful");
    expect(status(run(acknowledged(), { type: "setRateChoice", choice: "manual", manualRate: 9000 }))).toBe("resolved");
  });

  it("cambio de costo: a un valor aún desviado no resuelve (ni cuenta como reconocer); a uno coherente, sí", () => {
    const pending = enter(build([harinaByName()]));
    expect(status(run(pending, { type: "editUnitPrice", index: 0, unitPrice: 4000 }))).toBe("pending_doubtful");
    expect(status(run(pending, { type: "editUnitPrice", index: 0, unitPrice: 450 }))).toBe("resolved");
    expect(status(run(acknowledged(), { type: "editUnitPrice", index: 0, unitPrice: 4600 }))).toBe("pending_doubtful");
  });

  it("cambio de unidades por empaque que sigue desviado lo invalida", () => {
    const packAck = run(enter(build([galletaCaja()])), ...ackMode("pack"));
    expect(status(packAck)).toBe("resolved");
    expect(status(run(packAck, { type: "editUnitsPerPack", index: 0, unitsPerPack: 12 }))).toBe("pending_doubtful");
  });

  it("cambio de modo por otra vía que el clic (Cargar como N unidades) lo invalida", () => {
    const half: ReviewFixtureLine = {
      ...galletaCaja(),
      read: { ...galletaCaja().read, quantity: 0.5, lineTotal: 1350 },
    };
    const packAck = run(enter(build([half])), ...ackMode("pack"));
    const converted = run(packAck, { type: "convertPackToUnits", index: 0 });
    expect(converted.lines[0].entryMode).toBe("unit");
    expect(status(converted)).toBe("pending_doubtful");
  });

  it("cambio de producto lo invalida (otro candidato desviado)", () => {
    const initial = build([homonimos()]);
    const [first, second] = initial.lines[0].candidates;
    const ack = run(initial, { type: "acceptCandidate", index: 0, productId: first.productId }, ...ackMode("unit"));
    expect(status(ack)).toBe("resolved");
    expect(status(run(ack, { type: "acceptCandidate", index: 0, productId: second.productId }))).toBe("pending_doubtful");
  });

  it("cambiar la cantidad o descartar otra línea no lo invalida", () => {
    const two = run(enter(build([harinaByName(), harinaByName({}, 450)])), ...ackMode("unit"));
    expect(status(two)).toBe("resolved");
    expect(status(run(two, { type: "editQuantity", index: 0, quantity: 3 }))).toBe("resolved");
    expect(status(run(two, { type: "discardLine", index: 1 }))).toBe("resolved");
  });

  it("al reanudar (estado nuevo desde la misma respuesta) vuelve a pedirse: nunca se resuelve en silencio", () => {
    const response = makeReviewResponse({ lines: [harinaByName({ status: "confirmed", productId: HARINA })] });
    const resumed = createInvoiceReviewState(response, RATE_900);
    expect(status(resumed)).toBe("pending_doubtful");
  });
});

describe("REP9-02 · coherentes (≤ 40 %) se resuelven sin pedir nada", () => {
  it("por nombre a 0,50 frente a 0,50: Enter la resuelve", () => {
    expect(status(enter(build([harinaByName({}, 450)])))).toBe("resolved");
  });

  it("desvío del 40 % justo no bloquea (4.500 → 0,70 frente a 0,50 = 40 %)", () => {
    expect(status(enter(build([harinaByName({}, 630)])))).toBe("resolved");
  });

  it("confirmada coherente sigue confirmada", () => {
    expect(status(build([galletaSku()]))).toBe("confirmed_by_match");
  });

  it("sin costo previo en el candidato: «sin costo previo», Enter la resuelve", () => {
    const state = enter(
      build([
        harinaByName({
          lastUnitCostRef: undefined,
          candidates: [{ productId: HARINA, name: "CAOSG Harina Maiz 1kg", score: 1, reason: "nombre parecido 1,00" }],
        }),
      ]),
    );
    expect(status(state)).toBe("resolved");
    expect(getEntryModeOutcome(state, state.lines[0], "unit")).toMatchObject({ lastCost: "none", deviates: false });
  });
});
