"use client";

import { FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/shared/components/Button";
import { Modal } from "@/shared/components/Modal";
import { ResponsivePagination, usePaginationState } from "@/shared/components/Pagination";
import { Tabs } from "@/shared/components/Tabs";
import { formatCaracasDateTime } from "@/shared/utils/caracasBusinessDay";
import { cn } from "@/shared/utils/cn";

import type { ChartImage } from "../../services/captureChartImage";
import {
  downloadReportsExcelFromDataset,
  downloadReportsPdfFromDataset,
} from "../../services/downloadReportsExport";
import type {
  ReportsExportDataset,
  ReportsExportFilters,
} from "../../services/fetchReportsForExport";
import {
  buildReportExportSections,
  getReportExportName,
  type ReportExportSection,
} from "../../utils/reportExportSections";
import { formatReportExportCell } from "../../utils/reportExportSheetColumns";
import { toReportErrorMessage } from "../reportQueryState";

const PREVIEW_PAGE_SIZE = 25;

type DownloadKind = "excel" | "pdf";

/**
 * Tras una descarga, su botón queda ocupado este tiempo: el segundo y tercer
 * clic de un doble o triple clic llegan dentro de él y no generan más archivos.
 */
const DOWNLOAD_COOLDOWN_MS = 1000;

type ReportsExportPreviewModalProps = {
  /** Imagen del gráfico del reporte abierto; va en su sección del PDF y del Excel. */
  chartImage?: ChartImage | null;
  /** Aviso de que el archivo saldrá sin el gráfico, y por qué. */
  chartNotice?: string | null;
  data: ReportsExportDataset | null;
  exportedAt: string | null;
  filters: ReportsExportFilters;
  onOpenChange: (open: boolean) => void;
  /**
   * Vuelve a capturar el gráfico. Lo usa «Reintentar captura» y, sin esperar
   * (`timeoutMs` 0), cada descarga que aún no tiene imagen.
   */
  onRetryChartCapture?: (timeoutMs?: number) => Promise<ChartImage | null>;
  open: boolean;
};

function PreviewSheetTable({ section }: { section: ReportExportSection }) {
  const pagination = usePaginationState([section.id, section.rows.length], PREVIEW_PAGE_SIZE);
  const pageRows = useMemo(() => {
    const start = pagination.skip;
    return section.rows.slice(start, start + pagination.limit);
  }, [pagination.limit, pagination.skip, section.rows]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-outline-variant">
        <table className="min-w-full border-collapse text-left text-sm">
          <thead className="sticky top-0 z-10 bg-surface-container">
            <tr>
              {section.columns.map((column) => (
                <th
                  className="whitespace-nowrap border-b border-outline-variant px-3 py-2 font-semibold text-on-surface-variant"
                  key={column.header}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td
                  className="px-3 py-8 text-center text-on-surface-variant"
                  colSpan={Math.max(section.columns.length, 1)}
                >
                  Sin filas para esta hoja.
                </td>
              </tr>
            ) : (
              pageRows.map((row, rowIndex) => (
                <tr
                  className="border-b border-outline-variant odd:bg-surface-container-lowest even:bg-surface-container-low/40"
                  key={`${section.id}-${pagination.skip + rowIndex}`}
                >
                  {section.columns.map((column) => {
                    const value = column.value(row);
                    return (
                      <td
                        className={cn(
                          "whitespace-nowrap px-3 py-2 tabular-nums text-foreground",
                          typeof value === "number" && "text-right",
                        )}
                        key={column.header}
                      >
                        {formatReportExportCell(column, row)}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {section.rows.length > 0 ? (
        <div className="flex justify-end border-t border-outline-variant pt-3">
          <ResponsivePagination
            className="w-full justify-end"
            limit={pagination.limit}
            onLimitChange={pagination.setLimit}
            onSkipChange={pagination.setSkip}
            showSummary
            skip={pagination.skip}
            total={section.rows.length}
            variant="stitch"
          />
        </div>
      ) : null}
    </div>
  );
}

export function ReportsExportPreviewModal({
  chartImage = null,
  chartNotice = null,
  data,
  exportedAt,
  filters,
  onOpenChange,
  onRetryChartCapture,
  open,
}: ReportsExportPreviewModalProps) {
  const sections = useMemo(
    () => (data ? buildReportExportSections(data, filters) : []),
    [data, filters],
  );
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [isDownloadingExcel, setIsDownloadingExcel] = useState(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [isCapturingChart, setIsCapturingChart] = useState(false);
  // Bloqueo de reentradas: el ref corta el clic repetido en el mismo instante
  // (el estado aún no se ha pintado) y el estado deshabilita el botón.
  const inFlightRef = useRef(false);
  const coolingRef = useRef<Record<DownloadKind, boolean>>({ excel: false, pdf: false });
  const cooldownTimersRef = useRef<number[]>([]);
  const [cooling, setCooling] = useState<Record<DownloadKind, boolean>>({ excel: false, pdf: false });

  useEffect(() => {
    const timers = cooldownTimersRef.current;

    return () => {
      for (const timer of timers) {
        window.clearTimeout(timer);
      }
    };
  }, []);

  // Con el modal abierto, si la hoja elegida ya no existe se vuelve a la primera
  // (ajuste de estado durante el render en lugar de un efecto).
  if (
    open &&
    sections.length > 0 &&
    !sections.some((section) => section.id === activeSectionId)
  ) {
    setActiveSectionId(sections[0].id);
  }

  const activeSection =
    sections.find((section) => section.id === activeSectionId) ?? sections[0] ?? null;
  // Hora de Caracas en 24 h: "a. m." seguido del punto de la frase daba "a. m..".
  const generatedLabel = exportedAt ? formatCaracasDateTime(exportedAt) : null;
  const truncatedSections = sections.filter((section) => section.truncationNotice);
  const chartReportName = chartImage ? getReportExportName(filters.view?.activeReportId) : undefined;

  /**
   * Una descarga a la vez y, por botón, una cada `DOWNLOAD_COOLDOWN_MS`: un
   * doble o triple clic genera un solo archivo.
   */
  async function runDownload(
    kind: DownloadKind,
    setIsDownloading: (value: boolean) => void,
    errorMessage: string,
    download: (image: ChartImage | null) => Promise<void> | void,
  ) {
    if (!data || !exportedAt || inFlightRef.current || coolingRef.current[kind]) {
      return;
    }

    inFlightRef.current = true;
    coolingRef.current[kind] = true;
    setCooling((current) => ({ ...current, [kind]: true }));
    setIsDownloading(true);
    setDownloadError(null);

    try {
      // Sin imagen se intenta capturar otra vez: el gráfico pudo terminar de
      // cargar con la vista previa ya abierta.
      const image = chartImage ?? (onRetryChartCapture ? await onRetryChartCapture(0) : null);

      await download(image);
    } catch (error) {
      console.error(error);
      // Un fallo al armar el archivo es interno: no se enseña su mensaje.
      setDownloadError(toReportErrorMessage(error, errorMessage));
    } finally {
      inFlightRef.current = false;
      setIsDownloading(false);
      cooldownTimersRef.current.push(
        window.setTimeout(() => {
          coolingRef.current[kind] = false;
          setCooling((current) => ({ ...current, [kind]: false }));
        }, DOWNLOAD_COOLDOWN_MS),
      );
    }
  }

  function handleDownloadExcel() {
    return runDownload("excel", setIsDownloadingExcel, "No se pudo descargar el Excel.", (image) =>
      data && exportedAt ? downloadReportsExcelFromDataset(data, filters, exportedAt, image) : undefined,
    );
  }

  function handleDownloadPdf() {
    return runDownload("pdf", setIsDownloadingPdf, "No se pudo descargar el PDF.", (image) =>
      data && exportedAt ? downloadReportsPdfFromDataset(data, filters, exportedAt, image) : undefined,
    );
  }

  async function handleRetryChartCapture() {
    if (!onRetryChartCapture || isCapturingChart) {
      return;
    }

    setIsCapturingChart(true);

    try {
      await onRetryChartCapture();
    } finally {
      setIsCapturingChart(false);
    }
  }

  const isDownloading = isDownloadingExcel || isDownloadingPdf;

  return (
    <Modal
      bodyClassName="flex flex-col overflow-hidden pr-0"
      contentClassName="sm:max-w-[min(96vw,90rem)] sm:w-[min(96vw,90rem)] h-[min(92vh,56rem)] max-h-[min(92vh,56rem)]"
      description={
        generatedLabel
          ? `Vista previa generada el ${generatedLabel}. Revisa las hojas antes de descargar.`
          : "Vista previa de los reportes con las mismas hojas del Excel/PDF."
      }
      footer={({ close }) => (
        <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-col gap-2">
            {downloadError ? (
              <p className="text-sm text-error" role="alert">
                {downloadError}
              </p>
            ) : (
              <p className="text-sm text-on-surface-variant">
                {sections.length} hojas · descarga opcional
                {chartReportName ? ` · incluye el gráfico de «${chartReportName}»` : ""}
              </p>
            )}
            {chartNotice && !chartImage ? (
              <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground" role="status">
                <span>{chartNotice}</span>
                {onRetryChartCapture ? (
                  <Button
                    disabled={isCapturingChart || isDownloading}
                    onClick={() => void handleRetryChartCapture()}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {isCapturingChart ? "Capturando..." : "Reintentar captura"}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button disabled={isDownloading} onClick={close} type="button" variant="outline">
              Cerrar
            </Button>
            <Button
              className="gap-2"
              disabled={!data || isDownloading || cooling.pdf}
              onClick={() => void handleDownloadPdf()}
              type="button"
              variant="outline"
            >
              {isDownloadingPdf ? (
                <Loader2 aria-hidden className="size-4 animate-spin" />
              ) : (
                <FileText aria-hidden className="size-4" />
              )}
              Descargar PDF
            </Button>
            <Button
              className="gap-2"
              disabled={!data || isDownloading || cooling.excel}
              onClick={() => void handleDownloadExcel()}
              type="button"
              variant="primary"
            >
              {isDownloadingExcel ? (
                <Loader2 aria-hidden className="size-4 animate-spin" />
              ) : (
                <FileSpreadsheet aria-hidden className="size-4" />
              )}
              Descargar Excel
            </Button>
          </div>
        </div>
      )}
      onOpenChange={onOpenChange}
      open={open}
      title="Vista previa de reportes"
    >
      {!data || sections.length === 0 ? (
        <p className="py-10 text-center text-sm text-on-surface-variant">
          No hay datos para previsualizar.
        </p>
      ) : (
        <div className="flex h-full min-h-0 flex-col gap-3">
          {truncatedSections.length > 0 ? (
            <p
              className="shrink-0 rounded-lg border border-outline-variant bg-surface-container-low px-3 py-2 text-sm font-medium text-foreground"
              role="status"
            >
              {truncatedSections.length === 1
                ? "Una hoja llegó al tope de filas y sale cortada: "
                : `${truncatedSections.length} hojas llegaron al tope de filas y salen cortadas: `}
              {truncatedSections.map((section) => section.title).join(", ")}. Acota los filtros para
              exportar el resto.
            </p>
          ) : null}
          <Tabs
            ariaLabel="Hojas del reporte"
            className="flex min-h-[28rem] flex-1 flex-col"
            items={sections.map((section) => ({
              badge: section.rows.length,
              content: (
                <div className="flex h-full min-h-0 flex-col gap-2">
                  <div className="shrink-0 space-y-1">
                    {section.headerLines.map((line, index) => (
                      <p
                        className={cn(
                          "text-on-surface-variant",
                          index === 0 ? "text-sm" : "text-xs",
                          line === section.truncationNotice && "font-medium text-foreground",
                        )}
                        key={line}
                      >
                        {line}
                      </p>
                    ))}
                  </div>
                  <PreviewSheetTable section={section} />
                </div>
              ),
              label: section.title,
              value: section.id,
            }))}
            onValueChange={setActiveSectionId}
            panelClassName="min-h-0 flex-1 pt-3"
            // Controlado y sin `urlParam`: dentro del modal la hoja activa no se escribe en la URL.
            value={activeSection?.id}
          />
        </div>
      )}
    </Modal>
  );
}
