import { mockExchangeRates, mockPayments, mockSales } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import {
  computeFxDepreciationReport,
  type FxDepreciationReportResult,
} from "./fxDepreciationReport";
import { matchesStoreIds, normalizeStoreIds } from "./storeScope";
import { isUtcTimestampInCaracasDateRange } from "@/shared/utils/caracasBusinessDay";

function isWithinDateRange(createdAt: string, from?: string | null, to?: string | null) {
  return isUtcTimestampInCaracasDateRange(createdAt, from, to);
}

export function getFxDepreciationReport(
  searchParams: URLSearchParams,
  storeIdOrIds: string | string[],
): FxDepreciationReportResult {
  const storeIds = normalizeStoreIds(storeIdOrIds);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const sales = mockSales
    .filter(
      (sale) =>
        matchesStoreIds(sale.storeId, storeIds) &&
        sale.status !== "cancelada" &&
        isWithinDateRange(sale.createdAt, from, to),
    )
    .map((sale) => ({
      createdAt: sale.createdAt,
      id: sale.id,
      invoiceNumber: sale.invoiceNumber,
      refRateVes: sale.refRateVes,
      storeId: sale.storeId ?? DEFAULT_STORE_ID,
      totalRef: sale.totalRef,
    }));

  const saleIds = new Set(sales.map((sale) => sale.id));
  const payments = mockPayments
    .filter(
      (payment) =>
        (payment.status ?? "activo") === "activo" &&
        payment.saleId &&
        saleIds.has(payment.saleId) &&
        matchesStoreIds(payment.storeId, storeIds),
    )
    .map((payment) => ({
      amountRef: payment.amountRef,
      amountVes: payment.amountVes,
      method: payment.method,
      saleId: payment.saleId!,
      storeId: payment.storeId ?? DEFAULT_STORE_ID,
    }));

  const valuationRatesByStore: Record<string, { createdAt: string | null; rateVes: number }> =
    {};

  for (const storeId of storeIds) {
    const rates = mockExchangeRates
      .filter((rate) => matchesStoreIds(rate.storeId, [storeId]))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const latest = rates[0];
    valuationRatesByStore[storeId] = {
      createdAt: latest?.createdAt ?? null,
      rateVes: latest?.rateVes ?? 0,
    };
  }

  return computeFxDepreciationReport({
    generatedAt: "2026-08-16T06:00:00.000Z",
    payments,
    sales,
    searchParams,
    valuationRatesByStore,
  });
}
