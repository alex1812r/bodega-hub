import { buildInventoryExportFilename } from "../utils/inventoryExportFilename";
import { buildInventoryExportWorkbook } from "./buildInventoryExportWorkbook";
import {
  fetchInventoryForExport,
  type InventoryExportFilters,
} from "./fetchInventoryForExport";

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function exportInventoryToExcel(filters: InventoryExportFilters) {
  const exportedAt = new Date().toISOString();
  const items = await fetchInventoryForExport(filters);
  const buffer = await buildInventoryExportWorkbook(items, { exportedAt });
  const filename = buildInventoryExportFilename(new Date(exportedAt));

  triggerBlobDownload(
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    filename,
  );
}
