"use client";

import { DataTable, type DataTableColumn } from "@/shared/components/DataTable";
import { DetailSection } from "@/shared/components/DetailSection";
import { formatRef } from "@/shared/utils/currency";

type PriceHistoryRow = {
  changedBy: string;
  date: string;
  id: string;
  newPriceRef: number;
  oldPriceRef: number;
  reason: string;
};

const columns: DataTableColumn<PriceHistoryRow>[] = [
  { header: "Fecha", key: "date", render: (row) => row.date },
  { header: "Anterior", key: "oldPriceRef", render: (row) => formatRef(row.oldPriceRef) },
  { header: "Nuevo", key: "newPriceRef", render: (row) => formatRef(row.newPriceRef) },
  { header: "Motivo", key: "reason", render: (row) => row.reason },
  { header: "Usuario", key: "changedBy", render: (row) => row.changedBy },
];

type ProductPriceHistoryTableProps = {
  rows: PriceHistoryRow[];
};

export function ProductPriceHistoryTable({ rows }: ProductPriceHistoryTableProps) {
  return (
    <DetailSection
      description="Historial visual de cambios de precio base en ref."
      title="Historial de precios"
    >
      <DataTable columns={columns} data={rows} getRowId={(row) => row.id} />
    </DetailSection>
  );
}
