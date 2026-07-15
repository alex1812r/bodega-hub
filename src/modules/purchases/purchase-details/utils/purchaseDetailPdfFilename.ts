export function buildPurchaseDetailPdfFilename(purchaseNumber: string) {
  const normalized = purchaseNumber.trim().replace(/^#/, "").replace(/\s+/g, "-");
  return `compra-${normalized}.pdf`;
}
