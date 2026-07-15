import {
  compareSortValues,
  parseSort,
  sortItems,
  toggleSort,
} from "./sorting";

const PRODUCT_SORT_CONFIG = {
  defaultSortBy: "name",
  whitelist: ["sku", "name", "category", "currentCostRef", "salePriceRef", "currentStock", "status"],
} as const;

describe("sorting", () => {
  describe("parseSort", () => {
    it("returns defaults when params are missing", () => {
      expect(parseSort(new URLSearchParams(), PRODUCT_SORT_CONFIG)).toEqual({
        sortBy: "name",
        sortOrder: "asc",
      });
    });

    it("parses valid sort params", () => {
      const params = new URLSearchParams("sortBy=currentStock&sortOrder=desc");

      expect(parseSort(params, PRODUCT_SORT_CONFIG)).toEqual({
        sortBy: "currentStock",
        sortOrder: "desc",
      });
    });

    it("falls back for invalid sortBy", () => {
      const params = new URLSearchParams("sortBy=invalid&sortOrder=desc");

      expect(parseSort(params, PRODUCT_SORT_CONFIG)).toEqual({
        sortBy: "name",
        sortOrder: "desc",
      });
    });

    it("falls back for invalid sortOrder", () => {
      const params = new URLSearchParams("sortBy=sku&sortOrder=invalid");

      expect(parseSort(params, PRODUCT_SORT_CONFIG)).toEqual({
        sortBy: "sku",
        sortOrder: "asc",
      });
    });
  });

  describe("toggleSort", () => {
    it("starts asc on a new column", () => {
      expect(toggleSort({ sortBy: "name", sortOrder: "desc" }, "sku")).toEqual({
        sortBy: "sku",
        sortOrder: "asc",
      });
    });

    it("toggles asc to desc on the same column", () => {
      expect(toggleSort({ sortBy: "name", sortOrder: "asc" }, "name")).toEqual({
        sortBy: "name",
        sortOrder: "desc",
      });
    });

    it("toggles desc to asc on the same column", () => {
      expect(toggleSort({ sortBy: "name", sortOrder: "desc" }, "name")).toEqual({
        sortBy: "name",
        sortOrder: "asc",
      });
    });
  });

  describe("compareSortValues", () => {
    it("sorts numbers and nulls consistently", () => {
      expect(compareSortValues(10, 2)).toBeGreaterThan(0);
      expect(compareSortValues(null, 2)).toBeGreaterThan(0);
      expect(compareSortValues("b", "a")).toBeGreaterThan(0);
    });
  });

  describe("sortItems", () => {
    it("sorts items in memory", () => {
      const items = [{ name: "Zeta" }, { name: "Alpha" }];

      expect(sortItems(items, (item) => item.name, "asc")).toEqual([
        { name: "Alpha" },
        { name: "Zeta" },
      ]);
    });
  });
});
