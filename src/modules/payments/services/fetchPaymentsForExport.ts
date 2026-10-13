import { fetchAllPaginatedItems } from "@/lib/api/fetchAllPaginatedItems";

import type { PaymentListItem, PaymentsFilters } from "../hooks/usePayments";

export type PaymentsExportFilters = Pick<
  PaymentsFilters,
  "contactId" | "direction" | "from" | "method" | "purchaseId" | "saleId" | "to"
>;

function pickExportQuery(filters: PaymentsExportFilters) {
  return {
    contactId: filters.contactId,
    direction: filters.direction,
    from: filters.from,
    method: filters.method,
    purchaseId: filters.purchaseId,
    saleId: filters.saleId,
    to: filters.to,
  };
}

/** Consulta la API en el momento de exportar (sin cache de UI). */
export async function fetchPaymentsForExport(
  filters: PaymentsExportFilters,
): Promise<PaymentListItem[]> {
  return fetchAllPaginatedItems<PaymentListItem>("/api/payments", pickExportQuery(filters));
}
