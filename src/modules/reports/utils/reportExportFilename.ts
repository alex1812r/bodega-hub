import { getCaracasIsoDate } from "@/shared/utils/caracasBusinessDay";

export type ReportExportFilenameFilters = {
  from?: string;
  /**
   * Nombre del reporte abierto al exportar («Ventas diarias»). Sin él, el
   * archivo se llama `reportes` (libro completo sin reporte activo: plataforma).
   */
  reportName?: string;
  to?: string;
};

const BOOK_SLUG = "reportes";
const SLUG_MAX_LENGTH = 60;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * «Ventas y margen por categoría» → `ventas-y-margen-por-categoria`: minúsculas,
 * sin tildes ni espacios y solo `a-z`, `0-9` y `-`, válido en Windows.
 */
export function slugifyReportName(name: string) {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/^-+|-+$/g, "");
}

function readIsoDay(value?: string) {
  const day = value?.trim() ?? "";

  return ISO_DAY.test(day) ? day : undefined;
}

/**
 * `<reporte>_<desde>_<hasta>.<ext>`: `ventas-diarias_2026-09-01_2026-09-30.pdf`,
 * `reportes_2026-09-01_2026-09-30.xlsx`. Con un solo día (o un solo extremo),
 * `<reporte>_<día>`. Sin rango, el día de Caracas en que se generó.
 */
export function buildReportExportFilename(
  filters: ReportExportFilenameFilters,
  generatedAt = new Date(),
  extension: "pdf" | "xlsx" = "xlsx",
): string {
  const slug = slugifyReportName(filters.reportName ?? "") || BOOK_SLUG;
  const from = readIsoDay(filters.from);
  const to = readIsoDay(filters.to);
  const end = to ?? from ?? getCaracasIsoDate(generatedAt);
  const start = from ?? end;
  const range = start === end ? start : `${start}_${end}`;

  return `${slug}_${range}.${extension}`;
}
