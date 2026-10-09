"use client";

import { Eye, Loader2 } from "lucide-react";
import { useState } from "react";

import { usePermission } from "@/shared/auth/usePermission";
import { Button } from "@/shared/components/Button";

import { captureChartImage, type ChartImage } from "../../services/captureChartImage";
import {
  fetchReportsForExport,
  type ReportsExportDataset,
  type ReportsExportFilters,
} from "../../services/fetchReportsForExport";
import { readReportsExportView } from "../../utils/reportExportView";
import { ReportsExportPreviewModal } from "./ReportsExportPreviewModal";

type ReportsExportActionsProps = {
  exportFilters: ReportsExportFilters;
};

/** Lo que se exporta: se fija al abrir la vista previa y no cambia hasta cerrarla. */
type ExportPreview = {
  chartImage: ChartImage | null;
  data: ReportsExportDataset;
  exportedAt: string;
  filters: ReportsExportFilters;
};

export function ReportsExportActions({ exportFilters }: ReportsExportActionsProps) {
  const { permissions, role } = usePermission();
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ExportPreview | null>(null);

  const exportDisabled =
    isLoadingPreview ||
    (exportFilters.scope?.pathPrefix === "/api/platform/reports" &&
      exportFilters.scope.enabled === false);

  async function openPreview() {
    setIsLoadingPreview(true);
    setPreviewError(null);

    try {
      const exportedAt = new Date().toISOString();
      // Por tienda, el reporte abierto y sus filtros salen de la URL (regla 15):
      // el archivo lleva el encabezado, el nombre y el gráfico de lo que se ve.
      // Plataforma (`scope`) exporta como siempre, sin imagen.
      const filters: ReportsExportFilters =
        exportFilters.scope || exportFilters.view
          ? exportFilters
          : {
              ...exportFilters,
              view: readReportsExportView(window.location.search, { permissions, role }),
            };
      // El gráfico se captura ahora, antes de que el modal lo tape.
      const [data, chartImage] = await Promise.all([
        fetchReportsForExport(filters),
        filters.view && !filters.scope ? captureChartImage() : null,
      ]);

      setPreview({ chartImage, data, exportedAt, filters });
    } catch (error) {
      setPreviewError(
        error instanceof Error
          ? error.message
          : "No se pudo generar la vista previa de reportes.",
      );
    } finally {
      setIsLoadingPreview(false);
    }
  }

  function handlePreviewOpenChange(open: boolean) {
    if (!open) {
      setPreview(null);
    }
  }

  return (
    <div className="flex w-full flex-col gap-2 sm:w-auto">
      <Button
        className="gap-2 border-outline-variant bg-surface-container-lowest hover:bg-surface-container-low"
        disabled={exportDisabled}
        onClick={() => void openPreview()}
        variant="outline"
      >
        {isLoadingPreview ? (
          <Loader2 aria-hidden className="size-[1.125rem] shrink-0 animate-spin" />
        ) : (
          <Eye aria-hidden className="size-[1.125rem] shrink-0" />
        )}
        {isLoadingPreview ? "Generando vista previa..." : "Vista previa / exportar"}
      </Button>
      {previewError ? (
        <p className="text-xs text-error" role="alert">
          {previewError}
        </p>
      ) : null}

      <ReportsExportPreviewModal
        chartImage={preview?.chartImage ?? null}
        data={preview?.data ?? null}
        exportedAt={preview?.exportedAt ?? null}
        filters={preview?.filters ?? exportFilters}
        onOpenChange={handlePreviewOpenChange}
        open={preview !== null}
      />
    </div>
  );
}
