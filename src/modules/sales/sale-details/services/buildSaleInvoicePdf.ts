import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

import type { SaleDetail } from "../../hooks/useSales";
import { defaultReceiptCompany } from "../utils/receiptCompany";
import {
  formatInvoiceHeading,
  getTaxPercentLabel,
} from "../utils/saleDetailLabels";
import {
  RECEIPT_CONTENT_WIDTH_MM,
  RECEIPT_MARGIN_MM,
  RECEIPT_WIDTH_MM,
} from "../utils/receiptPrint";

export type SaleInvoicePdfInput = {
  cashierName: string;
  companyName?: string;
  generatedAt: string;
  sale: SaleDetail;
};

function formatRefPdf(value: number) {
  return `$${value.toFixed(2)}`;
}

function formatVesPdf(value: number) {
  return `Bs. ${value.toLocaleString("es-VE", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })}`;
}

function drawCenteredText(doc: jsPDF, text: string, y: number, fontSize: number, bold = false) {
  doc.setFont("helvetica", bold ? "bold" : "normal");
  doc.setFontSize(fontSize);
  doc.text(text, RECEIPT_WIDTH_MM / 2, y, { align: "center" });
}

function drawRow(doc: jsPDF, label: string, value: string, y: number, bold = false) {
  doc.setFont("helvetica", bold ? "bold" : "normal");
  doc.setFontSize(bold ? 9 : 8);
  doc.text(label, RECEIPT_MARGIN_MM, y);
  doc.text(value, RECEIPT_WIDTH_MM - RECEIPT_MARGIN_MM, y, { align: "right" });
}

function drawDashedRule(doc: jsPDF, y: number) {
  doc.setDrawColor(180, 180, 180);
  doc.setLineWidth(0.1);
  doc.line(RECEIPT_MARGIN_MM, y, RECEIPT_WIDTH_MM - RECEIPT_MARGIN_MM, y);
}

export function buildSaleInvoicePdf(input: SaleInvoicePdfInput): jsPDF {
  const { cashierName, companyName = defaultReceiptCompany.name, sale } = input;
  const doc = new jsPDF({
    format: [RECEIPT_WIDTH_MM, 297],
    orientation: "portrait",
    unit: "mm",
  });
  const invoiceLabel = formatInvoiceHeading(sale.invoiceNumber);
  const taxPercent = getTaxPercentLabel(sale.subtotalRef, sale.taxRef);
  const saleDateLabel = new Date(sale.createdAt).toLocaleString("es-VE", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  let cursorY = RECEIPT_MARGIN_MM + 2;

  doc.setTextColor(0, 0, 0);
  drawCenteredText(doc, companyName, cursorY, 10, true);
  cursorY += 4;
  drawCenteredText(doc, `RIF: ${defaultReceiptCompany.rif}`, cursorY, 7);
  cursorY += 3.5;
  drawCenteredText(doc, defaultReceiptCompany.address, cursorY, 7);
  cursorY += 3.5;
  drawCenteredText(doc, `Tel: ${defaultReceiptCompany.phone}`, cursorY, 7);

  cursorY += 4;
  drawDashedRule(doc, cursorY);
  cursorY += 4;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(`Factura: ${invoiceLabel}`, RECEIPT_MARGIN_MM, cursorY);
  cursorY += 3.5;
  doc.text(`Fecha: ${saleDateLabel}`, RECEIPT_MARGIN_MM, cursorY);
  cursorY += 3.5;
  doc.text(`Cliente: ${sale.customer?.name ?? "—"}`, RECEIPT_MARGIN_MM, cursorY);
  cursorY += 3.5;
  doc.text(`CI/RIF: ${sale.customer?.taxId ?? "—"}`, RECEIPT_MARGIN_MM, cursorY);
  cursorY += 3.5;
  doc.text(`Cajero: ${cashierName}`, RECEIPT_MARGIN_MM, cursorY);

  cursorY += 4;
  drawDashedRule(doc, cursorY);
  cursorY += 3;

  const lineItems =
    sale.items.length === 0
      ? [[{ colSpan: 3, content: "Sin productos", styles: { halign: "center" as const } }]]
      : sale.items.map((item) => [
          String(item.quantity),
          item.product?.name ?? item.productId,
          formatRefPdf(item.subtotalRef),
        ]);

  autoTable(doc, {
    body: lineItems,
    bodyStyles: {
      cellPadding: 1,
      fontSize: 7,
      overflow: "linebreak",
      textColor: [0, 0, 0],
      valign: "top",
    },
    columnStyles: {
      0: { cellWidth: 8, halign: "center" },
      1: { cellWidth: RECEIPT_CONTENT_WIDTH_MM - 28 },
      2: { cellWidth: 20, halign: "right" },
    },
    head: [["Cant", "Descripcion", "Total"]],
    headStyles: {
      fillColor: [255, 255, 255],
      fontSize: 7,
      fontStyle: "bold",
      halign: "left",
      textColor: [0, 0, 0],
    },
    margin: {
      bottom: RECEIPT_MARGIN_MM,
      left: RECEIPT_MARGIN_MM,
      right: RECEIPT_MARGIN_MM,
    },
    startY: cursorY,
    styles: {
      cellWidth: "wrap",
      lineColor: [220, 220, 220],
      lineWidth: 0.05,
      overflow: "linebreak",
    },
    theme: "plain",
  });

  const totalsStartY = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable
    ?.finalY;
  cursorY = (totalsStartY ?? cursorY) + 4;
  drawDashedRule(doc, cursorY);
  cursorY += 4;

  drawRow(doc, "Subtotal:", formatRefPdf(sale.subtotalRef), cursorY);
  cursorY += 3.5;

  if (sale.discountRef > 0) {
    drawRow(doc, "Descuento:", `-${formatRefPdf(sale.discountRef)}`, cursorY);
    cursorY += 3.5;
  }

  drawRow(doc, `IVA (${taxPercent}%):`, formatRefPdf(sale.taxRef), cursorY);
  cursorY += 4;
  drawRow(doc, "TOTAL REF:", formatRefPdf(sale.totalRef), cursorY, true);
  cursorY += 4;
  drawRow(doc, "TOTAL VES:", formatVesPdf(sale.totalVes), cursorY, true);
  cursorY += 4;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.text(`Tasa: ${sale.refRateVes.toFixed(2)} VES/REF`, RECEIPT_MARGIN_MM, cursorY);

  cursorY += 5;
  drawDashedRule(doc, cursorY);
  cursorY += 4;
  drawCenteredText(doc, "¡Gracias por su compra!", cursorY, 7);
  cursorY += 3.5;
  drawCenteredText(doc, "Conserve este ticket para reclamos.", cursorY, 7);

  return doc;
}
