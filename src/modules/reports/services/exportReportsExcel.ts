import { downloadReportsExcelFromDataset } from "./downloadReportsExport";
import { fetchReportsForExport, type ReportsExportFilters } from "./fetchReportsForExport";

export async function exportReportsToExcel(filters: ReportsExportFilters) {
  const exportedAt = new Date().toISOString();
  const data = await fetchReportsForExport(filters);
  await downloadReportsExcelFromDataset(data, filters, exportedAt);
}
