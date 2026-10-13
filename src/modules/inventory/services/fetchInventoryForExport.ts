import type { InventoryFilters } from "../hooks/useInventory";
import { type ExportRows, fetchExportRows, formatExportCount } from "./fetchExportRows";
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

/**
 * Consulta la API en el momento de exportar (sin cache de UI). Sin filas
 * repetidas y con tope (`EXPORT_MAX_ROWS`): ver `fetchExportRows`.
 */
export async function fetchInventoryForExport(
  filters: InventoryExportFilters,
): Promise<ExportRows<InventoryOverviewItem>> {
  return fetchExportRows<InventoryOverviewItem>("/api/inventory", pickExportQuery(filters));
}

/** Aviso para el usuario cuando la exportación se cortó en el tope; `null` si salió entera. */
export function describeInventoryExportLimit(result: ExportRows<InventoryOverviewItem>) {
  return result.truncated
    ? `Se exportaron los primeros ${formatExportCount(result.rows.length)} productos de ${formatExportCount(result.total)}. Acota los filtros para exportar el resto.`
    : null;
}
