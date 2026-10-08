import { fetchAllPaginatedItems } from "@/lib/api/fetchAllPaginatedItems";

import type {
  InventoryMovement,
  InventoryMovementFilters,
} from "../../hooks/useInventory";

/** Los filtros del listado de movimientos: la exportación usa los mismos que la pantalla. */
export type MovementsExportFilters = Pick<
  InventoryMovementFilters,
  "document" | "documentKind" | "from" | "productId" | "to" | "type"
>;

function pickMovementsQuery(filters: MovementsExportFilters) {
  return {
    document: filters.document,
    documentKind: filters.documentKind,
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
