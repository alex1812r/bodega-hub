import type { SaleStatus } from "@/shared/mocks/erp-data";
import { formatDateTimeShort } from "@/shared/utils/date";

import type { SaleListItem } from "../hooks/useSales";

export type SalesExportColumn = {
  header: string;
  value: (row: SaleListItem) => string | number;
};

const salesStatusLabels: Record<SaleStatus, string> = {
  borrador: "Borrador",
  cancelada: "Cancelada",
  devuelta: "Devuelta",
  pagada: "Pagada",
  pendiente_pago: "Pdte. Pago",
};

function formatInvoiceNumber(invoiceNumber: string) {
  return invoiceNumber.startsWith("#") ? invoiceNumber : `#${invoiceNumber}`;
}

export const salesExportColumns: SalesExportColumn[] = [
  {
    header: "N° Factura",
    value: (row) => formatInvoiceNumber(row.invoiceNumber),
  },
  {
    header: "Fecha y Hora",
    value: (row) => formatDateTimeShort(row.createdAt),
  },
  {
    header: "Cliente",
    value: (row) => row.customer?.name ?? row.customerId,
  },
  {
    header: "Estado",
    value: (row) => salesStatusLabels[row.status],
  },
  {
    header: "Total (REF)",
    value: (row) => row.totalRef,
  },
  {
    header: "Total (VES)",
    value: (row) => row.totalVes,
  },
  {
    header: "Pagado (VES)",
    value: (row) => row.paidVes,
  },
];
