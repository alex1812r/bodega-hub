"use client";

import { FileSpreadsheet, Loader2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/shared/components/Button";

import { exportMovementsToExcel } from "../services/exportMovementsExcel";
import type { MovementsExportFilters } from "../services/fetchMovementsForExport";

type InventoryMovementsExportActionsProps = {
  exportFilters: MovementsExportFilters;
};

export function InventoryMovementsExportActions({
  exportFilters,
}: InventoryMovementsExportActionsProps) {
  const [isExportingExcel, setIsExportingExcel] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  async function handleExportExcel() {
    setIsExportingExcel(true);
    setExportError(null);

    try {
      await exportMovementsToExcel(exportFilters);
    } catch (error) {
      setExportError(
        error instanceof Error
          ? error.message
          : "No se pudo exportar los movimientos a Excel.",
      );
    } finally {
      setIsExportingExcel(false);
    }
  }

  return (
    <div className="flex w-full flex-col gap-2 sm:w-auto">
      <Button
        className="w-full gap-2 border-outline-variant bg-surface-container-lowest hover:bg-surface-container-low sm:w-auto"
        disabled={isExportingExcel}
        onClick={() => void handleExportExcel()}
        size="sm"
        variant="outline"
      >
        {isExportingExcel ? (
          <Loader2 aria-hidden className="size-5 shrink-0 animate-spin" />
        ) : (
          <FileSpreadsheet aria-hidden className="size-5 shrink-0" />
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
