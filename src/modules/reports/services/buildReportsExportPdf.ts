import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

import type { ReportsExportDataset, ReportsExportFilters } from "./fetchReportsForExport";
import { buildReportExportSections } from "../utils/reportExportSections";
import type { ReportExportColumn } from "../utils/reportExportSheetColumns";

export type ReportsExportPdfMetadata = {
  exportedAt: string;
  filters: ReportsExportFilters;
};

const PAGE_MARGIN_MM = 14;
const PAGE_WIDTH_MM = 210;
const PAGE_HEIGHT_MM = 297;

const TABLE_HEAD_FILL: [number, number, number] = [41, 58, 74];
const TABLE_ALT_FILL: [number, number, number] = [245, 247, 250];

function formatPdfCellValue(value: string | number) {
  if (typeof value === "number") {
    if (Number.isInteger(value)) {
      return String(value);
    }

    return value.toLocaleString("es-VE", {
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
    });
  }

  return value;
}

function buildTableBody(columns: ReportExportColumn<unknown>[], rows: unknown[]) {
  return rows.map((row) =>
    columns.map((column) => formatPdfCellValue(column.value(row))),
  );
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

function drawSectionHeader(
  doc: jsPDF,
  title: string,
  periodLabel: string,
  note?: string,
) {
  let cursorY = PAGE_MARGIN_MM;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(20, 24, 31);
  doc.text(title, PAGE_MARGIN_MM, cursorY);

  cursorY += 7;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(90, 98, 110);
  doc.text(periodLabel, PAGE_MARGIN_MM, cursorY);

  cursorY += 6;
  doc.setTextColor(20, 24, 31);

  if (note) {
    doc.setFontSize(9);
    doc.text(note, PAGE_MARGIN_MM, cursorY);
    cursorY += 5;
  }

  return cursorY + 2;
}

function drawPageFooter(doc: jsPDF, sectionTitle: string, exportedAtLabel: string) {
  const footerY = PAGE_HEIGHT_MM - 8;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(120, 128, 140);
  doc.text(`BodegaHub · ${sectionTitle} · ${exportedAtLabel}`, PAGE_MARGIN_MM, footerY);
  doc.text(
    `Pagina ${doc.getCurrentPageInfo().pageNumber}`,
    PAGE_WIDTH_MM - PAGE_MARGIN_MM,
    footerY,
    { align: "right" },
  );
  doc.setTextColor(20, 24, 31);
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
  const sections = buildReportExportSections(data, metadata.filters);
  const exportedAtLabel = new Date(metadata.exportedAt).toLocaleString("es-VE");

  sections.forEach((section, sectionIndex) => {
    if (sectionIndex > 0) {
      doc.addPage();
    }

    const tableStartY = drawSectionHeader(
      doc,
      section.title,
      section.periodLabel,
      section.note,
    );
    const columnCount = section.columns.length;

    if (section.rows.length === 0) {
      autoTable(doc, {
        body: [[{ colSpan: columnCount, content: "Sin registros", styles: { halign: "center" } }]],
        margin: { bottom: 16, left: PAGE_MARGIN_MM, right: PAGE_MARGIN_MM, top: PAGE_MARGIN_MM },
        startY: tableStartY,
        theme: "grid",
        didDrawPage: () => {
          drawPageFooter(doc, section.title, exportedAtLabel);
        },
      });
      return;
    }

    autoTable(doc, {
      body: buildTableBody(section.columns, section.rows),
      columnStyles: buildColumnStyles(section.columns, section.rows),
      head: [section.columns.map((column) => column.header)],
      headStyles: {
        fillColor: TABLE_HEAD_FILL,
        fontSize: 9,
        fontStyle: "bold",
        halign: "left",
        textColor: 255,
      },
      bodyStyles: {
        cellPadding: 2.2,
        fontSize: 8,
        overflow: "linebreak",
        valign: "middle",
      },
      alternateRowStyles: {
        fillColor: TABLE_ALT_FILL,
      },
      margin: { bottom: 16, left: PAGE_MARGIN_MM, right: PAGE_MARGIN_MM, top: PAGE_MARGIN_MM },
      startY: tableStartY,
      styles: {
        cellWidth: "wrap",
        lineColor: [210, 214, 220],
        lineWidth: 0.1,
        overflow: "linebreak",
      },
      theme: "grid",
      didDrawPage: () => {
        drawPageFooter(doc, section.title, exportedAtLabel);
      },
    });
  });

  return doc;
}
