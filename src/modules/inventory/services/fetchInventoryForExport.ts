import { fetchAllPaginatedItems } from "@/lib/api/fetchAllPaginatedItems";

import type { InventoryFilters, InventoryItem } from "../hooks/useInventory";

export type InventoryExportFilters = Pick<
  InventoryFilters,
  "categoryId" | "search" | "stockStatus"
>;

function pickExportQuery(filters: InventoryExportFilters) {
  return {
    categoryId: filters.categoryId,
    search: filters.search,
    stockStatus: filters.stockStatus,
  };
}

/** Consulta la API en el momento de exportar (sin cache de UI). */
export async function fetchInventoryForExport(
  filters: InventoryExportFilters,
): Promise<InventoryItem[]> {
  return fetchAllPaginatedItems<InventoryItem>(
    "/api/inventory",
    pickExportQuery(filters),
  );
}
