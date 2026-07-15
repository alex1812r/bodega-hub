import { buildPaymentsExportFilename } from "../utils/paymentsExportFilename";
import { buildPaymentsExportWorkbook } from "./buildPaymentsExportWorkbook";
import { fetchPaymentsForExport, type PaymentsExportFilters } from "./fetchPaymentsForExport";

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function exportPaymentsToExcel(filters: PaymentsExportFilters) {
  const exportedAt = new Date().toISOString();
  const rows = await fetchPaymentsForExport(filters);
  const buffer = await buildPaymentsExportWorkbook(rows, {
    exportedAt,
    filters,
  });

  const filename = buildPaymentsExportFilename({}, new Date(exportedAt));

  triggerBlobDownload(
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    filename,
  );
}
