import { paymentMethodLabels } from "../payment-details/utils/paymentDetailLabels";
import type { PaymentsExportFilters } from "../services/fetchPaymentsForExport";

const directionLabels: Record<string, string> = {
  entrada: "Entrada",
  salida: "Salida",
};

/** `YYYY-MM-DD` (dia operativo Caracas) como `DD/MM/YYYY`, sin pasar por `Date`. */
function formatIsoDay(isoDate: string) {
  const [year, month, day] = isoDate.split("-");

  return `${day}/${month}/${year}`;
}

/**
 * Título del Excel. `filterLabels`: texto humano de los filtros por id (venta,
 * compra, contacto), los mismos de los chips de la lista. Un filtro por id sin
 * texto conocido no se menciona: el id nunca se escribe.
 */
export function buildPaymentsExportContextLabel(
  filters: PaymentsExportFilters,
  filterLabels: readonly string[] = [],
) {
  const parts = ["Listado de pagos", ...filterLabels];

  if (filters.direction) {
    parts.push(`Tipo: ${directionLabels[filters.direction] ?? filters.direction}`);
  }

  if (filters.method) {
    parts.push(`Método: ${paymentMethodLabels[filters.method]}`);
  }

  if (filters.from) {
    parts.push(`Desde: ${formatIsoDay(filters.from)}`);
  }

  if (filters.to) {
    parts.push(`Hasta: ${formatIsoDay(filters.to)}`);
  }

  return parts.join(" | ");
}
