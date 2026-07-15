import ExcelJS from "exceljs";

import { buildPaymentsExportContextLabel } from "../utils/paymentsExportContextLabel";
import {
  paymentsListExportColumns,
  type PaymentsExportColumn,
} from "../utils/paymentsExportSheetColumns";
import type { PaymentListItem } from "../hooks/usePayments";
import type { PaymentsExportFilters } from "./fetchPaymentsForExport";

export type PaymentsExportWorkbookMetadata = {
  exportedAt: string;
  filters: PaymentsExportFilters;
};

const SHEET_NAME = "Pagos";

function addDataSheet<T>(
  workbook: ExcelJS.Workbook,
  contextLabel: string,
  columns: PaymentsExportColumn<T>[],
  rows: T[],
) {
  const worksheet = workbook.addWorksheet(SHEET_NAME);
  worksheet.addRow([contextLabel]);
  worksheet.addRow([]);
  worksheet.addRow(columns.map((column) => column.header));

  for (const row of rows) {
    worksheet.addRow(columns.map((column) => column.value(row)));
  }

  const headerRow = worksheet.getRow(3);
  headerRow.font = { bold: true };
  worksheet.columns = columns.map((column, index) => ({
    key: String(index),
    width: Math.max(column.header.length + 2, 14),
  }));
}

export async function buildPaymentsExportWorkbook(
  rows: PaymentListItem[],
  metadata: PaymentsExportWorkbookMetadata,
): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Control Ventas";
  workbook.created = new Date(metadata.exportedAt);

  addDataSheet(
    workbook,
    buildPaymentsExportContextLabel(metadata.filters),
    paymentsListExportColumns,
    rows,
  );

  return workbook.xlsx.writeBuffer();
}
