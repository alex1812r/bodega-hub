import { buildSalesExportFilename } from "../utils/salesExportFilename";
import { buildSalesExportWorkbook } from "./buildSalesExportWorkbook";
import { fetchSalesForExport, type SalesExportFilters } from "./fetchSalesForExport";

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function exportSalesToExcel(filters: SalesExportFilters) {
  const exportedAt = new Date().toISOString();
  const rows = await fetchSalesForExport(filters);
  const buffer = await buildSalesExportWorkbook(rows, {
    exportedAt,
    filters,
  });

  const filename = buildSalesExportFilename({
    from: filters.from,
    to: filters.to,
  });

  triggerBlobDownload(
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    filename,
  );
}
