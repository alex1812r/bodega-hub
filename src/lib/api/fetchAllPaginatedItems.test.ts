/**
 * @jest-environment node
 */

import { fetchAllPaginatedItems } from "./fetchAllPaginatedItems";

jest.mock("../../shared/api/apiFetch", () => ({
  apiFetch: jest.fn(),
}));

const { apiFetch } = jest.requireMock<{ apiFetch: jest.Mock }>("../../shared/api/apiFetch");

describe("fetchAllPaginatedItems", () => {
  beforeEach(() => {
    apiFetch.mockReset();
  });

  it("fetches every page until total is reached", async () => {
    apiFetch
      .mockResolvedValueOnce({
        items: [{ id: "1" }, { id: "2" }],
        limit: 2,
        skip: 0,
        total: 3,
      })
      .mockResolvedValueOnce({
        items: [{ id: "3" }],
        limit: 2,
        skip: 2,
        total: 3,
      });

    await expect(
      fetchAllPaginatedItems<{ id: string }>("/api/reports/daily-sales", { from: "2026-05-01" }, 2),
    ).resolves.toEqual([{ id: "1" }, { id: "2" }, { id: "3" }]);

    expect(apiFetch).toHaveBeenNthCalledWith(1, "/api/reports/daily-sales", {
      query: { from: "2026-05-01", limit: 2, skip: 0 },
    });
    expect(apiFetch).toHaveBeenNthCalledWith(2, "/api/reports/daily-sales", {
      query: { from: "2026-05-01", limit: 2, skip: 2 },
    });
  });
});
