import type { PaymentMethodReportRow, PaymentMethodsReportSummary } from "./paymentMethodsReport";

export type DailyCloseSalesSnapshot = {
  salesCount: number;
  totalRef: number;
  totalVes: number;
};

export type DailyCloseFxSnapshot = {
  capitalRefToday: number;
  depreciationPctOnVes: number;
  usdHeldRef: number;
  valuationRateVes: number;
  vesExposed: number;
  vesLossRef: number;
};

export type DailyCloseVaultSnapshot = {
  balanceEfectivoVes: number;
  balanceRef: number;
  balanceVes: number;
} | null;

export type DailyCloseCashSnapshot = {
  openSessionCount: number;
  pendingClosureCount: number;
  pendingClosureRef: number;
  pendingClosureVes: number;
  theoreticalOpenRef: number;
  theoreticalOpenVes: number;
} | null;

export type DailyCloseSummary = {
  cash: DailyCloseCashSnapshot;
  from: string | null;
  fx: DailyCloseFxSnapshot;
  payments: PaymentMethodReportRow[];
  paymentsSummary: PaymentMethodsReportSummary;
  sales: DailyCloseSalesSnapshot;
  to: string | null;
  vault: DailyCloseVaultSnapshot;
};

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

export function composeDailyCloseSummary(input: {
  cash?: {
    openSessions: Array<{ theoreticalClosingRef?: number | null; theoreticalClosingVes?: number | null }>;
    pendingClosures: Array<{ closingRef?: number | null; closingVes?: number | null }>;
  } | null;
  from?: string | null;
  fx: DailyCloseFxSnapshot;
  payments: PaymentMethodReportRow[];
  paymentsSummary: PaymentMethodsReportSummary;
  sales: DailyCloseSalesSnapshot;
  to?: string | null;
  vault?: DailyCloseVaultSnapshot;
}): DailyCloseSummary {
  const cashInput = input.cash;
  const cash: DailyCloseCashSnapshot = cashInput
    ? {
        openSessionCount: cashInput.openSessions.length,
        pendingClosureCount: cashInput.pendingClosures.length,
        pendingClosureRef: roundMoney(
          cashInput.pendingClosures.reduce((sum, session) => sum + Number(session.closingRef ?? 0), 0),
        ),
        pendingClosureVes: roundMoney(
          cashInput.pendingClosures.reduce((sum, session) => sum + Number(session.closingVes ?? 0), 0),
        ),
        theoreticalOpenRef: roundMoney(
          cashInput.openSessions.reduce(
            (sum, session) => sum + Number(session.theoreticalClosingRef ?? 0),
            0,
          ),
        ),
        theoreticalOpenVes: roundMoney(
          cashInput.openSessions.reduce(
            (sum, session) => sum + Number(session.theoreticalClosingVes ?? 0),
            0,
          ),
        ),
      }
    : null;

  return {
    cash,
    from: input.from ?? null,
    fx: {
      capitalRefToday: roundMoney(input.fx.capitalRefToday),
      depreciationPctOnVes: roundMoney(input.fx.depreciationPctOnVes),
      usdHeldRef: roundMoney(input.fx.usdHeldRef),
      valuationRateVes: roundMoney(input.fx.valuationRateVes),
      vesExposed: roundMoney(input.fx.vesExposed),
      vesLossRef: roundMoney(input.fx.vesLossRef),
    },
    payments: input.payments,
    paymentsSummary: {
      paymentCount: input.paymentsSummary.paymentCount,
      totalRef: roundMoney(input.paymentsSummary.totalRef),
      totalVes: roundMoney(input.paymentsSummary.totalVes),
    },
    sales: {
      salesCount: input.sales.salesCount,
      totalRef: roundMoney(input.sales.totalRef),
      totalVes: roundMoney(input.sales.totalVes),
    },
    to: input.to ?? null,
    vault: input.vault
      ? {
          balanceEfectivoVes: roundMoney(input.vault.balanceEfectivoVes),
          balanceRef: roundMoney(input.vault.balanceRef),
          balanceVes: roundMoney(input.vault.balanceVes),
        }
      : null,
  };
}
