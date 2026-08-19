import { listOpenCashSessions, listPendingClosures } from "@/modules/cash/services/cash.session.mock-server";
import { getDashboardMetrics } from "@/modules/dashboard/services/dashboard.mock-server";
import { getBusinessTodayIsoDate } from "@/modules/dashboard/utils/businessDate";
import { parseDashboardMetricsDateParams } from "@/modules/dashboard/utils/kpiPeriod";
import { getVault } from "@/modules/vault/services/vault.mock-server";

import { composeDailyCloseSummary, type DailyCloseSummary } from "./dailyCloseSummary";
import { getFxDepreciationReport } from "./fxDepreciationReport.mock-server";
import { getPaymentMethodsReport } from "./paymentMethodsReport.mock-server";
import { normalizeStoreIds } from "./storeScope";

function withDefaultOperationalDay(searchParams: URLSearchParams) {
  const { from, fromStart, to } = parseDashboardMetricsDateParams(searchParams);
  const next = new URLSearchParams(searchParams);

  if (fromStart) {
    next.delete("from");
    next.set("fromStart", "1");
    return next;
  }

  if (from || to) {
    return searchParams;
  }

  const today = getBusinessTodayIsoDate();
  next.set("from", today);
  next.set("to", today);
  return next;
}

export function getDailyCloseSummary(
  searchParams: URLSearchParams,
  storeIdOrIds: string | string[],
): DailyCloseSummary {
  const params = withDefaultOperationalDay(searchParams);
  const storeIds = normalizeStoreIds(storeIdOrIds);
  const primaryStoreId = storeIds[0]!;
  const { from, to } = parseDashboardMetricsDateParams(params);

  const sales = getDashboardMetrics(params, storeIds);
  const payments = getPaymentMethodsReport(params, storeIds);
  const fx = getFxDepreciationReport(params, storeIds);
  const singleStore = storeIds.length === 1;
  const vault = singleStore ? getVault(primaryStoreId) : null;
  const openSessions = singleStore ? listOpenCashSessions(primaryStoreId) : [];
  const pendingClosures = singleStore ? listPendingClosures(primaryStoreId) : [];

  return composeDailyCloseSummary({
    cash: singleStore
      ? {
          openSessions,
          pendingClosures,
        }
      : null,
    from: from ?? sales.from,
    fx: {
      capitalRefToday: fx.summary.capitalRefToday,
      depreciationPctOnVes: fx.summary.depreciationPctOnVes,
      usdHeldRef: fx.summary.usdHeldRef,
      valuationRateVes: fx.summary.valuationRateVes,
      vesExposed: fx.summary.vesExposed,
      vesLossRef: fx.summary.vesLossRef,
    },
    payments: payments.items,
    paymentsSummary: payments.summary,
    sales: {
      salesCount: sales.salesCount,
      totalRef: sales.totalRef,
      totalVes: sales.totalVes,
    },
    to: to ?? sales.to,
    vault: vault
      ? {
          balanceEfectivoVes: vault.balanceEfectivoVes,
          balanceRef: vault.balanceRef,
          balanceVes: vault.balanceVes,
        }
      : null,
  });
}
