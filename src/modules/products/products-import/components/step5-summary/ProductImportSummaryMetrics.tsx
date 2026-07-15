import { CheckCircle, Copy, PackagePlus, Shield } from "lucide-react";

type ProductImportSummaryMetricsProps = {
  cancelled?: boolean;
  created: number;
  errors: number;
  skipped: number;
};

export function ProductImportSummaryMetrics({
  cancelled = false,
  created,
  errors,
  skipped,
}: ProductImportSummaryMetricsProps) {
  return (
    <div className="mb-8 overflow-hidden rounded-xl border border-outline-variant bg-surface shadow-sm">
      <div className="flex flex-col items-center border-b border-secondary-container bg-secondary-container/20 px-6 py-8 text-center">
        <div className="mb-4 flex size-16 items-center justify-center rounded-full bg-secondary-container">
          <CheckCircle
            aria-hidden
            className="size-8 text-on-secondary-container"
          />
        </div>
        <h3 className="text-xl font-semibold text-on-surface">
          {cancelled
            ? "Importación cancelada"
            : "¡Proceso finalizado exitosamente!"}
        </h3>
        <p className="mt-2 max-w-lg text-sm text-on-surface-variant">
          {cancelled
            ? "La operación se detuvo antes de completar todas las filas. Revisa el detalle a continuación."
            : "El archivo ha sido procesado y el catálogo de productos ha sido actualizado. A continuación se detalla el resultado."}
        </p>
      </div>
      <div className="grid grid-cols-1 gap-px bg-outline-variant md:grid-cols-3">
        <article className="flex flex-col items-center bg-surface p-6 text-center transition-colors hover:bg-surface-bright">
          <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-secondary-container/30">
            <PackagePlus aria-hidden className="size-5 text-secondary" />
          </div>
          <span className="text-3xl font-semibold text-secondary">{created}</span>
          <span className="mt-1 text-sm font-medium text-on-surface">
            Productos Creados
          </span>
          <span className="mt-1 text-xs text-outline">
            Añadidos al inventario activo
          </span>
        </article>
        <article className="flex flex-col items-center bg-surface p-6 text-center transition-colors hover:bg-surface-bright">
          <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-tertiary-container/30">
            <Copy aria-hidden className="size-5 text-tertiary" />
          </div>
          <span className="text-3xl font-semibold text-tertiary">{skipped}</span>
          <span className="mt-1 text-sm font-medium text-on-surface">
            Omitidos
          </span>
          <span className="mt-1 text-xs text-outline">Filas no importadas</span>
        </article>
        <article className="flex flex-col items-center bg-surface p-6 text-center transition-colors hover:bg-surface-bright">
          <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-surface-variant">
            <Shield aria-hidden className="size-5 text-outline" />
          </div>
          <span className="text-3xl font-semibold text-on-surface">{errors}</span>
          <span className="mt-1 text-sm font-medium text-on-surface">
            Errores Finales
          </span>
          <span className="mt-1 text-xs text-outline">
            Filas rechazadas al guardar
          </span>
        </article>
      </div>
    </div>
  );
}
