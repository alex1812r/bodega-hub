"use client";

import { Loader2, XCircle } from "lucide-react";

import { Button } from "@/shared/components/Button";

import type { ProductImportProgress } from "../../types";
import { ProductImportCircularProgress } from "./ProductImportCircularProgress";

type ProductImportStep4ImportingProps = {
  onCancel: () => void;
  progress: ProductImportProgress;
};

export function ProductImportStep4Importing({
  onCancel,
  progress,
}: ProductImportStep4ImportingProps) {
  const percent =
    progress.total > 0 ? (progress.processed / progress.total) * 100 : 0;
  const currentLabel = progress.currentRow
    ? `Procesando fila ${progress.currentRow.rowIndex} de ${progress.total}...`
    : `Procesadas ${progress.processed} de ${progress.total}...`;

  return (
    <div className="flex flex-col">
      <div className="flex flex-col items-center justify-center rounded-xl border border-outline-variant bg-surface-container-lowest px-6 py-12">
        <ProductImportCircularProgress percent={percent} />
        <div className="space-y-2 text-center">
          <h2 className="text-lg font-semibold text-on-surface">
            Procesando registros...
          </h2>
          <p className="flex items-center justify-center gap-2 text-base text-on-surface-variant">
            <Loader2 aria-hidden className="size-5 animate-spin" />
            {currentLabel}
          </p>
          <p className="mx-auto mt-4 max-w-md text-sm text-outline">
            Por favor, no cierres esta ventana mientras se completa la operación.
            Esto puede tardar unos minutos dependiendo del tamaño del archivo.
          </p>
          <dl className="mt-6 grid w-full max-w-sm grid-cols-3 gap-3 text-center text-sm">
            <div>
              <dt className="text-outline">Total</dt>
              <dd className="font-semibold text-on-surface">{progress.total}</dd>
            </div>
            <div>
              <dt className="text-outline">Exitosas</dt>
              <dd className="font-semibold text-secondary">{progress.succeeded}</dd>
            </div>
            <div>
              <dt className="text-outline">Fallidas</dt>
              <dd className="font-semibold text-error">{progress.failed}</dd>
            </div>
          </dl>
        </div>
      </div>
      <div className="mt-6 flex justify-center sm:justify-end">
        <Button
          className="gap-2 border-error text-error hover:bg-error-container/20"
          onClick={onCancel}
          type="button"
          variant="outline"
        >
          <XCircle aria-hidden className="size-4" />
          Cancelar importación
        </Button>
      </div>
    </div>
  );
}
