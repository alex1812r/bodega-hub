export function buildContactExportFilename(generatedAt = new Date()): string {
  const date = generatedAt.toISOString().slice(0, 10);
  return `contactos-${date}.xlsx`;
}
