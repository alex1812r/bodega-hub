import ExcelJS from "exceljs";

import { fitExcelCell } from "@/modules/inventory/utils/excelCell";

import {
  buildReportExportSections,
  type ReportExportSection,
} from "../utils/reportExportSections";
import type { ChartImage } from "./captureChartImage";
import type { ReportsExportDataset, ReportsExportFilters } from "./fetchReportsForExport";

export type ReportsExportWorkbookMetadata = {
  /**
   * Imagen del gráfico del reporte abierto (`filters.view.activeReportId`): va
   * solo en su hoja, entre el encabezado y la tabla.
   */
  chartImage?: ChartImage | null;
  exportedAt: string;
  filters: ReportsExportFilters;
};

const SHEET_NAME_MAX_LENGTH = 31;
/** Ancho del gráfico en la hoja, en px. */
const CHART_DISPLAY_WIDTH = 720;
/** Alto de una fila por defecto de Excel (15 pt), en px. */
const DEFAULT_ROW_HEIGHT_PX = 20;

function sanitizeSheetName(name: string) {
  return name.replace(/[*?:\\/[\]]/g, "").trim().slice(0, SHEET_NAME_MAX_LENGTH);
}

/** Nombre de hoja válido y que no repite ninguno de `used` (Excel no lo admite). */
function uniqueSheetName(name: string, used: Set<string>) {
  const base = sanitizeSheetName(name) || "Reporte";
  let candidate = base;

  for (let suffix = 2; used.has(candidate.toLowerCase()); suffix += 1) {
    const tail = ` (${suffix})`;

    candidate = `${base.slice(0, SHEET_NAME_MAX_LENGTH - tail.length)}${tail}`;
  }

  used.add(candidate.toLowerCase());

  return candidate;
}

function isUsableImage(image: ChartImage | null | undefined): image is ChartImage {
  return Boolean(image && image.dataUrl && image.width > 0 && image.height > 0);
}

/**
 * Hoja de un reporte: título, encabezado (una línea por fila), el gráfico si lo
 * hay, una fila en blanco, cabeceras de columna y datos. El gráfico ocupa filas
 * propias encima de la tabla: no tapa ninguna celda.
 */
function addDataSheet(
  workbook: ExcelJS.Workbook,
  sheetName: string,
  section: ReportExportSection,
  chartImage: ChartImage | null,
) {
  const worksheet = workbook.addWorksheet(sheetName);

  worksheet.addRow([fitExcelCell(section.title)]).font = { bold: true, size: 14 };

  for (const line of section.headerLines) {
    worksheet.addRow([fitExcelCell(line)]);
  }

  if (chartImage) {
    const height = Math.round((chartImage.height * CHART_DISPLAY_WIDTH) / chartImage.width);
    const reservedRows = Math.ceil(height / DEFAULT_ROW_HEIGHT_PX) + 1;
    // Ancla en base 0: la fila siguiente a la última escrita, más una en blanco.
    const imageRow = worksheet.rowCount + 1;

    worksheet.addImage(workbook.addImage({ base64: chartImage.dataUrl, extension: "png" }), {
      ext: { height, width: CHART_DISPLAY_WIDTH },
      tl: { col: 0, row: imageRow },
    });

    for (let row = 0; row < reservedRows + 1; row += 1) {
      worksheet.addRow([]);
    }
  }

  worksheet.addRow([]);
  worksheet.addRow(section.columns.map((column) => column.header)).font = { bold: true };

  for (const row of section.rows) {
    worksheet.addRow(section.columns.map((column) => fitExcelCell(column.value(row))));
  }

  worksheet.columns = section.columns.map((column, index) => ({
    key: String(index),
    width: Math.max(column.header.length + 2, 14),
  }));
}

export async function buildReportsExportWorkbook(
  data: ReportsExportDataset,
  metadata: ReportsExportWorkbookMetadata,
): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "BodegaHub";
  workbook.created = new Date(metadata.exportedAt);

  const sections = buildReportExportSections(data, metadata.filters, metadata.exportedAt);
  const activeIndex = sections.findIndex(
    (section) => section.id === metadata.filters.view?.activeReportId,
  );
  const usedNames = new Set<string>();

  sections.forEach((section, index) => {
    addDataSheet(
      workbook,
      uniqueSheetName(section.title, usedNames),
      section,
      index === activeIndex && isUsableImage(metadata.chartImage) ? metadata.chartImage : null,
    );
  });

  if (activeIndex > 0) {
    // El libro se abre en la hoja del reporte que el usuario tenía en pantalla.
    workbook.views = [
      {
        activeTab: activeIndex,
        firstSheet: 0,
        height: 20000,
        visibility: "visible",
        width: 28000,
        x: 0,
        y: 0,
      },
    ];
  }

  return workbook.xlsx.writeBuffer();
}
