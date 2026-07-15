export function buildSaleInvoiceFilename(invoiceNumber: string) {
  const sanitized = invoiceNumber
    .trim()
    .replace(/^#+/, "")
    .replace(/[^a-zA-Z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return sanitized ? `factura-${sanitized}.pdf` : "factura-venta.pdf";
}
