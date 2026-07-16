import ExcelJS from "exceljs";

import {
  movementExportColumns,
  type MovementExportRow,
} from "../utils/movementExportColumns";
import { buildMovementsExportContextLabel } from "../utils/movementExportContextLabel";
import type { MovementsExportFilters } from "./fetchMovementsForExport";

export type MovementsExportWorkbookMetadata = {
  exportedAt: string;
  filters: MovementsExportFilters;
};

const SHEET_NAME = "Movimientos";

function sanitizeSheetName(name: string) {
  return name.replace(/[*?:\\/[\]]/g, "").trim().slice(0, 31);
}

export async function buildMovementsExportWorkbook(
  rows: MovementExportRow[],
  metadata: MovementsExportWorkbookMetadata,
): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "BodegaHub";
  workbook.created = new Date(metadata.exportedAt);

  const worksheet = workbook.addWorksheet(sanitizeSheetName(SHEET_NAME));
  worksheet.addRow([buildMovementsExportContextLabel(metadata.filters)]);
  worksheet.addRow([]);
  worksheet.addRow(movementExportColumns.map((column) => column.header));

  for (const row of rows) {
    worksheet.addRow(movementExportColumns.map((column) => column.value(row)));
  }

  const headerRow = worksheet.getRow(3);
  headerRow.font = { bold: true };
  worksheet.columns = movementExportColumns.map((column, index) => ({
    key: String(index),
    width: Math.max(column.header.length + 2, 14),
  }));

  return workbook.xlsx.writeBuffer();
}
