import type { PaymentMethod } from "@/shared/mocks/erp-data";
import { formatRefUsd, formatVesBs } from "@/shared/utils/currency";
import { formatDate } from "@/shared/utils/date";

import type { PaymentListItem } from "../hooks/usePayments";
import { getPaymentReference } from "../payments-list/utils/paymentReference";

export type PaymentsExportColumn<T = PaymentListItem> = {
  header: string;
  value: (row: T) => string | number;
};

const methodLabel: Record<PaymentMethod, string> = {
  efectivo_usd: "Efectivo USD",
  efectivo_ves: "Efectivo VES",
  pago_movil: "Pago móvil",
  punto_venta: "Punto de venta",
  transferencia: "Transferencia",
};

const directionLabel = {
  entrada: "Entrada",
  salida: "Salida",
} as const;

function formatContact(payment: PaymentListItem) {
  const name = payment.contact?.name ?? payment.contactId;
  const taxId = payment.contact?.taxId?.trim();

  return taxId ? `${name} (${taxId})` : name;
}

function resolveCurrency(payment: PaymentListItem) {
  return payment.currency ?? (payment.method === "efectivo_usd" ? "USD" : "VES");
}

export const paymentsListExportColumns: PaymentsExportColumn[] = [
  { header: "ID Pago", value: (row) => row.id },
  { header: "Contacto", value: formatContact },
  {
    header: "Referencia",
    value: (row) => getPaymentReference(row).fullValue,
  },
  { header: "Fecha", value: (row) => formatDate(row.createdAt) },
  { header: "Método", value: (row) => methodLabel[row.method] },
  { header: "Moneda", value: resolveCurrency },
  { header: "Monto REF", value: (row) => formatRefUsd(row.amountRef) },
  { header: "Monto VES", value: (row) => formatVesBs(row.amountVes) },
  { header: "Tipo", value: (row) => directionLabel[row.direction] },
];
