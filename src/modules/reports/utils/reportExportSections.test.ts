import { formatReportExportPeriodLabel } from "./reportExportSections";

// REP-F2: el periodo de la exportación se lee en español, no en ISO.
describe("formatReportExportPeriodLabel", () => {
  it.each([
    ["2026-04-01", "2026-04-30", "Periodo: del 1 abr 2026 al 30 abr 2026"],
    ["2025-12-28", "2026-01-03", "Periodo: del 28 dic 2025 al 3 ene 2026"],
    ["2026-05-18", "2026-05-18", "Periodo: 18 may 2026"],
    ["2026-05-01", undefined, "Desde: 1 may 2026"],
    [undefined, "2026-05-18", "Hasta: 18 may 2026"],
    [" ", "", "Sin filtro de periodo"],
    [undefined, undefined, "Sin filtro de periodo"],
  ])("%p – %p → %s", (from, to, expected) => {
    expect(formatReportExportPeriodLabel(from, to)).toBe(expected);
  });

  it("no usa caracteres fuera de Latin-1 (el PDF no los dibuja)", () => {
    expect(formatReportExportPeriodLabel("2026-04-01", "2026-04-30")).toMatch(/^[\u0000-\u00ff]+$/);
  });
});
