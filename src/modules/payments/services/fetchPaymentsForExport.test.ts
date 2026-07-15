/**
 * @jest-environment node
 */

import { fetchAllPaginatedItems } from "@/lib/api/fetchAllPaginatedItems";

import { fetchPaymentsForExport } from "./fetchPaymentsForExport";

jest.mock("../../../lib/api/fetchAllPaginatedItems", () => ({
  fetchAllPaginatedItems: jest.fn(),
}));

const fetchAllPaginatedItemsMock = fetchAllPaginatedItems as jest.MockedFunction<
  typeof fetchAllPaginatedItems
>;

describe("fetchPaymentsForExport", () => {
  beforeEach(() => {
    fetchAllPaginatedItemsMock.mockReset();
  });

  it("requests all paginated payments with active list filters", async () => {
    fetchAllPaginatedItemsMock.mockResolvedValue([]);

    await fetchPaymentsForExport({
      contactId: "cont-customer",
      direction: "entrada",
      purchaseId: "purchase-001",
      saleId: "sale-002",
    });

    expect(fetchAllPaginatedItemsMock).toHaveBeenCalledWith("/api/payments", {
      contactId: "cont-customer",
      direction: "entrada",
      purchaseId: "purchase-001",
      saleId: "sale-002",
    });
  });
});
