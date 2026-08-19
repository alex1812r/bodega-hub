import { PAYMENT_METHODS } from "@/shared/payments/paymentMethods";

import { getDailyCloseSummary } from "./dailyCloseSummary.mock-server";
import { composeDailyCloseSummary } from "./dailyCloseSummary";

describe("composeDailyCloseSummary", () => {
  it("composes sales, payment mix, FX loss and real cash/vault snapshots", () => {
    const payments = PAYMENT_METHODS.map((method) => ({
      amountRef: method === "pago_movil" ? 10 : 0,
      amountVes: method === "pago_movil" ? 7000 : 0,
      method,
      paymentCount: method === "pago_movil" ? 2 : 0,
    }));

    const result = composeDailyCloseSummary({
      cash: {
        openSessions: [{ theoreticalClosingRef: 5.5, theoreticalClosingVes: 4000 }],
        pendingClosures: [{ closingRef: 2, closingVes: 1600 }],
      },
      from: "2026-08-16",
      fx: {
        capitalRefToday: 13.75,
        depreciationPctOnVes: 12.5,
        usdHeldRef: 5,
        valuationRateVes: 800,
        vesExposed: 7000,
        vesLossRef: 1.25,
      },
      payments,
      paymentsSummary: { paymentCount: 2, totalRef: 10, totalVes: 7000 },
      sales: { salesCount: 3, totalRef: 120.129, totalVes: 60000.4 },
      to: "2026-08-16",
      vault: { balanceEfectivoVes: 1500.1, balanceRef: 40.555, balanceVes: 8000 },
    });

    expect(result.sales).toEqual({ salesCount: 3, totalRef: 120.13, totalVes: 60000.4 });
    expect(result.paymentsSummary.paymentCount).toBe(2);
    expect(result.fx.vesLossRef).toBe(1.25);
    expect(result.fx.capitalRefToday).toBe(13.75);
    expect(result.vault).toEqual({
      balanceEfectivoVes: 1500.1,
      balanceRef: 40.56,
      balanceVes: 8000,
    });
    expect(result.cash).toEqual({
      openSessionCount: 1,
      pendingClosureCount: 1,
      pendingClosureRef: 2,
      pendingClosureVes: 1600,
      theoreticalOpenRef: 5.5,
      theoreticalOpenVes: 4000,
    });
  });

  it("omits cash and vault when those modules have no snapshot", () => {
    const result = composeDailyCloseSummary({
      cash: null,
      fx: {
        capitalRefToday: 0,
        depreciationPctOnVes: 0,
        usdHeldRef: 0,
        valuationRateVes: 0,
        vesExposed: 0,
        vesLossRef: 0,
      },
      payments: [],
      paymentsSummary: { paymentCount: 0, totalRef: 0, totalVes: 0 },
      sales: { salesCount: 0, totalRef: 0, totalVes: 0 },
      vault: null,
    });

    expect(result.cash).toBeNull();
    expect(result.vault).toBeNull();
  });
});

describe("getDailyCloseSummary mock", () => {
  it("omits vault and cash snapshots when more than one store is in scope", () => {
    const result = getDailyCloseSummary(
      new URLSearchParams("from=2026-05-18&to=2026-05-18"),
      ["store-a", "store-b"],
    );

    expect(result.cash).toBeNull();
    expect(result.vault).toBeNull();
    expect(result.payments).toHaveLength(5);
  });
});
