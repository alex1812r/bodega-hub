import { buildReportExportFilename } from "../utils/reportExportFilename";
import { buildReportsExportPdf } from "./buildReportsExportPdf";
import { buildReportsExportWorkbook } from "./buildReportsExportWorkbook";
import type { ReportsExportDataset, ReportsExportFilters } from "./fetchReportsForExport";

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function resolveExportFilenameFilters(filters: ReportsExportFilters) {
  return {
    from: filters.dateFilters.from ?? filters.purchasesFilters.from,
    to: filters.dateFilters.to ?? filters.purchasesFilters.to,
  };
}

export async function downloadReportsExcelFromDataset(
  data: ReportsExportDataset,
  filters: ReportsExportFilters,
  exportedAt = new Date().toISOString(),
) {
  const buffer = await buildReportsExportWorkbook(data, {
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
) {
  const pdf = buildReportsExportPdf(data, {
    exportedAt,
    filters,
  });

  triggerBlobDownload(
    pdf.output("blob"),
    buildReportExportFilename(resolveExportFilenameFilters(filters), new Date(exportedAt), "pdf"),
  );
}
