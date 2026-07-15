import ExcelJS from "exceljs";

import type { SaleListItem } from "../hooks/useSales";
import { salesExportColumns } from "../utils/salesExportSheetColumns";
import type { SalesExportFilters } from "./fetchSalesForExport";

export type SalesExportWorkbookMetadata = {
  exportedAt: string;
  filters: SalesExportFilters;
};

const SHEET_NAME = "Ventas";

function sanitizeSheetName(name: string) {
  return name.replace(/[*?:\\/[\]]/g, "").trim().slice(0, 31);
}

export function formatSalesExportPeriodLabel(from?: string, to?: string) {
  const start = from?.trim();
  const end = to?.trim();

  if (start && end) {
    return `Periodo: ${start} a ${end}`;
  }

  if (start) {
    return `Desde: ${start}`;
  }

  if (end) {
    return `Hasta: ${end}`;
  }

  return "Sin filtro de periodo";
}

function buildSalesExportFilterNotes(filters: SalesExportFilters): string[] {
  const notes: string[] = [];

  if (filters.search?.trim()) {
    notes.push(`Busqueda: ${filters.search.trim()}`);
  }

  if (filters.status?.trim()) {
    notes.push(`Estado: ${filters.status.trim()}`);
  }

  if (filters.customerId?.trim()) {
    notes.push(`Cliente ID: ${filters.customerId.trim()}`);
  }

  return notes;
}

export async function buildSalesExportWorkbook(
  rows: SaleListItem[],
  metadata: SalesExportWorkbookMetadata,
): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Control Ventas";
  workbook.created = new Date(metadata.exportedAt);

  const worksheet = workbook.addWorksheet(sanitizeSheetName(SHEET_NAME));
  const filterNotes = buildSalesExportFilterNotes(metadata.filters);

  worksheet.addRow([
    formatSalesExportPeriodLabel(metadata.filters.from, metadata.filters.to),
  ]);

  for (const note of filterNotes) {
    worksheet.addRow([note]);
  }

  worksheet.addRow([]);
  worksheet.addRow(salesExportColumns.map((column) => column.header));

  for (const row of rows) {
    worksheet.addRow(salesExportColumns.map((column) => column.value(row)));
  }

  const headerRowNumber = 3 + filterNotes.length;
  const headerRow = worksheet.getRow(headerRowNumber);
  headerRow.font = { bold: true };
  worksheet.columns = salesExportColumns.map((column, index) => ({
    key: String(index),
    width: Math.max(column.header.length + 2, 14),
  }));

  return workbook.xlsx.writeBuffer();
}
