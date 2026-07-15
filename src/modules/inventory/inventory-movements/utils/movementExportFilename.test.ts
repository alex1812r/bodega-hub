import { buildMovementsExportFilename } from "./movementExportFilename";

describe("buildMovementsExportFilename", () => {
  it("uses a single date when from and to match", () => {
    expect(
      buildMovementsExportFilename(
        { from: "2026-05-20", to: "2026-05-20" },
        new Date("2026-05-21T12:00:00.000Z"),
      ),
    ).toBe("movimientos-2026-05-20.xlsx");
  });

  it("uses a date range when from and to differ", () => {
    expect(
      buildMovementsExportFilename(
        { from: "2026-05-01", to: "2026-05-18" },
        new Date("2026-05-21T12:00:00.000Z"),
      ),
    ).toBe("movimientos-2026-05-01_2026-05-18.xlsx");
  });

  it("falls back to today when no date filters exist", () => {
    expect(
      buildMovementsExportFilename({}, new Date("2026-05-20T12:00:00.000Z")),
    ).toBe("movimientos-2026-05-20.xlsx");
  });
});
