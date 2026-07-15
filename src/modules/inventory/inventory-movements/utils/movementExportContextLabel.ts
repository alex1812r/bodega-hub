import type { MovementsExportFilters } from "../services/fetchMovementsForExport";
import { getMovementTypeLabel } from "./movementTypeLabels";

function formatDateRangeLabel(from?: string, to?: string) {
  const start = from?.trim();
  const end = to?.trim();

  if (start && end) {
    return `Periodo: ${start} a ${end}`;
  }

  if (start) {
    return `Desde: ${start}`;
  }

  if (end) {
    return `Hasta: ${end}`;
  }

  return "Sin filtro de periodo";
}

export function buildMovementsExportContextLabel(filters: MovementsExportFilters) {
  const parts = [formatDateRangeLabel(filters.from, filters.to)];

  if (filters.productId?.trim()) {
    parts.push(`Producto: ${filters.productId.trim()}`);
  }

  if (filters.type) {
    parts.push(`Tipo: ${getMovementTypeLabel(filters.type)}`);
  }

  return parts.join(" | ");
}
