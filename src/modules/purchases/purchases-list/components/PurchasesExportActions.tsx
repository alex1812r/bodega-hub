"use client";

import { FileSpreadsheet, Loader2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/shared/components/Button";

import { exportPurchasesToExcel } from "../../services/exportPurchasesExcel";
import type { PurchasesExportFilters } from "../../services/fetchPurchasesForExport";

type PurchasesExportActionsProps = {
  exportFilters: PurchasesExportFilters;
};

export function PurchasesExportActions({ exportFilters }: PurchasesExportActionsProps) {
  const [isExportingExcel, setIsExportingExcel] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  async function handleExportExcel() {
    setIsExportingExcel(true);
    setExportError(null);

    try {
      await exportPurchasesToExcel(exportFilters);
    } catch (error) {
      setExportError(
        error instanceof Error
          ? error.message
          : "No se pudo exportar las compras a Excel.",
      );
    } finally {
      setIsExportingExcel(false);
    }
  }

  return (
    <div className="flex w-full flex-col gap-2 sm:w-auto">
      <Button
        className="gap-2 border-outline-variant bg-surface-container-lowest hover:bg-surface-container-low"
        disabled={isExportingExcel}
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
      {exportError ? (
        <p className="text-xs text-error" role="alert">
          {exportError}
        </p>
      ) : null}
    </div>
  );
}
