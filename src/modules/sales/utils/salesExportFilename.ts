export type SalesExportFilenameFilters = {
  from?: string;
  to?: string;
};

export function buildSalesExportFilename(
  filters: SalesExportFilenameFilters,
  generatedAt = new Date(),
  extension: "xlsx" = "xlsx",
): string {
  const generatedDate = generatedAt.toISOString().slice(0, 10);
  const from = filters.from?.trim();
  const to = filters.to?.trim();
  const end = to || from || generatedDate;
  const start = from || end;

  if (start === end) {
    return `ventas-${start}.${extension}`;
  }

  return `ventas-${start}_${end}.${extension}`;
}
