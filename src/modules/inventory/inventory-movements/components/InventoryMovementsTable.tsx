"use client";

import { Badge } from "@/shared/components/Badge";
import { type ActionMenuItem } from "@/shared/components/ActionsMenu";
import { DataTable, type DataTableColumn } from "@/shared/components/DataTable";
import { EmptyState } from "@/shared/components/EmptyState";
import type { StockMovementType } from "@/shared/mocks/erp-data";

export type InventoryMovementRow = {
  date: string;
  id: string;
  product: string;
  quantity: number;
  reason?: string;
  stockAfter: number;
  type: StockMovementType;
};

const typeVariant = {
  ajuste_entrada: "success",
  ajuste_salida: "warning",
  compra: "success",
  devolucion_cliente: "success",
  devolucion_proveedor: "warning",
  inventario_inicial: "info",
  venta: "info",
} as const;

const columns: DataTableColumn<InventoryMovementRow>[] = [
  { header: "Fecha", key: "date", render: (row) => row.date },
  { header: "Producto", key: "product", render: (row) => row.product },
  {
    header: "Tipo",
    key: "type",
    render: (row) => <Badge variant={typeVariant[row.type]}>{row.type}</Badge>,
  },
  { header: "Cantidad", key: "quantity", render: (row) => row.quantity },
  { header: "Stock final", key: "stockAfter", render: (row) => row.stockAfter },
  { header: "Motivo", key: "reason", render: (row) => row.reason ?? "Sin motivo" },
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
      columns={columns}
      data={rows}
      emptyState={
        <EmptyState
          description="Selecciona otro producto o registra un ajuste manual."
          title="No hay movimientos para mostrar"
        />
      }
      error={error}
      getRowId={(row) => row.id}
      isFetching={isFetching}
      isLoading={isLoading}
      onRetry={onRetry}
    />
  );
}
