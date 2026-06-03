"use client";

import { ProgressBar } from "@/shared/components/ProgressBar";

import type { ProductImportProgress } from "../types";

type ProductImportProgressPanelProps = {
  progress: ProductImportProgress;
};

export function ProductImportProgressPanel({ progress }: ProductImportProgressPanelProps) {
  const label = progress.currentRow
    ? `Importando fila ${progress.currentRow.rowIndex}: ${progress.currentRow.sku}`
    : `Procesadas ${progress.processed} de ${progress.total}`;

  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
      <ProgressBar
        label={label}
        max={progress.total}
        value={progress.processed}
      />
      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-slate-500 dark:text-slate-400">Total</dt>
          <dd className="font-medium text-slate-900 dark:text-slate-100">{progress.total}</dd>
        </div>
        <div>
          <dt className="text-slate-500 dark:text-slate-400">Exitosas</dt>
          <dd className="font-medium text-emerald-700 dark:text-emerald-300">
            {progress.succeeded}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500 dark:text-slate-400">Fallidas</dt>
          <dd className="font-medium text-red-700 dark:text-red-300">{progress.failed}</dd>
        </div>
      </dl>
    </div>
  );
}
