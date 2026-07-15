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
      from: "2026-05-01",
      productId: "prod-cable",
      to: "2026-05-18",
      type: "compra",
    });

    expect(fetchAllPaginatedItemsMock).toHaveBeenCalledWith("/api/inventory/movements", {
      from: "2026-05-01",
      productId: "prod-cable",
      to: "2026-05-18",
      type: "compra",
    });
  });
});
