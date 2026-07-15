export type ReportExportFilenameFilters = {
  from?: string;
  to?: string;
};

export function buildReportExportFilename(
  filters: ReportExportFilenameFilters,
  generatedAt = new Date(),
  extension: "pdf" | "xlsx" = "xlsx",
): string {
  const generatedDate = generatedAt.toISOString().slice(0, 10);
  const from = filters.from?.trim();
  const to = filters.to?.trim();
  const end = to || from || generatedDate;
  const start = from || end;

  if (start === end) {
    return `reportes-${start}.${extension}`;
  }

  return `reportes-${start}_${end}.${extension}`;
}
