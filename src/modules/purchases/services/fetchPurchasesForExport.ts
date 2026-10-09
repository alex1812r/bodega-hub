import { fetchAllPaginatedItems } from "@/lib/api/fetchAllPaginatedItems";

import type { PurchaseListRow, PurchasesFilters } from "../hooks/usePurchases";

export type PurchasesExportFilters = Pick<
  PurchasesFilters,
  "from" | "pendingBalance" | "search" | "status" | "supplierId" | "to"
>;

function pickExportQuery(filters: PurchasesExportFilters) {
  return {
    from: filters.from,
    pendingBalance: filters.pendingBalance,
    search: filters.search,
    status: filters.status,
    supplierId: filters.supplierId,
    to: filters.to,
  };
}

/** Consulta la API en el momento de exportar (sin cache de UI). */
export async function fetchPurchasesForExport(
  filters: PurchasesExportFilters,
): Promise<PurchaseListRow[]> {
  return fetchAllPaginatedItems<PurchaseListRow>("/api/purchases", pickExportQuery(filters));
}
