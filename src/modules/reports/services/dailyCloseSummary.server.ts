import { listOpenCashSessions, listPendingClosures } from "@/modules/cash/services/cash.session.server";
import { getDashboardMetrics } from "@/modules/dashboard/services/dashboard.server";
import { parseDashboardMetricsDateParams } from "@/modules/dashboard/utils/kpiPeriod";
import { getCaracasIsoDate } from "@/shared/utils/caracasBusinessDay";
import { getVault } from "@/modules/vault/services/vault.server";

import { composeDailyCloseSummary, type DailyCloseSummary } from "./dailyCloseSummary";
import { getFxDepreciationReport } from "./fxDepreciationReport.server";
import { getPaymentMethodsReport } from "./paymentMethodsReport.server";
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

  const today = getCaracasIsoDate();
  next.set("from", today);
  next.set("to", today);
  return next;
}

export async function getDailyCloseSummary(
  searchParams: URLSearchParams,
  storeIdOrIds: string | string[],
  options?: { useAdmin?: boolean },
): Promise<DailyCloseSummary> {
  const params = withDefaultOperationalDay(searchParams);
  const storeIds = normalizeStoreIds(storeIdOrIds);
  const primaryStoreId = storeIds[0]!;
  const { from, to } = parseDashboardMetricsDateParams(params);

  const singleStore = storeIds.length === 1;
  const [sales, payments, fx, vault, openSessions, pendingClosures] = await Promise.all([
    getDashboardMetrics(params, storeIds, options),
    getPaymentMethodsReport(params, storeIds, options),
    getFxDepreciationReport(params, storeIds, options),
    singleStore ? getVault(primaryStoreId).catch(() => null) : Promise.resolve(null),
    singleStore ? listOpenCashSessions(primaryStoreId).catch(() => []) : Promise.resolve([]),
    singleStore ? listPendingClosures(primaryStoreId).catch(() => []) : Promise.resolve([]),
  ]);

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
