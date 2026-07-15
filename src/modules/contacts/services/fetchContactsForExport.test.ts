/**
 * @jest-environment node
 */

import { fetchAllPaginatedItems } from "@/lib/api/fetchAllPaginatedItems";

import { fetchContactsForExport } from "./fetchContactsForExport";

jest.mock("../../../lib/api/fetchAllPaginatedItems", () => ({
  fetchAllPaginatedItems: jest.fn(),
}));

const fetchAllPaginatedItemsMock = fetchAllPaginatedItems as jest.MockedFunction<
  typeof fetchAllPaginatedItems
>;

describe("fetchContactsForExport", () => {
  beforeEach(() => {
    fetchAllPaginatedItemsMock.mockReset();
  });

  it("requests all paginated contacts with active list filters", async () => {
    fetchAllPaginatedItemsMock.mockResolvedValue([]);

    await fetchContactsForExport({
      isActive: true,
      search: "Ferreteria",
      type: "cliente",
    });

    expect(fetchAllPaginatedItemsMock).toHaveBeenCalledWith("/api/contacts", {
      isActive: true,
      search: "Ferreteria",
      type: "cliente",
    });
  });
});
