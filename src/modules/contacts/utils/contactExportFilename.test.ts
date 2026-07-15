import { buildContactExportFilename } from "./contactExportFilename";

describe("buildContactExportFilename", () => {
  it("includes the export date in the filename", () => {
    expect(buildContactExportFilename(new Date("2026-05-20T15:30:00.000Z"))).toBe(
      "contactos-2026-05-20.xlsx",
    );
  });
});
