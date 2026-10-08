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

export function buildPaymentsExportContextLabel(filters: PaymentsExportFilters) {
  const parts = ["Listado de pagos"];

  if (filters.contactId?.trim()) {
    parts.push(`Contacto: ${filters.contactId.trim()}`);
  }

  if (filters.saleId?.trim()) {
    parts.push(`Venta: ${filters.saleId.trim()}`);
  }

  if (filters.purchaseId?.trim()) {
    parts.push(`Compra: ${filters.purchaseId.trim()}`);
  }

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
