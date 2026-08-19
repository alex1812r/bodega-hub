import { downloadReportsPdfFromDataset } from "./downloadReportsExport";
import { fetchReportsForExport, type ReportsExportFilters } from "./fetchReportsForExport";

export async function exportReportsToPdf(filters: ReportsExportFilters) {
  const exportedAt = new Date().toISOString();
  const data = await fetchReportsForExport(filters);
  downloadReportsPdfFromDataset(data, filters, exportedAt);
}
