import { buildReportExportFilename } from "../utils/reportExportFilename";
import { buildReportsExportPdf } from "./buildReportsExportPdf";
import { fetchReportsForExport, type ReportsExportFilters } from "./fetchReportsForExport";

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function exportReportsToPdf(filters: ReportsExportFilters) {
  const exportedAt = new Date().toISOString();
  const data = await fetchReportsForExport(filters);
  const pdf = buildReportsExportPdf(data, {
    exportedAt,
    filters,
  });

  const filename = buildReportExportFilename(
    {
      from: filters.dateFilters.from ?? filters.purchasesFilters.from,
      to: filters.dateFilters.to ?? filters.purchasesFilters.to,
    },
    new Date(exportedAt),
    "pdf",
  );

  triggerBlobDownload(pdf.output("blob"), filename);
}
