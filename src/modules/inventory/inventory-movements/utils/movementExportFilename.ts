export type MovementExportFilenameFilters = {
  from?: string;
  to?: string;
};

export function buildMovementsExportFilename(
  filters: MovementExportFilenameFilters,
  generatedAt = new Date(),
): string {
  const generatedDate = generatedAt.toISOString().slice(0, 10);
  const from = filters.from?.trim();
  const to = filters.to?.trim();
  const end = to || from || generatedDate;
  const start = from || end;

  if (start === end) {
    return `movimientos-${start}.xlsx`;
  }

  return `movimientos-${start}_${end}.xlsx`;
}
