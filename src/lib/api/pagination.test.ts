/**
 * @jest-environment node
 */

import { getPaginatedItems, paginateList, parsePagination } from "./pagination";

describe("pagination", () => {
  it("uses skip=0 and limit=10 by default", () => {
    expect(parsePagination(new URLSearchParams())).toEqual({ limit: 10, skip: 0 });
  });

  it("enforces minimum limit of 10", () => {
    expect(parsePagination(new URLSearchParams("limit=3"))).toEqual({ limit: 10, skip: 0 });
  });

  it("extracts items from paginated responses", () => {
    expect(getPaginatedItems(undefined)).toEqual([]);
    expect(
      getPaginatedItems({
        items: [1, 2],
        limit: 10,
        skip: 0,
        total: 2,
      }),
    ).toEqual([1, 2]);
  });

  it("paginates items with skip and limit", () => {
    const result = paginateList([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], new URLSearchParams("skip=2&limit=10"));

    expect(result).toEqual({
      items: [3, 4, 5, 6, 7, 8, 9, 10, 11],
      limit: 10,
      skip: 2,
      total: 11,
    });
  });
});
