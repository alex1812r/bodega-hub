import type { ProductMock } from "@/shared/mocks/erp-data";

import { applyProductSort, parseProductSort, sortProductItems } from "./productSort";

function product(id: string, currentCostRef: number, salePriceRef: number): ProductMock {
  return {
    categoryId: "cat",
    currentCostRef,
    currentStock: 1,
    id,
    isActive: true,
    minStock: 0,
    name: id,
    salePriceRef,
    sku: id,
  };
}

function recordingQuery() {
  const order = jest.fn();
  const query = { order };

  order.mockReturnValue(query);

  return query;
}

describe("productSort: marginPct", () => {
  it("accepts marginPct as a sort column", () => {
    expect(parseProductSort(new URLSearchParams("sortBy=marginPct&sortOrder=desc"))).toEqual({
      sortBy: "marginPct",
      sortOrder: "desc",
    });
  });

  it.each([
    ["asc", true],
    ["desc", false],
  ])("orders by margin_pct %s with the products without cost last", (sortOrder, ascending) => {
    const query = recordingQuery();

    applyProductSort(query, new URLSearchParams(`sortBy=marginPct&sortOrder=${sortOrder}`));

    expect(query.order.mock.calls).toEqual([
      ["margin_pct", { ascending, nullsFirst: false }],
      // Desempate estable para paginar.
      ["id", { ascending: true }],
    ]);
  });

  it("keeps the other columns as they were", () => {
    const query = recordingQuery();

    applyProductSort(query, new URLSearchParams("sortBy=salePriceRef&sortOrder=desc"));

    expect(query.order.mock.calls[0]).toEqual(["sale_price_ref", { ascending: false }]);
  });

  describe("sortProductItems (mock parity)", () => {
    const items = [
      product("sin-costo-a", 0, 5),
      product("alta", 10, 14), // 40 %
      product("negativa", 10, 8), // −20 %
      product("sin-costo-b", 0, 0),
      product("media", 10, 12), // 20 %
    ];

    it("sorts ascending with the products without cost at the end", () => {
      expect(sortProductItems(items, "marginPct", "asc").map((item) => item.id)).toEqual([
        "negativa",
        "media",
        "alta",
        "sin-costo-a",
        "sin-costo-b",
      ]);
    });

    it("sorts descending with the products without cost still at the end", () => {
      expect(sortProductItems(items, "marginPct", "desc").map((item) => item.id)).toEqual([
        "alta",
        "media",
        "negativa",
        "sin-costo-a",
        "sin-costo-b",
      ]);
    });

    it("does not mutate the list it receives", () => {
      const before = items.map((item) => item.id);

      sortProductItems(items, "marginPct", "desc");

      expect(items.map((item) => item.id)).toEqual(before);
    });
  });
});
