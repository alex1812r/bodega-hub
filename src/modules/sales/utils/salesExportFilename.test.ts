/**
 * @jest-environment node
 */

import { buildSalesExportFilename } from "./salesExportFilename";

describe("buildSalesExportFilename", () => {
  it("uses a single date when from and to match", () => {
    expect(
      buildSalesExportFilename(
        { from: "2026-05-01", to: "2026-05-01" },
        new Date("2026-05-20T12:00:00.000Z"),
      ),
    ).toBe("ventas-2026-05-01.xlsx");
  });

  it("uses a range when from and to differ", () => {
    expect(
      buildSalesExportFilename(
        { from: "2026-05-01", to: "2026-05-18" },
        new Date("2026-05-20T12:00:00.000Z"),
      ),
    ).toBe("ventas-2026-05-01_2026-05-18.xlsx");
  });

  it("falls back to generation date when filters are empty", () => {
    expect(buildSalesExportFilename({}, new Date("2026-05-20T12:00:00.000Z"))).toBe(
      "ventas-2026-05-20.xlsx",
    );
  });
});
