import { apiFetch } from "@/shared/api/apiFetch";

import type { SaleDetail } from "../../hooks/useSales";
import { buildSaleInvoiceFilename } from "../utils/buildSaleInvoiceFilename";
import { resolveSeller } from "../utils/resolveSeller";
import { buildSaleInvoicePdf } from "./buildSaleInvoicePdf";

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function exportSaleInvoicePdf(
  saleId: string,
  options?: { companyName?: string },
) {
  const sale = await apiFetch<SaleDetail>(`/api/sales/${saleId}`);
  const seller = resolveSeller(sale.userId);
  const generatedAt = new Date().toISOString();
  const pdf = buildSaleInvoicePdf({
    cashierName: seller.name,
    companyName: options?.companyName,
    generatedAt,
    sale,
  });
  const filename = buildSaleInvoiceFilename(sale.invoiceNumber);

  triggerBlobDownload(pdf.output("blob"), filename);
}
