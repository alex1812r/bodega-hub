"use client";

import Link from "next/link";

import { Badge } from "@/shared/components/Badge";
import { Button } from "@/shared/components/Button";
import { DataTable, type DataTableColumn } from "@/shared/components/DataTable";

import type { ProductImportRowResult } from "../types";

const columns: DataTableColumn<ProductImportRowResult>[] = [
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
    header: "Resultado",
    key: "status",
    render: (row) => (
      <Badge
        variant={
          row.status === "success"
            ? "success"
            : row.status === "failed"
              ? "danger"
              : "default"
        }
      >
        {row.status === "success"
          ? "Creado"
          : row.status === "failed"
            ? "Fallo"
            : "Omitido"}
      </Badge>
    ),
  },
  {
    header: "Detalle",
    key: "error",
    render: (row) => row.error ?? "—",
  },
];

type ProductImportSummaryProps = {
  cancelled?: boolean;
  onReset: () => void;
  results: ProductImportRowResult[];
};

function downloadResultsCsv(results: ProductImportRowResult[]) {
  const header = "fila,sku,estado,error\n";
  const lines = results.map(
    (row) =>
      `${row.rowIndex},"${row.sku.replace(/"/g, '""')}",${row.status},"${(row.error ?? "").replace(/"/g, '""')}"`,
  );
  const blob = new Blob([header + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "importacion-productos-resultado.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}

export function ProductImportSummary({
  cancelled = false,
  onReset,
  results,
}: ProductImportSummaryProps) {
  const succeeded = results.filter((row) => row.status === "success").length;
  const failed = results.filter((row) => row.status === "failed").length;

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          {cancelled ? "Importacion cancelada" : "Importacion completada"}
        </h2>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          {succeeded} productos creados, {failed} filas con error.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button asChild variant="primary">
            <Link href="/products">Volver al listado</Link>
          </Button>
          {results.length > 0 ? (
            <Button onClick={() => downloadResultsCsv(results)} type="button" variant="outline">
              Descargar log CSV
            </Button>
          ) : null}
          <Button onClick={onReset} type="button" variant="ghost">
            Nueva importacion
          </Button>
        </div>
      </div>

      {failed > 0 ? (
        <DataTable
          columns={columns}
          data={results.filter((row) => row.status !== "success")}
          emptyState="Sin errores."
          getRowId={(row) => `${row.rowIndex}-${row.sku}`}
        />
      ) : null}
    </div>
  );
}
