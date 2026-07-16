"use client";

import { FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/shared/components/Button";

import type { ReportsExportFilters } from "../../services/fetchReportsForExport";
import { exportReportsToExcel } from "../../services/exportReportsExcel";
import { exportReportsToPdf } from "../../services/exportReportsPdf";

type ReportsExportActionsProps = {
  exportFilters: ReportsExportFilters;
};

export function ReportsExportActions({ exportFilters }: ReportsExportActionsProps) {
  const [isExportingExcel, setIsExportingExcel] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const isExporting = isExportingExcel || isExportingPdf;
  const exportDisabled =
    isExporting ||
    (exportFilters.scope?.pathPrefix === "/api/platform/reports" &&
      exportFilters.scope.enabled === false);


  async function handleExportExcel() {
    setIsExportingExcel(true);
    setExportError(null);

    try {
      await exportReportsToExcel(exportFilters);
    } catch (error) {
      setExportError(
        error instanceof Error
          ? error.message
          : "No se pudo exportar el reporte a Excel.",
      );
    } finally {
      setIsExportingExcel(false);
    }
  }

  async function handleExportPdf() {
    setIsExportingPdf(true);
    setExportError(null);

    try {
      await exportReportsToPdf(exportFilters);
    } catch (error) {
      setExportError(
        error instanceof Error ? error.message : "No se pudo exportar el reporte a PDF.",
      );
    } finally {
      setIsExportingPdf(false);
    }
  }

  return (
    <div className="flex w-full flex-col gap-2 sm:w-auto">
      <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap">
        <Button
          className="gap-2 border-outline-variant bg-surface-container-lowest hover:bg-surface-container-low"
          disabled={exportDisabled}
          onClick={() => void handleExportPdf()}
          variant="outline"
        >
          {isExportingPdf ? (
            <Loader2 aria-hidden className="size-[1.125rem] shrink-0 animate-spin" />
          ) : (
            <FileText aria-hidden className="size-[1.125rem] shrink-0" />
          )}
          {isExportingPdf ? "Exportando..." : "Exportar PDF"}
        </Button>
        <Button
          className="gap-2 border-outline-variant bg-surface-container-lowest hover:bg-surface-container-low"
          disabled={exportDisabled}
          onClick={() => void handleExportExcel()}
          variant="outline"
        >
          {isExportingExcel ? (
            <Loader2 aria-hidden className="size-[1.125rem] shrink-0 animate-spin" />
          ) : (
            <FileSpreadsheet aria-hidden className="size-[1.125rem] shrink-0" />
          )}
          {isExportingExcel ? "Exportando..." : "Exportar Excel"}
        </Button>
      </div>
      {exportError ? (
        <p className="text-xs text-error" role="alert">
          {exportError}
        </p>
      ) : null}
    </div>
  );
}
