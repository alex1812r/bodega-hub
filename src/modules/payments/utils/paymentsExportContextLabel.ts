import type { PaymentsExportFilters } from "../services/fetchPaymentsForExport";

const directionLabels: Record<string, string> = {
  entrada: "Entrada",
  salida: "Salida",
};

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

  return parts.join(" | ");
}
