import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

import { formatCaracasDateTime } from "@/shared/utils/caracasBusinessDay";

import { buildReportExportSections } from "../utils/reportExportSections";
import {
  formatReportExportCell,
  type ReportExportColumn,
} from "../utils/reportExportSheetColumns";
import { formatChartLegendLine, type ChartImage } from "./captureChartImage";
import type { ReportsExportDataset, ReportsExportFilters } from "./fetchReportsForExport";

export type ReportsExportPdfMetadata = {
  /**
   * Imagen del gráfico del reporte abierto (`filters.view.activeReportId`): va
   * solo en su sección, bajo el encabezado y antes de la tabla.
   */
  chartImage?: ChartImage | null;
  exportedAt: string;
  filters: ReportsExportFilters;
};

const PAGE_MARGIN_MM = 14;
const PAGE_WIDTH_MM = 210;
const PAGE_HEIGHT_MM = 297;
/** Franja inferior reservada al pie de página. */
const PAGE_FOOTER_MM = 16;
const CONTENT_WIDTH_MM = PAGE_WIDTH_MM - PAGE_MARGIN_MM * 2;
const CONTENT_BOTTOM_MM = PAGE_HEIGHT_MM - PAGE_FOOTER_MM;
const HEADER_LINE_HEIGHT_MM = 4.6;
const CHART_GAP_MM = 4;
/**
 * Hasta aquí cada columna mide lo que su contenido. Con más columnas la tabla
 * no cabría en el ancho de la página y se cortaría: se reparten el ancho útil.
 */
const MAX_WRAP_COLUMNS = 6;

const TABLE_HEAD_FILL: [number, number, number] = [41, 58, 74];
const TABLE_ALT_FILL: [number, number, number] = [245, 247, 250];

function buildTableBody(columns: ReportExportColumn<unknown>[], rows: unknown[]) {
  return rows.map((row) => columns.map((column) => formatReportExportCell(column, row)));
}

function buildColumnStyles(columns: ReportExportColumn<unknown>[], rows: unknown[]) {
  const styles: Record<number, { halign: "left" | "right" }> = {};

  columns.forEach((column, index) => {
    const sampleRow = rows[0];
    const sampleValue = sampleRow ? column.value(sampleRow) : null;
    styles[index] = {
      halign: typeof sampleValue === "number" ? "right" : "left",
    };
  });

  return styles;
}

/** Título y líneas del encabezado (con ajuste de línea). Devuelve la Y siguiente. */
function drawSectionHeader(doc: jsPDF, title: string, headerLines: string[]) {
  let cursorY = PAGE_MARGIN_MM;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(20, 24, 31);

  for (const line of doc.splitTextToSize(title, CONTENT_WIDTH_MM) as string[]) {
    doc.text(line, PAGE_MARGIN_MM, cursorY);
    cursorY += 7;
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(90, 98, 110);

  for (const headerLine of headerLines) {
    for (const line of doc.splitTextToSize(headerLine, CONTENT_WIDTH_MM) as string[]) {
      doc.text(line, PAGE_MARGIN_MM, cursorY);
      cursorY += HEADER_LINE_HEIGHT_MM;
    }
  }

  doc.setTextColor(20, 24, 31);

  return cursorY + 2;
}

function drawPageFooter(doc: jsPDF, sectionTitle: string, exportedAtLabel: string) {
  const footerY = PAGE_HEIGHT_MM - 8;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(120, 128, 140);
  doc.text(`BodegaHub · ${sectionTitle} · ${exportedAtLabel}`, PAGE_MARGIN_MM, footerY);
  doc.text(
    `Página ${doc.getCurrentPageInfo().pageNumber}`,
    PAGE_WIDTH_MM - PAGE_MARGIN_MM,
    footerY,
    { align: "right" },
  );
  doc.setTextColor(20, 24, 31);
}

/**
 * Gráfico al ancho útil conservando la proporción (o más pequeño si no cabe en
 * una página). Si no cabe en lo que queda de la página, pasa a la siguiente.
 * Devuelve la Y donde sigue la tabla.
 */
function drawChartImage(
  doc: jsPDF,
  image: ChartImage,
  startY: number,
  drawFooter: () => void,
) {
  const maxHeight = CONTENT_BOTTOM_MM - PAGE_MARGIN_MM;
  const fit = Math.min(CONTENT_WIDTH_MM / image.width, maxHeight / image.height);
  const width = image.width * fit;
  const height = image.height * fit;
  let cursorY = startY;

  if (cursorY + height > CONTENT_BOTTOM_MM) {
    // La tabla ya no dibuja esta página: su pie se pone aquí.
    drawFooter();
    doc.addPage();
    cursorY = PAGE_MARGIN_MM;
  }

  doc.addImage(
    image.dataUrl,
    "PNG",
    PAGE_MARGIN_MM + (CONTENT_WIDTH_MM - width) / 2,
    cursorY,
    width,
    height,
    undefined,
    "FAST",
  );

  cursorY += height + CHART_GAP_MM;

  // La leyenda de pantalla es HTML y no sale en la imagen: va como texto.
  const legendLine = formatChartLegendLine(image.legend);

  if (legendLine) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(90, 98, 110);

    for (const line of doc.splitTextToSize(legendLine, CONTENT_WIDTH_MM) as string[]) {
      doc.text(line, PAGE_MARGIN_MM, cursorY);
      cursorY += HEADER_LINE_HEIGHT_MM;
    }

    doc.setTextColor(20, 24, 31);
    cursorY += CHART_GAP_MM / 2;
  }

  return cursorY;
}

function isUsableImage(image: ChartImage | null | undefined): image is ChartImage {
  return Boolean(image && image.dataUrl && image.width > 0 && image.height > 0);
}

export function buildReportsExportPdf(
  data: ReportsExportDataset,
  metadata: ReportsExportPdfMetadata,
): jsPDF {
  const doc = new jsPDF({
    format: "a4",
    orientation: "portrait",
    unit: "mm",
  });
  const sections = buildReportExportSections(data, metadata.filters, metadata.exportedAt);
  // Hora de Caracas en 24 h, igual que el encabezado.
  const exportedAtLabel = formatCaracasDateTime(metadata.exportedAt);
  const chartSectionId = metadata.filters.view?.activeReportId;

  sections.forEach((section, sectionIndex) => {
    if (sectionIndex > 0) {
      doc.addPage();
    }

    const drawFooter = () => drawPageFooter(doc, section.title, exportedAtLabel);
    let tableStartY = drawSectionHeader(doc, section.title, section.headerLines);

    if (section.id === chartSectionId && isUsableImage(metadata.chartImage)) {
      try {
        tableStartY = drawChartImage(doc, metadata.chartImage, tableStartY, drawFooter);
      } catch {
        // Una imagen que jsPDF no puede leer no impide exportar la tabla.
      }
    }

    const columnCount = section.columns.length;
    const isWideTable = columnCount > MAX_WRAP_COLUMNS;

    if (section.rows.length === 0) {
      autoTable(doc, {
        body: [[{ colSpan: columnCount, content: "Sin registros", styles: { halign: "center" } }]],
        margin: {
          bottom: PAGE_FOOTER_MM,
          left: PAGE_MARGIN_MM,
          right: PAGE_MARGIN_MM,
          top: PAGE_MARGIN_MM,
        },
        startY: tableStartY,
        theme: "grid",
        didDrawPage: drawFooter,
      });
      return;
    }

    autoTable(doc, {
      body: buildTableBody(section.columns, section.rows),
      columnStyles: buildColumnStyles(section.columns, section.rows),
      head: [section.columns.map((column) => column.header)],
      headStyles: {
        fillColor: TABLE_HEAD_FILL,
        fontSize: isWideTable ? 7.5 : 9,
        fontStyle: "bold",
        halign: "left",
        textColor: 255,
      },
      bodyStyles: {
        cellPadding: isWideTable ? 1.6 : 2.2,
        fontSize: isWideTable ? 7 : 8,
        overflow: "linebreak",
        valign: "middle",
      },
      alternateRowStyles: {
        fillColor: TABLE_ALT_FILL,
      },
      margin: {
        bottom: PAGE_FOOTER_MM,
        left: PAGE_MARGIN_MM,
        right: PAGE_MARGIN_MM,
        top: PAGE_MARGIN_MM,
      },
      startY: tableStartY,
      styles: {
        cellWidth: isWideTable ? "auto" : "wrap",
        lineColor: [210, 214, 220],
        lineWidth: 0.1,
        overflow: "linebreak",
      },
      theme: "grid",
      didDrawPage: drawFooter,
    });
  });

  return doc;
}
