import { fetchAllPaginatedItems } from "@/lib/api/fetchAllPaginatedItems";

import type { InventoryFilters } from "../hooks/useInventory";
import type { InventoryOverviewItem } from "./inventoryOverview";

/** Los filtros de la lista, sin página ni tamaño: la exportación trae todas las filas. */
export type InventoryExportFilters = Pick<
  InventoryFilters,
  "categoryId" | "lowStock" | "maxPriceRef" | "minPriceRef" | "search" | "stockStatus"
>;

function pickExportQuery(filters: InventoryExportFilters) {
  return {
    categoryId: filters.categoryId,
    lowStock: filters.lowStock,
    maxPriceRef: filters.maxPriceRef,
    minPriceRef: filters.minPriceRef,
    search: filters.search,
    stockStatus: filters.stockStatus,
  };
}

/** Consulta la API en el momento de exportar (sin cache de UI). */
export async function fetchInventoryForExport(
  filters: InventoryExportFilters,
): Promise<InventoryOverviewItem[]> {
  return fetchAllPaginatedItems<InventoryOverviewItem>(
    "/api/inventory",
    pickExportQuery(filters),
  );
}
