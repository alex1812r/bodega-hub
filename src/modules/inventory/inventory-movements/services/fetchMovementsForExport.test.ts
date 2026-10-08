/**
 * @jest-environment node
 */

import { fetchAllPaginatedItems } from "@/lib/api/fetchAllPaginatedItems";

import { fetchMovementsForExport } from "./fetchMovementsForExport";

jest.mock("../../../../lib/api/fetchAllPaginatedItems", () => ({
  fetchAllPaginatedItems: jest.fn(),
}));

const fetchAllPaginatedItemsMock = jest.mocked(fetchAllPaginatedItems);

describe("fetchMovementsForExport", () => {
  beforeEach(() => {
    fetchAllPaginatedItemsMock.mockReset();
  });

  it("passes active list filters to the movements API", async () => {
    fetchAllPaginatedItemsMock.mockResolvedValue([]);

    await fetchMovementsForExport({
      document: "C-00",
      documentKind: "compra",
      from: "2026-05-01",
      productId: "prod-cable",
      to: "2026-05-18",
      type: "compra",
    });

    expect(fetchAllPaginatedItemsMock).toHaveBeenCalledWith("/api/inventory/movements", {
      document: "C-00",
      documentKind: "compra",
      from: "2026-05-01",
      productId: "prod-cable",
      to: "2026-05-18",
      type: "compra",
    });
  });

  it("asks for the movements without a document when that is the filter", async () => {
    fetchAllPaginatedItemsMock.mockResolvedValue([]);

    await fetchMovementsForExport({ documentKind: "sin_documento" });

    expect(fetchAllPaginatedItemsMock).toHaveBeenCalledWith(
      "/api/inventory/movements",
      expect.objectContaining({ document: undefined, documentKind: "sin_documento" }),
    );
  });
});
