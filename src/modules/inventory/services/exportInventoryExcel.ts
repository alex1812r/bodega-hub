import { buildInventoryExportFilename } from "../utils/inventoryExportFilename";
import { buildInventoryExportWorkbook } from "./buildInventoryExportWorkbook";
import {
  describeInventoryExportLimit,
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

/**
 * Descarga el Excel del inventario filtrado. Devuelve el aviso para el usuario
 * si la lista superó el tope de filas (`null` si salió entera).
 */
export async function exportInventoryToExcel(
  filters: InventoryExportFilters,
): Promise<string | null> {
  const exportedAt = new Date().toISOString();
  const items = await fetchInventoryForExport(filters);
  const buffer = await buildInventoryExportWorkbook(items.rows, { exportedAt });
  const filename = buildInventoryExportFilename(new Date(exportedAt));

  triggerBlobDownload(
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    filename,
  );

  return describeInventoryExportLimit(items);
}
