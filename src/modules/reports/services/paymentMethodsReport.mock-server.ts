import { parseDashboardMetricsDateParams } from "@/modules/dashboard/utils/kpiPeriod";
import { mockPayments } from "@/shared/mocks/erp-data";
import { isUtcTimestampInCaracasDateRange } from "@/shared/utils/caracasBusinessDay";

import {
  computePaymentMethodsReport,
  type PaymentMethodsReportResult,
} from "./paymentMethodsReport";
import { matchesStoreIds, normalizeStoreIds } from "./storeScope";

export function getPaymentMethodsReport(
  searchParams: URLSearchParams,
  storeIdOrIds: string | string[],
): PaymentMethodsReportResult {
  const storeIds = normalizeStoreIds(storeIdOrIds);
  const { from, to } = parseDashboardMetricsDateParams(searchParams);

  const payments = mockPayments.filter(
    (payment) =>
      (payment.status ?? "activo") === "activo" &&
      Boolean(payment.saleId) &&
      matchesStoreIds(payment.storeId, storeIds) &&
      isUtcTimestampInCaracasDateRange(payment.createdAt, from, to),
  );

  return computePaymentMethodsReport({
    payments,
    searchParams,
  });
}
