"use client";

import { FileText, RotateCcw } from "lucide-react";

import { Button } from "@/shared/components/Button";
import { PageBackButton } from "@/shared/components/PageBackButton";
import { DataTable, type DataTableColumn } from "@/shared/components/DataTable";

import type { ProductImportRowResult } from "../../types";
import { ProductImportValidationStatusBadge } from "../shared/ProductImportValidationStatusBadge";
import { ProductImportSummaryMetrics } from "./ProductImportSummaryMetrics";

const errorColumns: DataTableColumn<ProductImportRowResult>[] = [
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
    header: "Estado",
    key: "status",
    render: (row) => (
      <ProductImportValidationStatusBadge
        status={row.status === "success" ? "valid" : "error"}
      />
    ),
  },
  {
    header: "Detalle",
    key: "error",
    render: (row) => row.error ?? "—",
  },
];

type ProductImportStep5SummaryProps = {
  cancelled?: boolean;
  onDownloadLog: () => void;
  onReset: () => void;
  results: ProductImportRowResult[];
};

export function ProductImportStep5Summary({
  cancelled = false,
  onDownloadLog,
  onReset,
  results,
}: ProductImportStep5SummaryProps) {
  const created = results.filter((row) => row.status === "success").length;
  const errors = results.filter((row) => row.status === "failed").length;
  const skipped = results.filter((row) => row.status === "skipped").length;
  const failedRows = results.filter((row) => row.status !== "success");

  return (
    <>
      <ProductImportSummaryMetrics
        cancelled={cancelled}
        created={created}
        errors={errors}
        skipped={skipped}
      />
      {failedRows.length > 0 ? (
        <div className="mb-8 overflow-hidden rounded-xl border border-outline-variant bg-surface shadow-sm">
          <div className="border-b border-outline-variant px-4 py-3">
            <h3 className="text-sm font-semibold text-on-surface">
              Detalle de filas con incidencias
            </h3>
          </div>
          <DataTable
            columns={errorColumns}
            data={failedRows}
            emptyState="Sin incidencias."
            getRowId={(row) => `${row.rowIndex}-${row.sku}`}
            variant="stitch-purchases"
          />
        </div>
      ) : null}
      <div className="flex flex-col items-stretch justify-end gap-4 border-t border-outline-variant pt-6 sm:flex-row sm:items-center">
        {results.length > 0 ? (
          <Button
            className="gap-2 sm:order-1"
            onClick={onDownloadLog}
            type="button"
            variant="outline"
          >
            <FileText aria-hidden className="size-4" />
            Ver log de errores
          </Button>
        ) : null}
        <PageBackButton
          className="gap-2 shadow-sm sm:order-2"
          href="/products"
          label="Volver a productos"
        />
        <Button
          className="gap-2 sm:order-0"
          onClick={onReset}
          type="button"
          variant="ghost"
        >
          <RotateCcw aria-hidden className="size-4" />
          Nueva importación
        </Button>
      </div>
    </>
  );
}

export function downloadProductImportResultsCsv(results: ProductImportRowResult[]) {
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
