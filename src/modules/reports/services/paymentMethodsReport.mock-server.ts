import { mockPayments } from "@/shared/mocks/erp-data";

import {
  computePaymentMethodsReport,
  resolvePaymentMethodsReportRequest,
  splitPaymentsByPeriod,
  type PaymentMethodsReportResult,
} from "./paymentMethodsReport";
import { matchesStoreIds, normalizeStoreIds } from "./storeScope";

export function getPaymentMethodsReport(
  searchParams: URLSearchParams,
  storeIdOrIds: string | string[],
): PaymentMethodsReportResult {
  const storeIds = normalizeStoreIds(storeIdOrIds);
  const request = resolvePaymentMethodsReportRequest(searchParams);

  const { current, previous } = splitPaymentsByPeriod(
    mockPayments.filter(
      (payment) =>
        (payment.status ?? "activo") === "activo" &&
        Boolean(payment.saleId) &&
        matchesStoreIds(payment.storeId, storeIds),
    ),
    request,
  );

  return computePaymentMethodsReport({
    comparison: request.compare
      ? { payments: previous, previousRange: request.previousRange }
      : undefined,
    payments: current,
    searchParams,
  });
}
