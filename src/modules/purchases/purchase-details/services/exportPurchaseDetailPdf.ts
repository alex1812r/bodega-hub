import type { PurchaseDetails } from "@/modules/purchases/hooks/usePurchases";

import { buildPurchaseDetailPdfFilename } from "../utils/purchaseDetailPdfFilename";
import { buildPurchaseDetailPdf } from "./buildPurchaseDetailPdf";

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function exportPurchaseDetailPdf(purchase: PurchaseDetails) {
  const exportedAt = new Date().toISOString();
  const pdf = buildPurchaseDetailPdf(purchase, exportedAt);
  const filename = buildPurchaseDetailPdfFilename(purchase.purchaseNumber);

  triggerBlobDownload(pdf.output("blob"), filename);
}
