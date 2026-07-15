import ExcelJS from "exceljs";

import { inventoryExportColumns } from "./inventoryExportColumns";
import type { InventoryItem } from "../hooks/useInventory";

export type InventoryExportWorkbookMetadata = {
  exportedAt: string;
};

export async function buildInventoryExportWorkbook(
  items: InventoryItem[],
  metadata: InventoryExportWorkbookMetadata,
): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Control Ventas";
  workbook.created = new Date(metadata.exportedAt);

  const worksheet = workbook.addWorksheet("Inventario");
  worksheet.addRow(["Inventario"]);
  worksheet.addRow([]);
  worksheet.addRow(inventoryExportColumns.map((column) => column.header));

  for (const item of items) {
    worksheet.addRow(inventoryExportColumns.map((column) => column.value(item)));
  }

  const headerRow = worksheet.getRow(3);
  headerRow.font = { bold: true };
  worksheet.columns = inventoryExportColumns.map((column, index) => ({
    key: String(index),
    width: Math.max(column.header.length + 2, 14),
  }));

  return workbook.xlsx.writeBuffer();
}
