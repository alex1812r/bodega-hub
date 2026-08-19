"use client";

import { FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";

import { Button } from "@/shared/components/Button";
import { Modal } from "@/shared/components/Modal";
import { ResponsivePagination, usePaginationState } from "@/shared/components/Pagination";
import { cn } from "@/shared/utils/cn";

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
  type ReportExportSection,
} from "../../utils/reportExportSections";

const PREVIEW_PAGE_SIZE = 25;

type ReportsExportPreviewModalProps = {
  data: ReportsExportDataset | null;
  exportedAt: string | null;
  filters: ReportsExportFilters;
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

function formatPreviewCell(value: string | number) {
  if (typeof value === "number") {
    if (Number.isInteger(value)) {
      return String(value);
    }

    return value.toLocaleString("es-VE", {
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
    });
  }

  return value;
}

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
                        {formatPreviewCell(value)}
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
  data,
  exportedAt,
  filters,
  onOpenChange,
  open,
}: ReportsExportPreviewModalProps) {
  const tabsId = useId();
  const sections = useMemo(
    () => (data ? buildReportExportSections(data, filters) : []),
    [data, filters],
  );
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [isDownloadingExcel, setIsDownloadingExcel] = useState(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || sections.length === 0) {
      return;
    }

    setActiveSectionId((current) => {
      if (current && sections.some((section) => section.id === current)) {
        return current;
      }

      return sections[0]?.id ?? null;
    });
  }, [open, sections]);

  const activeSection =
    sections.find((section) => section.id === activeSectionId) ?? sections[0] ?? null;
  const generatedLabel = exportedAt
    ? new Date(exportedAt).toLocaleString("es-VE")
    : null;

  async function handleDownloadExcel() {
    if (!data || !exportedAt) {
      return;
    }

    setIsDownloadingExcel(true);
    setDownloadError(null);

    try {
      await downloadReportsExcelFromDataset(data, filters, exportedAt);
    } catch (error) {
      setDownloadError(
        error instanceof Error ? error.message : "No se pudo descargar el Excel.",
      );
    } finally {
      setIsDownloadingExcel(false);
    }
  }

  function handleDownloadPdf() {
    if (!data || !exportedAt) {
      return;
    }

    setIsDownloadingPdf(true);
    setDownloadError(null);

    try {
      downloadReportsPdfFromDataset(data, filters, exportedAt);
    } catch (error) {
      setDownloadError(
        error instanceof Error ? error.message : "No se pudo descargar el PDF.",
      );
    } finally {
      setIsDownloadingPdf(false);
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
          {downloadError ? (
            <p className="text-sm text-error" role="alert">
              {downloadError}
            </p>
          ) : (
            <p className="text-sm text-on-surface-variant">
              {sections.length} hojas · descarga opcional
            </p>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button disabled={isDownloading} onClick={close} type="button" variant="outline">
              Cerrar
            </Button>
            <Button
              className="gap-2"
              disabled={!data || isDownloading}
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
              disabled={!data || isDownloading}
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
        <div className="flex h-full min-h-[28rem] flex-col gap-3">
          <div
            aria-label="Hojas del reporte"
            className="flex shrink-0 overflow-x-auto border-b border-outline-variant"
            role="tablist"
          >
            {sections.map((section) => {
              const isActive = section.id === activeSection?.id;
              const tabId = `${tabsId}-${section.id}`;

              return (
                <button
                  aria-controls={`${tabId}-panel`}
                  aria-selected={isActive}
                  className={cn(
                    "shrink-0 cursor-pointer whitespace-nowrap px-3 py-2.5 text-sm font-medium transition-colors",
                    isActive
                      ? "border-b-2 border-primary font-semibold text-primary"
                      : "text-on-surface-variant hover:bg-surface-container-low",
                  )}
                  id={tabId}
                  key={section.id}
                  onClick={() => setActiveSectionId(section.id)}
                  role="tab"
                  type="button"
                >
                  {section.title}
                  <span className="ml-1.5 text-xs font-normal text-on-surface-variant">
                    ({section.rows.length})
                  </span>
                </button>
              );
            })}
          </div>

          {activeSection ? (
            <div
              aria-labelledby={`${tabsId}-${activeSection.id}`}
              className="flex min-h-0 flex-1 flex-col gap-2"
              id={`${tabsId}-${activeSection.id}-panel`}
              role="tabpanel"
            >
              <div className="shrink-0 space-y-1">
                <p className="text-sm text-on-surface-variant">{activeSection.periodLabel}</p>
                {activeSection.note ? (
                  <p className="text-xs text-on-surface-variant">{activeSection.note}</p>
                ) : null}
              </div>
              <PreviewSheetTable section={activeSection} />
            </div>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
