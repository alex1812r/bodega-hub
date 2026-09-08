const DIACRITICS = /\p{Diacritic}/gu;

/** `recibo-nomina-2026-09-Q1-maria-perez.pdf` */
export function buildPayrollReceiptPdfFilename(periodKey: string, fullName: string) {
  const normalizedName = fullName
    .normalize("NFD")
    .replace(DIACRITICS, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const normalizedPeriod = periodKey.trim().replace(/\s+/g, "-");

  return `recibo-nomina-${normalizedPeriod}${normalizedName ? `-${normalizedName}` : ""}.pdf`;
}
