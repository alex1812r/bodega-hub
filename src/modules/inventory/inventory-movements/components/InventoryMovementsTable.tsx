"use client";

import { type ActionMenuItem } from "@/shared/components/ActionsMenu";
import { DataTable, type DataTableColumn } from "@/shared/components/DataTable";
import { EmptyState } from "@/shared/components/EmptyState";
import type { StockMovementType } from "@/shared/mocks/erp-data";
import { formatDateTimeShort } from "@/shared/utils/date";

import { InventoryMovementQuantityCell } from "./InventoryMovementQuantityCell";
import { InventoryMovementReferenceCell } from "./InventoryMovementReferenceCell";
import { InventoryMovementTypeBadge } from "./InventoryMovementTypeBadge";
import { getMovementTypeLabel } from "../utils/movementTypeLabels";

const referenceCellClass = "min-w-0 w-[7rem] max-w-[7rem] overflow-hidden";
const referenceHeaderClass = "w-[7rem] max-w-[7rem]";

export type InventoryMovementRow = {
  createdAt: string;
  id: string;
  product: string;
  productSku?: string;
  purchaseId?: string;
  quantity: number;
  reason?: string;
  saleId?: string;
  stockAfter: number;
  type: StockMovementType;
};

const columns: DataTableColumn<InventoryMovementRow>[] = [
  {
    cellClassName: "whitespace-nowrap text-on-surface-variant",
    header: "Fecha",
    key: "createdAt",
    render: (row) => formatDateTimeShort(row.createdAt),
  },
  {
    header: "Producto",
    key: "product",
    render: (row) => (
      <div className="flex flex-col">
        <span className="font-medium text-foreground">{row.product}</span>
        {row.productSku ? (
          <span className="text-xs text-on-surface-variant md:hidden">
            SKU: {row.productSku}
          </span>
        ) : null}
      </div>
    ),
  },
  {
    cellClassName: "font-mono text-sm text-on-surface-variant",
    header: "SKU",
    hideInCard: true,
    key: "productSku",
    render: (row) => row.productSku ?? "—",
    visibility: "md",
  },
  {
    header: "Tipo",
    key: "type",
    render: (row) => <InventoryMovementTypeBadge type={row.type} />,
  },
  {
    align: "right",
    header: "Cant.",
    key: "quantity",
    render: (row) => <InventoryMovementQuantityCell quantity={row.quantity} />,
  },
  {
    align: "right",
    cellClassName: "font-semibold tabular-nums",
    header: "Stock final",
    key: "stockAfter",
    render: (row) => row.stockAfter,
  },
  {
    cellClassName: "max-w-[14rem] truncate text-on-surface-variant",
    header: "Motivo",
    key: "reason",
    render: (row) => row.reason ?? "Sin motivo",
    visibility: "lg",
  },
  {
    cellClassName: referenceCellClass,
    className: referenceHeaderClass,
    header: "Referencia",
    key: "reference",
    render: (row) => (
      <InventoryMovementReferenceCell purchaseId={row.purchaseId} saleId={row.saleId} />
    ),
    visibility: "md",
  },
];

type InventoryMovementsTableProps = {
  actions?: (row: InventoryMovementRow) => ActionMenuItem[];
  error?: Error | string | null;
  isFetching?: boolean;
  isLoading?: boolean;
  onRetry?: () => void;
  rows: InventoryMovementRow[];
};

export function InventoryMovementsTable({
  actions,
  error,
  isFetching,
  isLoading,
  onRetry,
  rows,
}: InventoryMovementsTableProps) {
  return (
    <DataTable
      actions={actions}
      cardSubtitle={(row) => getMovementTypeLabel(row.type)}
      cardTitle={(row) => row.product}
      columns={columns}
      data={rows}
      embedded
      emptyState={
        <EmptyState
          description="Ajusta los filtros o registra un ajuste manual de stock."
          title="No hay movimientos para mostrar"
        />
      }
      error={error}
      getRowId={(row) => row.id}
      isFetching={isFetching}
      isLoading={isLoading}
      onRetry={onRetry}
      variant="stitch-purchases"
    />
  );
}
