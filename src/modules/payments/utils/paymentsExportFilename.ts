export type PaymentsExportFilenameFilters = {
  contactId?: string;
  direction?: string;
  purchaseId?: string;
  saleId?: string;
};

export function buildPaymentsExportFilename(
  filters: PaymentsExportFilenameFilters = {},
  generatedAt = new Date(),
): string {
  const generatedDate = generatedAt.toISOString().slice(0, 10);

  return `pagos-${generatedDate}.xlsx`;
}
