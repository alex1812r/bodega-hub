import type { InventoryFilters } from "../../hooks/useInventory";
import {
  defaultInventorySidebarFilters,
  type InventorySidebarFilters,
} from "../components/InventoryFiltersSidebar";
import {
  serializeStockStatusFilter,
  type InventoryStockStatus,
} from "../../utils/inventoryStockStatus";

export function sidebarFiltersToQuery(
  filters: InventorySidebarFilters,
): Pick<InventoryFilters, "categoryId" | "search" | "stockStatus"> {
  const selectedStatuses = (
    Object.entries(filters.stockStatus) as Array<[InventoryStockStatus, boolean]>
  )
    .filter(([, enabled]) => enabled)
    .map(([status]) => status);

  return {
    categoryId: filters.categoryId,
    search: filters.search?.trim() || undefined,
    stockStatus: serializeStockStatusFilter(selectedStatuses),
  };
}

export function queryToSidebarFilters(
  query: Pick<InventoryFilters, "categoryId" | "search" | "stockStatus">,
): InventorySidebarFilters {
  const statuses = query.stockStatus?.split(",").filter(Boolean) as
    | InventoryStockStatus[]
    | undefined;

  const stockStatus = { ...defaultInventorySidebarFilters.stockStatus };

  if (statuses?.length) {
    for (const status of Object.keys(stockStatus) as InventoryStockStatus[]) {
      stockStatus[status] = statuses.includes(status);
    }
  }

  return {
    categoryId: query.categoryId,
    search: query.search,
    stockStatus,
  };
}
