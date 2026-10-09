import { buildReportExportFilename } from "../utils/reportExportFilename";
import { getReportExportName } from "../utils/reportExportSections";
import { buildReportsExportPdf } from "./buildReportsExportPdf";
import { buildReportsExportWorkbook } from "./buildReportsExportWorkbook";
import type { ChartImage } from "./captureChartImage";
import type { ReportsExportDataset, ReportsExportFilters } from "./fetchReportsForExport";

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Reporte abierto (si se conoce) y rango efectivo, para el nombre del archivo. */
export function resolveExportFilenameFilters(filters: ReportsExportFilters) {
  return {
    from: filters.dateFilters.from ?? filters.purchasesFilters.from,
    reportName: getReportExportName(filters.view?.activeReportId),
    to: filters.dateFilters.to ?? filters.purchasesFilters.to,
  };
}

export async function downloadReportsExcelFromDataset(
  data: ReportsExportDataset,
  filters: ReportsExportFilters,
  exportedAt = new Date().toISOString(),
  chartImage: ChartImage | null = null,
) {
  const buffer = await buildReportsExportWorkbook(data, {
    chartImage,
    exportedAt,
    filters,
  });

  triggerBlobDownload(
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    buildReportExportFilename(resolveExportFilenameFilters(filters), new Date(exportedAt), "xlsx"),
  );
}

export function downloadReportsPdfFromDataset(
  data: ReportsExportDataset,
  filters: ReportsExportFilters,
  exportedAt = new Date().toISOString(),
  chartImage: ChartImage | null = null,
) {
  const pdf = buildReportsExportPdf(data, {
    chartImage,
    exportedAt,
    filters,
  });

  triggerBlobDownload(
    pdf.output("blob"),
    buildReportExportFilename(resolveExportFilenameFilters(filters), new Date(exportedAt), "pdf"),
  );
}
