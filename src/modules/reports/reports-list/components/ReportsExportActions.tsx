"use client";

import { Eye, Loader2 } from "lucide-react";
import { useState } from "react";

import { usePermission } from "@/shared/auth/usePermission";
import { Button } from "@/shared/components/Button";

import type { ChartImage } from "../../services/captureChartImage";
import {
  captureChartImageWhenReady,
  type ChartCapture,
} from "../../services/captureChartImageWhenReady";
import {
  fetchReportsForExport,
  type ReportsExportDataset,
  type ReportsExportFilters,
} from "../../services/fetchReportsForExport";
import { readReportsExportView } from "../../utils/reportExportView";
import { toReportErrorMessage } from "../reportQueryState";
import { ReportsExportPreviewModal } from "./ReportsExportPreviewModal";

type ReportsExportActionsProps = {
  exportFilters: ReportsExportFilters;
};

/** Lo que se exporta: se fija al abrir la vista previa y no cambia hasta cerrarla. */
type ExportPreview = {
  chartImage: ChartImage | null;
  /** Por qué falta la imagen en un reporte que debería llevarla. */
  chartMissing: ChartCapture["missing"];
  data: ReportsExportDataset;
  exportedAt: string;
  filters: ReportsExportFilters;
};

const NO_CHART: ChartCapture = { image: null, missing: null };

const CHART_MISSING_NOTICES: Record<NonNullable<ChartCapture["missing"]>, string> = {
  failed: "El gráfico no se incluirá: no se pudo capturar la imagen.",
  loading: "El gráfico no se incluirá: aún se estaba cargando.",
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
      // El gráfico se captura ahora, antes de que el modal lo tape. Si aún está
      // cargando se le espera (plazo acotado): capturar al instante daba un
      // archivo sin imagen y sin aviso.
      const [data, chart] = await Promise.all([
        fetchReportsForExport(filters),
        filters.view && !filters.scope ? captureChartImageWhenReady() : NO_CHART,
      ]);

      setPreview({ chartImage: chart.image, chartMissing: chart.missing, data, exportedAt, filters });
    } catch (error) {
      // Solo un error de negocio del servidor enseña su mensaje.
      setPreviewError(toReportErrorMessage(error, "No se pudo generar la vista previa de reportes."));
    } finally {
      setIsLoadingPreview(false);
    }
  }

  /**
   * Vuelve a capturar el gráfico con la vista previa abierta (el modal no lo
   * quita del documento). `timeoutMs` 0 = sin esperar, para el momento de
   * descargar.
   */
  async function retryChartCapture(timeoutMs?: number) {
    const chart = await captureChartImageWhenReady({ timeoutMs });

    setPreview((current) =>
      current
        ? {
            ...current,
            chartImage: chart.image ?? current.chartImage,
            chartMissing: chart.image ? null : chart.missing,
          }
        : current,
    );

    return chart.image;
  }

  const canCaptureChart = Boolean(preview?.filters.view && !preview.filters.scope);

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
        chartNotice={preview?.chartMissing ? CHART_MISSING_NOTICES[preview.chartMissing] : null}
        data={preview?.data ?? null}
        exportedAt={preview?.exportedAt ?? null}
        filters={preview?.filters ?? exportFilters}
        onOpenChange={handlePreviewOpenChange}
        onRetryChartCapture={canCaptureChart ? retryChartCapture : undefined}
        open={preview !== null}
      />
    </div>
  );
}
