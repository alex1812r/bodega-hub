import { buildPurchaseExportFilename } from "./purchaseExportFilename";

describe("buildPurchaseExportFilename", () => {
  it("uses a single date when only one bound is provided", () => {
    expect(
      buildPurchaseExportFilename({ from: "2026-05-20" }, new Date("2026-07-03T12:00:00.000Z")),
    ).toBe("compras-2026-05-20.xlsx");
  });

  it("uses a date range when both bounds are provided", () => {
    expect(
      buildPurchaseExportFilename(
        { from: "2026-05-01", to: "2026-05-18" },
        new Date("2026-07-03T12:00:00.000Z"),
      ),
    ).toBe("compras-2026-05-01_2026-05-18.xlsx");
  });

  it("falls back to the export date when no date filters exist", () => {
    expect(buildPurchaseExportFilename({}, new Date("2026-07-03T12:00:00.000Z"))).toBe(
      "compras-2026-07-03.xlsx",
    );
  });
});
