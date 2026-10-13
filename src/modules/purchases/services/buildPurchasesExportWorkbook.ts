import ExcelJS from "exceljs";

import { formatRefUsd } from "@/shared/utils/currency";

import type { PurchaseListRow } from "../hooks/usePurchases";
import { getPurchaseBalanceRef } from "../purchases-list/utils/purchaseBalance";
import {
  purchasesListExportColumns,
  type PurchaseExportColumn,
} from "../utils/purchaseExportSheetColumns";
import type { PurchasesExportFilters } from "./fetchPurchasesForExport";

export type PurchasesExportWorkbookMetadata = {
  exportedAt: string;
  filters: PurchasesExportFilters;
};

const SHEET_NAME = "Compras";

/** Columnas de la lista más lo pagado y el saldo (vacío si la compra no está vigente). */
const exportColumns: PurchaseExportColumn<PurchaseListRow>[] = [
  ...purchasesListExportColumns,
  {
    header: "Pagado (REF)",
    value: (row) => formatRefUsd(row.paidRef ?? 0),
  },
  {
    header: "Saldo (REF)",
    value: (row) => {
      const balanceRef = getPurchaseBalanceRef(row);

      return balanceRef === null ? "" : formatRefUsd(balanceRef);
    },
  },
];

function sanitizeSheetName(name: string) {
  return name.replace(/[*?:\\/[\]]/g, "").trim().slice(0, 31);
}

export function formatPurchasesExportPeriodLabel(from?: string, to?: string) {
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

function buildPurchasesExportFilterNotes(filters: PurchasesExportFilters): string[] {
  const notes: string[] = [];

  if (filters.search?.trim()) {
    notes.push(`Busqueda: ${filters.search.trim()}`);
  }

  if (filters.status?.trim()) {
    notes.push(`Estado: ${filters.status.trim()}`);
  }

  if (filters.pendingBalance === "1") {
    notes.push("Solo compras con saldo pendiente");
  }

  if (filters.supplierId?.trim()) {
    notes.push(`Proveedor ID: ${filters.supplierId.trim()}`);
  }

  return notes;
}

export async function buildPurchasesExportWorkbook(
  rows: PurchaseListRow[],
  metadata: PurchasesExportWorkbookMetadata,
): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "BodegaHub";
  workbook.created = new Date(metadata.exportedAt);

  const worksheet = workbook.addWorksheet(sanitizeSheetName(SHEET_NAME));
  const filterNotes = buildPurchasesExportFilterNotes(metadata.filters);

  worksheet.addRow([
    formatPurchasesExportPeriodLabel(metadata.filters.from, metadata.filters.to),
  ]);

  for (const note of filterNotes) {
    worksheet.addRow([note]);
  }

  worksheet.addRow([]);
  worksheet.addRow(exportColumns.map((column) => column.header));

  for (const row of rows) {
    worksheet.addRow(exportColumns.map((column) => column.value(row)));
  }

  const headerRowNumber = 3 + filterNotes.length;
  const headerRow = worksheet.getRow(headerRowNumber);
  headerRow.font = { bold: true };
  worksheet.columns = exportColumns.map((column, index) => ({
    key: String(index),
    width: Math.max(column.header.length + 2, 14),
  }));

  return workbook.xlsx.writeBuffer();
}
