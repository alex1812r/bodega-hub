/**
 * @jest-environment node
 */

import { buildReportExportFilename } from "./reportExportFilename";

describe("buildReportExportFilename", () => {
  it("uses a single date when from and to match", () => {
    expect(
      buildReportExportFilename(
        { from: "2026-05-01", to: "2026-05-01" },
        new Date("2026-05-20T12:00:00.000Z"),
      ),
    ).toBe("reportes-2026-05-01.xlsx");
  });

  it("uses a range when from and to differ", () => {
    expect(
      buildReportExportFilename(
        { from: "2026-05-01", to: "2026-05-18" },
        new Date("2026-05-20T12:00:00.000Z"),
      ),
    ).toBe("reportes-2026-05-01_2026-05-18.xlsx");
  });

  it("falls back to generation date when filters are empty", () => {
    expect(buildReportExportFilename({}, new Date("2026-05-20T12:00:00.000Z"))).toBe(
      "reportes-2026-05-20.xlsx",
    );
  });

  it("supports pdf extension", () => {
    expect(
      buildReportExportFilename(
        { from: "2026-05-01", to: "2026-05-18" },
        new Date("2026-05-20T12:00:00.000Z"),
        "pdf",
      ),
    ).toBe("reportes-2026-05-01_2026-05-18.pdf");
  });
});
