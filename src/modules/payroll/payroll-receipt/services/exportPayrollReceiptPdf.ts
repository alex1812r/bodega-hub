import { buildPayrollReceiptPdfFilename } from "../utils/payrollReceiptFilename";

import { buildPayrollReceiptPdf, type PayrollReceiptPdfInput } from "./buildPayrollReceiptPdf";

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function exportPayrollReceiptPdf(input: PayrollReceiptPdfInput) {
  const exportedAt = new Date().toISOString();
  const pdf = buildPayrollReceiptPdf(input, exportedAt);
  const filename = buildPayrollReceiptPdfFilename(input.period.periodKey, input.item.fullName);

  triggerBlobDownload(pdf.output("blob"), filename);
}
