/**
 * @jest-environment node
 */

import { buildReportExportFilename, slugifyReportName } from "./reportExportFilename";

const generatedAt = new Date("2026-05-20T12:00:00.000Z");

describe("buildReportExportFilename", () => {
  it("nombra el archivo con el reporte activo y el rango", () => {
    expect(
      buildReportExportFilename(
        { from: "2026-09-01", reportName: "Ventas diarias", to: "2026-09-30" },
        generatedAt,
        "pdf",
      ),
    ).toBe("ventas-diarias_2026-09-01_2026-09-30.pdf");
  });

  it("sin reporte activo es el libro completo", () => {
    expect(
      buildReportExportFilename({ from: "2026-09-01", to: "2026-09-30" }, generatedAt, "xlsx"),
    ).toBe("reportes_2026-09-01_2026-09-30.xlsx");
  });

  it("usa un solo día cuando el rango empieza y termina el mismo día", () => {
    expect(buildReportExportFilename({ from: "2026-05-01", to: "2026-05-01" }, generatedAt)).toBe(
      "reportes_2026-05-01.xlsx",
    );
  });

  it("con un solo extremo usa ese día", () => {
    expect(buildReportExportFilename({ from: "2026-05-01" }, generatedAt)).toBe(
      "reportes_2026-05-01.xlsx",
    );
    expect(buildReportExportFilename({ to: "2026-05-18" }, generatedAt)).toBe(
      "reportes_2026-05-18.xlsx",
    );
  });

  it("sin rango lleva el día de Caracas en que se generó", () => {
    expect(buildReportExportFilename({ reportName: "Bajo stock" }, generatedAt, "pdf")).toBe(
      "bajo-stock_2026-05-20.pdf",
    );
    // 02:30 UTC del 21 todavía es 20 en Caracas (UTC-4).
    expect(buildReportExportFilename({}, new Date("2026-05-21T02:30:00.000Z"))).toBe(
      "reportes_2026-05-20.xlsx",
    );
  });

  it("ignora fechas que no son un día ISO", () => {
    expect(
      buildReportExportFilename({ from: "../../etc", to: "2026/05/18" }, generatedAt, "pdf"),
    ).toBe("reportes_2026-05-20.pdf");
  });
});

describe("slugifyReportName", () => {
  it.each([
    ["Ventas y margen por categoría", "ventas-y-margen-por-categoria"],
    ["Métodos de pago", "metodos-de-pago"],
    ["Depreciación FX", "depreciacion-fx"],
    ["  Cuentas   por cobrar  ", "cuentas-por-cobrar"],
    ['CON: <a>|b?*"\\/', "con-a-b"],
    ["", ""],
  ])("%p → %p", (name, expected) => {
    expect(slugifyReportName(name)).toBe(expected);
  });

  it("solo deja caracteres seguros en Windows y acota el largo", () => {
    const slug = slugifyReportName(`Ventas por hora y día de la semana ${"ñ".repeat(200)}`);

    expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(slug.length).toBeLessThanOrEqual(60);
  });
});
