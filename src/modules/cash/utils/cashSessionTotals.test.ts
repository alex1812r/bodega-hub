import { computeCashCloseReview } from "./cashSessionTotals";

function review(overrides: Partial<Parameters<typeof computeCashCloseReview>[0]> = {}) {
  return computeCashCloseReview({
    alertVes: 0,
    countedRef: 20,
    countedVes: 1000,
    theoreticalRef: 20,
    theoreticalVes: 1000,
    ...overrides,
  });
}

describe("computeCashCloseReview (CNF-10)", () => {
  it("cuadrada: diferencia 0 en las dos monedas y nada que confirmar", () => {
    expect(review()).toEqual({
      needsConfirmation: false,
      ref: { amount: 0, counted: 20, kind: "even", theoretical: 20 },
      refShortageOverThreshold: false,
      ves: { amount: 0, counted: 1000, kind: "even", theoretical: 1000 },
      vesShortageOverThreshold: false,
    });
  });

  it("la diferencia es contado − teórico: negativa si falta, positiva si sobra", () => {
    expect(review({ countedVes: 900 }).ves).toEqual({
      amount: -100,
      counted: 900,
      kind: "shortage",
      theoretical: 1000,
    });
    expect(review({ countedRef: 22.5 }).ref).toEqual({
      amount: 2.5,
      counted: 22.5,
      kind: "surplus",
      theoretical: 20,
    });
  });

  it("trabaja en céntimos: ni 0,1 + 0,2 ni 1000,10 − 999,90 dejan restos de coma flotante", () => {
    expect(review({ countedVes: 0.3, theoreticalVes: 0.1 + 0.2 }).ves).toEqual({
      amount: 0,
      counted: 0.3,
      kind: "even",
      theoretical: 0.3,
    });
    expect(review({ countedVes: 999.9, theoreticalVes: 1000.1 }).ves.amount).toBe(-0.2);
  });

  it("con umbral 0 (por defecto) cualquier faltante en Bs confirma, hasta de un céntimo", () => {
    expect(review({ countedVes: 999.99 })).toEqual(
      expect.objectContaining({ needsConfirmation: true, vesShortageOverThreshold: true }),
    );
  });

  it("confirma solo si |faltante| SUPERA el umbral: igual al umbral no confirma", () => {
    expect(review({ alertVes: 100, countedVes: 950 }).needsConfirmation).toBe(false);
    expect(review({ alertVes: 100, countedVes: 900 }).needsConfirmation).toBe(false);
    expect(review({ alertVes: 100, countedVes: 899.99 }).needsConfirmation).toBe(true);
  });

  it("un sobrante nunca confirma, por grande que sea", () => {
    expect(review({ countedRef: 500, countedVes: 999999 })).toEqual(
      expect.objectContaining({
        needsConfirmation: false,
        refShortageOverThreshold: false,
        vesShortageOverThreshold: false,
      }),
    );
  });

  it("un faltante en REF confirma siempre: el umbral es en Bs y no lo tolera", () => {
    expect(review({ alertVes: 100000, countedRef: 19.99 })).toEqual(
      expect.objectContaining({
        needsConfirmation: true,
        refShortageOverThreshold: true,
        vesShortageOverThreshold: false,
      }),
    );
  });

  it.each([Number.NaN, -50, Number.POSITIVE_INFINITY])(
    "un umbral inválido (%s) se trata como 0: ante la duda, se confirma",
    (alertVes) => {
      expect(review({ alertVes, countedVes: 999 }).needsConfirmation).toBe(true);
    },
  );
});
