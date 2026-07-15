/**
 * @jest-environment node
 */

import { buildPaymentsExportFilename } from "./paymentsExportFilename";

describe("buildPaymentsExportFilename", () => {
  it("uses generation date in the filename", () => {
    expect(
      buildPaymentsExportFilename(
        { contactId: "cont-customer", direction: "entrada" },
        new Date("2026-05-20T12:00:00.000Z"),
      ),
    ).toBe("pagos-2026-05-20.xlsx");
  });
});
