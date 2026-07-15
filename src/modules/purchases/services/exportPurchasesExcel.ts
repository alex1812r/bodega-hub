import { buildPurchaseExportFilename } from "../utils/purchaseExportFilename";
import { buildPurchasesExportWorkbook } from "./buildPurchasesExportWorkbook";
import {
  fetchPurchasesForExport,
  type PurchasesExportFilters,
} from "./fetchPurchasesForExport";

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function exportPurchasesToExcel(filters: PurchasesExportFilters) {
  const exportedAt = new Date().toISOString();
  const rows = await fetchPurchasesForExport(filters);
  const buffer = await buildPurchasesExportWorkbook(rows, {
    exportedAt,
    filters,
  });

  const filename = buildPurchaseExportFilename({
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
