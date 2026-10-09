import type { MovementsExportFilters } from "../services/fetchMovementsForExport";
import { movementDocumentKindOptions } from "./movementDocument";
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

/** `productName`: nombre del producto filtrado; sin él la cabecera cae al id. */
export function buildMovementsExportContextLabel(
  filters: MovementsExportFilters,
  productName?: string,
) {
  const parts = [formatDateRangeLabel(filters.from, filters.to)];

  if (filters.productId?.trim()) {
    parts.push(`Producto: ${productName?.trim() || filters.productId.trim()}`);
  }

  if (filters.type) {
    parts.push(`Tipo: ${getMovementTypeLabel(filters.type)}`);
  }

  const documentKind = movementDocumentKindOptions.find(
    (option) => option.value === filters.documentKind,
  );

  if (documentKind) {
    parts.push(`Tipo de documento: ${documentKind.label}`);
  }

  if (filters.document?.trim()) {
    parts.push(`Documento: ${filters.document.trim()}`);
  }

  return parts.join(" | ");
}
