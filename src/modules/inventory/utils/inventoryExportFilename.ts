export function buildInventoryExportFilename(
  generatedAt = new Date(),
  extension: "xlsx" = "xlsx",
): string {
  const generatedDate = generatedAt.toISOString().slice(0, 10);
  return `inventario-${generatedDate}.${extension}`;
}
