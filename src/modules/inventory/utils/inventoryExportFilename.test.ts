import { buildInventoryExportFilename } from "./inventoryExportFilename";

describe("buildInventoryExportFilename", () => {
  it("includes the generation date", () => {
    expect(buildInventoryExportFilename(new Date("2026-05-20T12:00:00.000Z"))).toBe(
      "inventario-2026-05-20.xlsx",
    );
  });
});
