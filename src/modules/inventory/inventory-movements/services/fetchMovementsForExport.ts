import { fetchAllPaginatedItems } from "@/lib/api/fetchAllPaginatedItems";

import type {
  InventoryMovement,
  InventoryMovementFilters,
} from "../../hooks/useInventory";

export type MovementsExportFilters = Pick<
  InventoryMovementFilters,
  "from" | "productId" | "to" | "type"
>;

function pickMovementsQuery(filters: MovementsExportFilters) {
  return {
    from: filters.from,
    productId: filters.productId,
    to: filters.to,
    type: filters.type,
  };
}

/** Consulta la API en el momento de exportar (sin cache de UI). */
export async function fetchMovementsForExport(
  filters: MovementsExportFilters,
): Promise<InventoryMovement[]> {
  return fetchAllPaginatedItems<InventoryMovement>(
    "/api/inventory/movements",
    pickMovementsQuery(filters),
  );
}
