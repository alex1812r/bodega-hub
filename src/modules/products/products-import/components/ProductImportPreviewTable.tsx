"use client";

import { Badge } from "@/shared/components/Badge";
import { DataTable, type DataTableColumn } from "@/shared/components/DataTable";

import type { ProductImportValidatedRow } from "../types";

const columns: DataTableColumn<ProductImportValidatedRow>[] = [
  {
    header: "Fila",
    key: "rowIndex",
    render: (row) => row.rowIndex,
  },
  {
    header: "SKU",
    key: "sku",
    render: (row) => row.sku,
  },
  {
    header: "Nombre",
    key: "name",
    render: (row) => row.name,
  },
  {
    header: "Estado",
    key: "status",
    render: (row) => (
      <Badge
        variant={
          row.status === "valid"
            ? "success"
            : row.status === "warning"
              ? "warning"
              : "danger"
        }
      >
        {row.status === "valid"
          ? "Valida"
          : row.status === "warning"
            ? "Advertencia"
            : "Error"}
      </Badge>
    ),
  },
  {
    header: "Mensajes",
    key: "messages",
    render: (row) => (
      <span className="text-sm text-slate-600 dark:text-slate-400">
        {row.messages.length > 0 ? row.messages.join(" ") : "Lista para importar"}
      </span>
    ),
  },
];

type ProductImportPreviewTableProps = {
  rows: ProductImportValidatedRow[];
};

export function ProductImportPreviewTable({ rows }: ProductImportPreviewTableProps) {
  return (
    <DataTable
      columns={columns}
      data={rows}
      emptyState="No hay filas para mostrar."
      getRowId={(row) => String(row.rowIndex)}
    />
  );
}
