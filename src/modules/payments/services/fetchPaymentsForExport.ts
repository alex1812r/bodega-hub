import { fetchAllPaginatedItems } from "@/lib/api/fetchAllPaginatedItems";

import type { PaymentListItem, PaymentsFilters } from "../hooks/usePayments";

export type PaymentsExportFilters = Pick<
  PaymentsFilters,
  "contactId" | "direction" | "purchaseId" | "saleId"
>;

function pickExportQuery(filters: PaymentsExportFilters) {
  return {
    contactId: filters.contactId,
    direction: filters.direction,
    purchaseId: filters.purchaseId,
    saleId: filters.saleId,
  };
}

/** Consulta la API en el momento de exportar (sin cache de UI). */
export async function fetchPaymentsForExport(
  filters: PaymentsExportFilters,
): Promise<PaymentListItem[]> {
  return fetchAllPaginatedItems<PaymentListItem>("/api/payments", pickExportQuery(filters));
}
