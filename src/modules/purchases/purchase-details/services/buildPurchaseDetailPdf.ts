import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

import type { PurchaseDetails } from "@/modules/purchases/hooks/usePurchases";
import { formatPurchaseNumberForExport } from "@/modules/purchases/utils/purchaseExportSheetColumns";
import type { PurchaseStatus } from "@/shared/mocks/erp-data";
import { formatRefUsd, formatVesBs } from "@/shared/utils/currency";
import { formatDateTimeShort } from "@/shared/utils/date";

const PAGE_MARGIN_MM = 14;
const PAGE_WIDTH_MM = 210;
const PAGE_HEIGHT_MM = 297;

const TABLE_HEAD_FILL: [number, number, number] = [41, 58, 74];
const TABLE_ALT_FILL: [number, number, number] = [245, 247, 250];

const purchaseStatusLabels: Record<PurchaseStatus, string> = {
  cancelado: "Cancelado",
  devuelto: "Devuelto",
  pedido: "Pedido",
  recibido: "Recibido",
};

function drawPageFooter(doc: jsPDF, purchaseLabel: string, exportedAtLabel: string) {
  const footerY = PAGE_HEIGHT_MM - 8;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(120, 128, 140);
  doc.text(`Control Ventas · ${purchaseLabel} · ${exportedAtLabel}`, PAGE_MARGIN_MM, footerY);
  doc.text(
    `Pagina ${doc.getCurrentPageInfo().pageNumber}`,
    PAGE_WIDTH_MM - PAGE_MARGIN_MM,
    footerY,
    { align: "right" },
  );
  doc.setTextColor(20, 24, 31);
}

function drawDocumentHeader(doc: jsPDF, purchase: PurchaseDetails, exportedAtLabel: string) {
  let cursorY = PAGE_MARGIN_MM;
  const purchaseLabel = formatPurchaseNumberForExport(purchase.purchaseNumber);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(20, 24, 31);
  doc.text(`Compra ${purchaseLabel}`, PAGE_MARGIN_MM, cursorY);

  cursorY += 7;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(90, 98, 110);
  doc.text(`Documento generado el ${exportedAtLabel}`, PAGE_MARGIN_MM, cursorY);

  cursorY += 8;
  doc.setTextColor(20, 24, 31);
  doc.setFontSize(9);

  const infoRows: Array<[string, string]> = [
    ["Fecha", formatDateTimeShort(purchase.createdAt)],
    ["Proveedor", purchase.supplier?.name ?? purchase.supplierId],
    ["Estado", purchaseStatusLabels[purchase.status]],
    ["Tasa REF/VES", `1 REF = ${purchase.refRateVes.toFixed(2)} VES`],
  ];

  if (purchase.notes?.trim()) {
    infoRows.push(["Observaciones", purchase.notes.trim()]);
  }

  infoRows.forEach(([label, value]) => {
    doc.setFont("helvetica", "bold");
    doc.text(`${label}:`, PAGE_MARGIN_MM, cursorY);
    doc.setFont("helvetica", "normal");
    doc.text(value, PAGE_MARGIN_MM + 32, cursorY);
    cursorY += 5;
  });

  return cursorY + 3;
}

export function buildPurchaseDetailPdf(
  purchase: PurchaseDetails,
  exportedAt = new Date().toISOString(),
): jsPDF {
  const doc = new jsPDF({
    format: "a4",
    orientation: "portrait",
    unit: "mm",
  });
  const exportedAtLabel = new Date(exportedAt).toLocaleString("es-VE");
  const purchaseLabel = formatPurchaseNumberForExport(purchase.purchaseNumber);
  const tableStartY = drawDocumentHeader(doc, purchase, exportedAtLabel);

  const itemBody =
    purchase.items.length === 0
      ? [[{ colSpan: 4, content: "Sin productos registrados", styles: { halign: "center" as const } }]]
      : purchase.items.map((item) => {
          const productLabel =
            item.entryMode === "pack" &&
            item.packCount &&
            item.packLabel &&
            item.unitsPerPack
              ? `${item.product?.name ?? item.productId}\n${item.packCount} ${item.packLabel}${item.packCount > 1 ? "s" : ""} × ${item.unitsPerPack} u`
              : (item.product?.name ?? item.productId);

          return [productLabel, String(item.quantity), formatRefUsd(item.unitCostRef), formatRefUsd(item.subtotalRef)];
        });

  autoTable(doc, {
    body: itemBody,
    columnStyles: {
      0: { halign: "left" },
      1: { halign: "right" },
      2: { halign: "right" },
      3: { halign: "right" },
    },
    head: [["Producto", "Cantidad", "Costo unit. (REF)", "Subtotal (REF)"]],
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
      drawPageFooter(doc, purchaseLabel, exportedAtLabel);
    },
  });

  const totalsStartY = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable
    ?.finalY;
  const summaryStartY = (totalsStartY ?? tableStartY) + 8;

  autoTable(doc, {
    body: [
      ["Subtotal (REF)", formatRefUsd(purchase.subtotalRef)],
      ["Descuento (REF)", formatRefUsd(purchase.discountRef)],
      ["Impuesto (REF)", formatRefUsd(purchase.taxRef)],
      ["Total (REF)", formatRefUsd(purchase.totalRef)],
      ["Total (VES)", formatVesBs(purchase.totalVes)],
      ["Pagado (VES)", formatVesBs(purchase.paidVes)],
      ["Pendiente (VES)", formatVesBs(Math.max(0, purchase.totalVes - purchase.paidVes))],
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
      drawPageFooter(doc, purchaseLabel, exportedAtLabel);
    },
  });

  return doc;
}
