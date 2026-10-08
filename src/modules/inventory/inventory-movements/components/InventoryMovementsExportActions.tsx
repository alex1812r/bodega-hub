"use client";

import { FileSpreadsheet, Loader2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/shared/components/Button";

import { exportMovementsToExcel } from "../services/exportMovementsExcel";
import type { MovementsExportFilters } from "../services/fetchMovementsForExport";

type InventoryMovementsExportActionsProps = {
  /** Motivo por el que no se puede exportar (p. ej. rango de fechas invertido). */
  disabledReason?: string;
  exportFilters: MovementsExportFilters;
};

export function InventoryMovementsExportActions({
  disabledReason,
  exportFilters,
}: InventoryMovementsExportActionsProps) {
  const [isExportingExcel, setIsExportingExcel] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  // La exportación se cortó en el tope de filas: el archivo se descargó, pero incompleto.
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  async function handleExportExcel() {
    setIsExportingExcel(true);
    setExportError(null);
    setExportNotice(null);

    try {
      setExportNotice(await exportMovementsToExcel(exportFilters));
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
        disabled={isExportingExcel || disabledReason !== undefined}
        onClick={() => void handleExportExcel()}
        size="sm"
        title={disabledReason}
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
      {exportNotice ? (
        <p className="max-w-xs text-xs text-on-surface-variant" role="status">
          {exportNotice}
        </p>
      ) : null}
    </div>
  );
}
