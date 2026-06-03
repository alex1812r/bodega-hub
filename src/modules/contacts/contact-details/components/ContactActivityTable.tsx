"use client";

import { Badge } from "@/shared/components/Badge";
import { DataTable, type DataTableColumn } from "@/shared/components/DataTable";
import { DetailSection } from "@/shared/components/DetailSection";
import { formatVes } from "@/shared/utils/currency";

export type ContactActivityRow = {
  amountVes: number;
  date: string;
  id: string;
  reference: string;
  type: "venta" | "compra" | "pago";
};

const columns: DataTableColumn<ContactActivityRow>[] = [
  { header: "Fecha", key: "date", render: (row) => row.date },
  {
    header: "Tipo",
    key: "type",
    render: (row) => <Badge variant="info">{row.type}</Badge>,
  },
  { header: "Referencia", key: "reference", render: (row) => row.reference },
  { header: "Monto VES", key: "amountVes", render: (row) => formatVes(row.amountVes) },
];

type ContactActivityTableProps = {
  error?: Error | string | null;
  isFetching?: boolean;
  isLoading?: boolean;
  onRetry?: () => void;
  rows: ContactActivityRow[];
};

export function ContactActivityTable({
  error,
  isFetching,
  isLoading,
  onRetry,
  rows,
}: ContactActivityTableProps) {
  return (
    <DetailSection
      description="Historial visual de operaciones asociadas al contacto."
      title="Actividad reciente"
    >
      <DataTable
        columns={columns}
        data={rows}
        error={error}
        getRowId={(row) => row.id}
        isFetching={isFetching}
        isLoading={isLoading}
        loadingRows={3}
        onRetry={onRetry}
      />
    </DetailSection>
  );
}
