import { fetchAllPaginatedItems } from "@/lib/api/fetchAllPaginatedItems";

import type { SaleListItem, SalesFilters } from "../hooks/useSales";

export type SalesExportFilters = Pick<
  SalesFilters,
  "customerId" | "from" | "search" | "status" | "to"
>;

function pickSalesExportQuery(filters: SalesExportFilters) {
  return {
    customerId: filters.customerId,
    from: filters.from,
    search: filters.search,
    status: filters.status,
    to: filters.to,
  };
}

/** Consulta la API en el momento de exportar (sin cache de UI). */
export async function fetchSalesForExport(
  filters: SalesExportFilters,
): Promise<SaleListItem[]> {
  return fetchAllPaginatedItems<SaleListItem>("/api/sales", pickSalesExportQuery(filters));
}
