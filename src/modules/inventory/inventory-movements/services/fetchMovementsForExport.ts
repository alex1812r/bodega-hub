import type {
  InventoryMovement,
  InventoryMovementFilters,
} from "../../hooks/useInventory";
import {
  type ExportRows,
  fetchExportRows,
  formatExportCount,
} from "../../services/fetchExportRows";

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

/**
 * Consulta la API en el momento de exportar (sin cache de UI). Sin filas
 * repetidas y con tope (`EXPORT_MAX_ROWS`): ver `fetchExportRows`. La lista va
 * del más reciente al más antiguo, así que un corte deja fuera los más viejos;
 * los movimientos registrados mientras se exporta pueden no salir.
 */
export async function fetchMovementsForExport(
  filters: MovementsExportFilters,
): Promise<ExportRows<InventoryMovement>> {
  return fetchExportRows<InventoryMovement>(
    "/api/inventory/movements",
    pickMovementsQuery(filters),
  );
}

/** Aviso para el usuario cuando la exportación se cortó en el tope; `null` si salió entera. */
export function describeMovementsExportLimit(result: ExportRows<InventoryMovement>) {
  return result.truncated
    ? `Se exportaron los ${formatExportCount(result.rows.length)} movimientos más recientes de ${formatExportCount(result.total)}. Acota el rango de fechas para exportar el resto.`
    : null;
}
