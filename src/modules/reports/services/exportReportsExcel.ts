import { buildReportExportFilename } from "../utils/reportExportFilename";
import { buildReportsExportWorkbook } from "./buildReportsExportWorkbook";
import { fetchReportsForExport, type ReportsExportFilters } from "./fetchReportsForExport";

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function exportReportsToExcel(filters: ReportsExportFilters) {
  const exportedAt = new Date().toISOString();
  const data = await fetchReportsForExport(filters);
  const buffer = await buildReportsExportWorkbook(data, {
    exportedAt,
    filters,
  });

  const filename = buildReportExportFilename({
    from: filters.dateFilters.from ?? filters.purchasesFilters.from,
    to: filters.dateFilters.to ?? filters.purchasesFilters.to,
  });

  triggerBlobDownload(
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    filename,
  );
}
