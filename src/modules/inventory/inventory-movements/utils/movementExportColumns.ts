import type { StockMovementType } from "@/shared/mocks/erp-data";
import { formatDateTimeShort } from "@/shared/utils/date";

import { resolveMovementDocument, type MovementDocumentSource } from "./movementDocument";
import { getMovementTypeLabel } from "./movementTypeLabels";

export type MovementExportRow = MovementDocumentSource & {
  createdAt: string;
  product: string;
  productSku?: string;
  quantity: number;
  reason?: string;
  stockAfter: number;
  type: StockMovementType;
};

export type MovementExportColumn = {
  header: string;
  value: (row: MovementExportRow) => string | number;
};

function formatMovementQuantity(quantity: number) {
  return quantity > 0 ? `+${quantity}` : String(quantity);
}

function formatMovementReference(row: MovementExportRow) {
  if (row.saleId) {
    return row.saleId;
  }

  if (row.purchaseId) {
    return row.purchaseId;
  }

  return "—";
}

export const movementExportColumns: MovementExportColumn[] = [
  { header: "Fecha", value: (row) => formatDateTimeShort(row.createdAt) },
  { header: "Producto", value: (row) => row.product },
  { header: "SKU", value: (row) => row.productSku ?? "—" },
  { header: "Tipo", value: (row) => getMovementTypeLabel(row.type) },
  { header: "Cant.", value: (row) => formatMovementQuantity(row.quantity) },
  { header: "Saldo", value: (row) => row.stockAfter },
  { header: "Documento", value: (row) => resolveMovementDocument(row).label },
  { header: "Motivo", value: (row) => row.reason ?? "Sin motivo" },
  { header: "Referencia", value: formatMovementReference },
];
