import type { PurchaseStatus } from "@/shared/mocks/erp-data";
import { formatRefUsd } from "@/shared/utils/currency";
import { formatDateTimeShort } from "@/shared/utils/date";

import type { PurchaseListRow } from "../hooks/usePurchases";

export type PurchaseExportColumn<T> = {
  header: string;
  value: (row: T) => string | number;
};

const purchaseStatusLabels: Record<PurchaseStatus, string> = {
  cancelado: "Cancelado",
  devuelto: "Devuelto",
  pedido: "Pedido",
  recibido: "Recibido",
};

export function formatPurchaseNumberForExport(purchaseNumber: string) {
  if (purchaseNumber.startsWith("#")) {
    return purchaseNumber;
  }

  const normalized = purchaseNumber.replace(/^C-?/i, "");
  return `#C-${normalized}`;
}

export const purchasesListExportColumns: PurchaseExportColumn<PurchaseListRow>[] = [
  {
    header: "N° Compra",
    value: (row) => formatPurchaseNumberForExport(row.purchaseNumber),
  },
  {
    header: "Fecha",
    value: (row) => formatDateTimeShort(row.createdAt),
  },
  {
    header: "Proveedor",
    value: (row) => row.supplier?.name ?? row.supplierId,
  },
  {
    header: "Estado",
    value: (row) => purchaseStatusLabels[row.status],
  },
  {
    header: "Total (REF)",
    value: (row) => formatRefUsd(row.totalRef),
  },
];
