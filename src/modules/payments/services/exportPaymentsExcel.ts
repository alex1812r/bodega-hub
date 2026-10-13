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

/** `filterLabels`: texto humano de los filtros por id, para el título de la hoja. */
export async function exportPaymentsToExcel(
  filters: PaymentsExportFilters,
  filterLabels?: readonly string[],
) {
  const exportedAt = new Date().toISOString();
  const rows = await fetchPaymentsForExport(filters);
  const buffer = await buildPaymentsExportWorkbook(rows, {
    exportedAt,
    filterLabels,
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
