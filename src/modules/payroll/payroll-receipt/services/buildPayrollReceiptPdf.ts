import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

import { paymentMethodLabels } from "@/shared/payments/paymentMethods";
import { formatRefUsd, formatVesBs } from "@/shared/utils/currency";
import { formatDateTimeShort } from "@/shared/utils/date";

import type { PayrollCommissionSale, PayrollItem, PayrollPeriod } from "../../types";
import { formatPeriodLabel } from "../../utils/quincena";

const PAGE_MARGIN_MM = 14;
const PAGE_WIDTH_MM = 210;
const PAGE_HEIGHT_MM = 297;

const TABLE_HEAD_FILL: [number, number, number] = [41, 58, 74];
const TABLE_ALT_FILL: [number, number, number] = [245, 247, 250];

const kindLabels: Record<PayrollCommissionSale["kind"], string> = {
  late: "Cobrada tarde",
  normal: "De la quincena",
  reversal: "Reverso",
};

export type PayrollReceiptPdfInput = {
  item: PayrollItem;
  period: PayrollPeriod;
  sales: PayrollCommissionSale[];
  storeName: string;
};

function formatPaidAmount(item: PayrollItem) {
  if (item.paidAmount == null) {
    return "—";
  }

  return item.paidCurrency === "USD"
    ? `$${item.paidAmount.toFixed(2)}`
    : formatVesBs(item.paidAmount);
}

function drawPageFooter(doc: jsPDF, receiptLabel: string, exportedAtLabel: string) {
  const footerY = PAGE_HEIGHT_MM - 8;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(120, 128, 140);
  doc.text(`BodegaHub · ${receiptLabel} · ${exportedAtLabel}`, PAGE_MARGIN_MM, footerY);
  doc.text(
    `Pagina ${String(doc.getCurrentPageInfo().pageNumber)}`,
    PAGE_WIDTH_MM - PAGE_MARGIN_MM,
    footerY,
    { align: "right" },
  );
  doc.setTextColor(20, 24, 31);
}

function drawDocumentHeader(doc: jsPDF, input: PayrollReceiptPdfInput, exportedAtLabel: string) {
  let cursorY = PAGE_MARGIN_MM;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(20, 24, 31);
  doc.text("Recibo de comision", PAGE_MARGIN_MM, cursorY);

  cursorY += 7;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(90, 98, 110);
  doc.text(`Documento generado el ${exportedAtLabel}`, PAGE_MARGIN_MM, cursorY);

  cursorY += 8;
  doc.setTextColor(20, 24, 31);
  doc.setFontSize(9);

  const infoRows: [string, string][] = [
    ["Tienda", input.storeName],
    ["Cajero", input.item.fullName],
    ["Quincena", `${formatPeriodLabel(input.period.periodKey)} (${input.period.periodKey})`],
    ["Rango", `${input.period.fromDate} a ${input.period.toDate}`],
  ];

  infoRows.forEach(([label, value]) => {
    doc.setFont("helvetica", "bold");
    doc.text(`${label}:`, PAGE_MARGIN_MM, cursorY);
    doc.setFont("helvetica", "normal");
    doc.text(value, PAGE_MARGIN_MM + 32, cursorY);
    cursorY += 5;
  });

  return cursorY + 3;
}

/** Recibo A4 con el resumen de la comision y el anexo de ventas comisionadas. */
export function buildPayrollReceiptPdf(
  input: PayrollReceiptPdfInput,
  exportedAt = new Date().toISOString(),
): jsPDF {
  const { item, period, sales } = input;
  const doc = new jsPDF({ format: "a4", orientation: "portrait", unit: "mm" });
  const exportedAtLabel = new Date(exportedAt).toLocaleString("es-VE");
  const receiptLabel = `${period.periodKey} · ${item.fullName}`;
  const summaryStartY = drawDocumentHeader(doc, input, exportedAtLabel);

  autoTable(doc, {
    body: [
      ["Numero de ventas", String(item.salesCount)],
      ["Ventas comisionables (REF)", formatRefUsd(item.salesRef)],
      ["Porcentaje de comision", `${item.commissionPct.toFixed(2)} %`],
      ["Comision (REF)", formatRefUsd(item.commissionRef)],
      ["Reversos (REF)", formatRefUsd(item.reversalRef)],
      ["Total a pagar (REF)", formatRefUsd(item.totalRef)],
      ["Estado", item.status === "pagado" ? "Pagado" : "Pendiente"],
      ["Moneda del pago", item.paidCurrency ?? "—"],
      ["Monto pagado", formatPaidAmount(item)],
      [
        "Tasa aplicada",
        item.paidRateVes == null ? "—" : `1 REF = ${item.paidRateVes.toFixed(2)} VES`,
      ],
      ["Metodo", item.paidMethod ? paymentMethodLabels[item.paidMethod] : "—"],
      ["Referencia", item.paidReference ?? "—"],
      ["Fecha de pago", item.paidAt ? formatDateTimeShort(item.paidAt) : "—"],
    ],
    columnStyles: {
      0: { fontStyle: "bold", halign: "left" },
      1: { halign: "right" },
    },
    margin: { bottom: 16, left: PAGE_MARGIN_MM, right: PAGE_MARGIN_MM, top: PAGE_MARGIN_MM },
    startY: summaryStartY,
    styles: {
      cellPadding: 2,
      fontSize: 9,
      lineColor: [210, 214, 220],
      lineWidth: 0.1,
    },
    theme: "grid",
    didDrawPage: () => {
      drawPageFooter(doc, receiptLabel, exportedAtLabel);
    },
  });

  const summaryEndY = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable
    ?.finalY;
  let annexStartY = (summaryEndY ?? summaryStartY) + 10;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Anexo: ventas comisionadas", PAGE_MARGIN_MM, annexStartY);
  annexStartY += 4;

  const annexBody =
    sales.length === 0
      ? [
          [
            {
              colSpan: 5,
              content: "Sin ventas comisionadas en esta quincena",
              styles: { halign: "center" as const },
            },
          ],
        ]
      : sales.map((sale) => [
          sale.invoiceNumber ?? sale.saleId,
          formatDateTimeShort(sale.saleCreatedAt),
          kindLabels[sale.kind],
          formatRefUsd(sale.saleTotalRef),
          formatRefUsd(sale.commissionRef),
        ]);

  autoTable(doc, {
    body: annexBody,
    alternateRowStyles: { fillColor: TABLE_ALT_FILL },
    bodyStyles: { cellPadding: 2, fontSize: 8, overflow: "linebreak", valign: "middle" },
    columnStyles: {
      0: { halign: "left" },
      1: { halign: "left" },
      2: { halign: "left" },
      3: { halign: "right" },
      4: { halign: "right" },
    },
    head: [["Venta", "Fecha", "Tipo", "Total (REF)", "Comision (REF)"]],
    headStyles: {
      fillColor: TABLE_HEAD_FILL,
      fontSize: 9,
      fontStyle: "bold",
      halign: "left",
      textColor: 255,
    },
    margin: { bottom: 16, left: PAGE_MARGIN_MM, right: PAGE_MARGIN_MM, top: PAGE_MARGIN_MM },
    startY: annexStartY,
    styles: {
      lineColor: [210, 214, 220],
      lineWidth: 0.1,
      overflow: "linebreak",
    },
    theme: "grid",
    didDrawPage: () => {
      drawPageFooter(doc, receiptLabel, exportedAtLabel);
    },
  });

  return doc;
}
