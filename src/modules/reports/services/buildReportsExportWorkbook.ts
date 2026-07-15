import ExcelJS from "exceljs";

import type { ReportsExportDataset, ReportsExportFilters } from "./fetchReportsForExport";
import { buildReportExportSections } from "../utils/reportExportSections";
import type { ReportExportColumn } from "../utils/reportExportSheetColumns";

export type ReportsExportWorkbookMetadata = {
  exportedAt: string;
  filters: ReportsExportFilters;
};

function sanitizeSheetName(name: string) {
  return name.replace(/[*?:\\/[\]]/g, "").trim().slice(0, 31);
}

function addDataSheet<T>(
  workbook: ExcelJS.Workbook,
  sheetName: string,
  periodLabel: string,
  columns: ReportExportColumn<T>[],
  rows: T[],
  note?: string,
) {
  const worksheet = workbook.addWorksheet(sanitizeSheetName(sheetName));
  worksheet.addRow([periodLabel]);

  if (note) {
    worksheet.addRow([note]);
  }

  worksheet.addRow([]);
  worksheet.addRow(columns.map((column) => column.header));

  for (const row of rows) {
    worksheet.addRow(columns.map((column) => column.value(row)));
  }

  const headerRowNumber = note ? 4 : 3;
  const headerRow = worksheet.getRow(headerRowNumber);
  headerRow.font = { bold: true };
  worksheet.columns = columns.map((column, index) => ({
    key: String(index),
    width: Math.max(column.header.length + 2, 14),
  }));
}

export async function buildReportsExportWorkbook(
  data: ReportsExportDataset,
  metadata: ReportsExportWorkbookMetadata,
): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Control Ventas";
  workbook.created = new Date(metadata.exportedAt);

  for (const section of buildReportExportSections(data, metadata.filters)) {
    addDataSheet(
      workbook,
      section.title,
      section.periodLabel,
      section.columns,
      section.rows,
      section.note,
    );
  }

  return workbook.xlsx.writeBuffer();
}
