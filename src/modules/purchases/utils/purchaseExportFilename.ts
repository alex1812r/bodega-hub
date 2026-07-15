export type PurchaseExportFilenameFilters = {
  from?: string;
  to?: string;
};

export function buildPurchaseExportFilename(
  filters: PurchaseExportFilenameFilters,
  generatedAt = new Date(),
): string {
  const generatedDate = generatedAt.toISOString().slice(0, 10);
  const from = filters.from?.trim();
  const to = filters.to?.trim();
  const end = to || from || generatedDate;
  const start = from || end;

  if (start === end) {
    return `compras-${start}.xlsx`;
  }

  return `compras-${start}_${end}.xlsx`;
}
