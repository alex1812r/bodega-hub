/**
 * @jest-environment node
 */

import { buildPurchaseDetailPdfFilename } from "./purchaseDetailPdfFilename";

describe("buildPurchaseDetailPdfFilename", () => {
  it("builds filename from purchase number", () => {
    expect(buildPurchaseDetailPdfFilename("C-000001")).toBe("compra-C-000001.pdf");
  });

  it("strips leading hash and normalizes spaces", () => {
    expect(buildPurchaseDetailPdfFilename("#C-000002")).toBe("compra-C-000002.pdf");
  });
});
