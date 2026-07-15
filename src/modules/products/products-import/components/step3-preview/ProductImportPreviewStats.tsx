"use client";

import { AlertCircle, CheckCircle } from "lucide-react";

type ProductImportPreviewStatsProps = {
  errorCount: number;
  importableCount: number;
  onViewErrors?: () => void;
  warningCount: number;
};

export function ProductImportPreviewStats({
  errorCount,
  importableCount,
  onViewErrors,
  warningCount,
}: ProductImportPreviewStatsProps) {
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      <div className="relative flex items-center gap-4 overflow-hidden rounded-xl border border-outline-variant bg-surface p-6 shadow-sm">
        <div
          aria-hidden
          className="pointer-events-none absolute top-0 right-0 h-full w-24 bg-gradient-to-l from-secondary-container/30 to-transparent"
        />
        <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-secondary-container text-on-secondary-container">
          <CheckCircle aria-hidden className="size-6" />
        </div>
        <div>
          <p className="text-3xl font-semibold tracking-tight text-on-surface">
            {importableCount}
          </p>
          <p className="text-sm text-on-surface-variant">Listos para importar</p>
          {warningCount > 0 ? (
            <p className="mt-1 text-xs text-on-surface-variant">
              Incluye {warningCount} con advertencia (SKU existente).
            </p>
          ) : null}
        </div>
      </div>
      <div className="relative flex items-center justify-between gap-4 overflow-hidden rounded-xl border border-error bg-surface p-6 shadow-sm">
        <div
          aria-hidden
          className="pointer-events-none absolute top-0 right-0 h-full w-24 bg-gradient-to-l from-error-container/30 to-transparent"
        />
        <div className="flex items-center gap-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-error-container text-error">
            <AlertCircle aria-hidden className="size-6" />
          </div>
          <div>
            <p className="text-3xl font-semibold tracking-tight text-error">
              {errorCount}
            </p>
            <p className="text-sm text-error">Filas con errores</p>
          </div>
        </div>
        {errorCount > 0 && onViewErrors ? (
          <button
            className="shrink-0 rounded border border-error px-3 py-1 text-xs font-medium text-error transition-colors hover:bg-error-container"
            onClick={onViewErrors}
            type="button"
          >
            Ver Errores
          </button>
        ) : null}
      </div>
    </div>
  );
}
