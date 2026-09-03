import {
  USD_BILLS,
  VES_BILLS,
  adjustDenominationCount,
  countDenominationBills,
  formatDenominationBreakdown,
  getBillsForCurrency,
  greedyBreakdown,
  maxDeliverableChange,
  minimumTenderAtLeast,
  suggestQuickTenders,
  sumDenominations,
  toDenominationsPayload,
} from "./denominations";

describe("denominations utils", () => {
  it("exposes the bills that really circulate", () => {
    expect(USD_BILLS).toEqual([1, 5, 10, 20, 50, 100]);
    expect(VES_BILLS).toEqual([10, 20, 50, 100, 200]);
    expect(getBillsForCurrency("USD")).toBe(USD_BILLS);
    expect(getBillsForCurrency("VES")).toBe(VES_BILLS);
  });

  it("sums and counts a denomination breakdown", () => {
    const counts = { 5: 2, 20: 1 };

    expect(sumDenominations(counts, USD_BILLS)).toBe(30);
    expect(countDenominationBills(counts, USD_BILLS)).toBe(3);
    expect(sumDenominations({}, USD_BILLS)).toBe(0);
    // Denominaciones que no existen en la moneda se ignoran.
    expect(sumDenominations({ 3: 4 }, USD_BILLS)).toBe(0);
  });

  it("adjusts counts and drops the entry at zero", () => {
    const one = adjustDenominationCount({}, 20, 1);
    expect(one).toEqual({ 20: 1 });

    const two = adjustDenominationCount(one, 20, 1);
    expect(two).toEqual({ 20: 2 });

    expect(adjustDenominationCount(two, 20, -2)).toEqual({});
    // Nunca baja de cero.
    expect(adjustDenominationCount({}, 20, -1)).toEqual({});
  });

  it("breaks an amount down largest-bill-first without ever overshooting", () => {
    const usd = greedyBreakdown(2.3, USD_BILLS);
    expect(usd.counts).toEqual({ 1: 2 });
    expect(usd.covered).toBe(2);
    expect(usd.remainder).toBe(0.3);

    const ves = greedyBreakdown(560.83, VES_BILLS);
    expect(ves.counts).toEqual({ 200: 2, 100: 1, 50: 1, 10: 1 });
    expect(ves.covered).toBe(560);
    expect(ves.remainder).toBe(0.83);

    expect(greedyBreakdown(0, USD_BILLS)).toEqual({
      counts: {},
      covered: 0,
      remainder: 0,
    });
    expect(greedyBreakdown(Number.NaN, USD_BILLS).covered).toBe(0);
  });

  it("finds the smallest buildable tender that covers the amount", () => {
    expect(minimumTenderAtLeast(2.3, USD_BILLS)).toEqual({
      counts: { 1: 3 },
      total: 3,
    });
    expect(minimumTenderAtLeast(6.5, USD_BILLS).total).toBe(7);
    expect(minimumTenderAtLeast(12, USD_BILLS)).toEqual({
      counts: { 10: 1, 1: 2 },
      total: 12,
    });
    expect(minimumTenderAtLeast(1842.7, VES_BILLS).total).toBe(1850);
    expect(minimumTenderAtLeast(560.83, VES_BILLS).total).toBe(570);
    expect(minimumTenderAtLeast(0, VES_BILLS)).toEqual({ counts: {}, total: 0 });
  });

  it("suggests up to three ascending quick tenders", () => {
    expect(suggestQuickTenders(2.3, USD_BILLS)).toEqual([3, 5, 10]);
    expect(suggestQuickTenders(5, USD_BILLS)).toEqual([5, 10, 20]);
    expect(suggestQuickTenders(12, USD_BILLS)).toEqual([12, 20, 50]);
    // Sin billetes mayores, escala en multiplos del billete mas grande.
    expect(suggestQuickTenders(250, USD_BILLS)).toEqual([250, 300, 400]);
    expect(suggestQuickTenders(1842.7, VES_BILLS)).toEqual([1850, 2000, 2200]);
    expect(suggestQuickTenders(0, USD_BILLS)).toEqual([]);
  });

  it("caps the change at what can really be handed over", () => {
    const change = maxDeliverableChange(560.83, VES_BILLS);
    expect(change.delivered).toBe(560);
    expect(change.rounding).toBe(0.83);
    expect(change.counts).toEqual({ 200: 2, 100: 1, 50: 1, 10: 1 });

    // Vuelto exacto: sin redondeo a favor de la gaveta.
    expect(maxDeliverableChange(550, VES_BILLS)).toEqual({
      counts: { 200: 2, 100: 1, 50: 1 },
      delivered: 550,
      rounding: 0,
    });
    // Menor al billete mas chico: no se puede devolver nada.
    expect(maxDeliverableChange(7, VES_BILLS)).toEqual({
      counts: {},
      delivered: 0,
      rounding: 7,
    });
  });

  it("formats a breakdown for the change summary", () => {
    expect(
      formatDenominationBreakdown({ 200: 2, 100: 1, 50: 1, 10: 1 }, VES_BILLS),
    ).toBe("200x2 + 100x1 + 50x1 + 10x1");
    expect(formatDenominationBreakdown({}, VES_BILLS)).toBe("");
  });

  it("builds the jsonb payload only when there are bills", () => {
    expect(toDenominationsPayload("USD", { 1: 3 })).toEqual({ USD: { "1": 3 } });
    expect(toDenominationsPayload("VES", { 200: 2, 100: 1 })).toEqual({
      VES: { "200": 2, "100": 1 },
    });
    expect(toDenominationsPayload("USD", {})).toBeNull();
    expect(toDenominationsPayload("USD", null)).toBeNull();
    expect(toDenominationsPayload("USD", { 1: 0 })).toBeNull();
  });
});
