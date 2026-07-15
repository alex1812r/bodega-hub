import {
  getInventoryStockStatus,
  inventoryStockStatusLines,
  matchesStockStatusFilter,
  serializeStockStatusFilter,
} from "./inventoryStockStatus";

describe("inventoryStockStatus", () => {
  it("classifies stock levels", () => {
    expect(getInventoryStockStatus({ currentStock: 0, minStock: 5 })).toBe("out");
    expect(getInventoryStockStatus({ currentStock: 3, minStock: 5 })).toBe("low");
    expect(getInventoryStockStatus({ currentStock: 10, minStock: 5 })).toBe("ok");
  });

  it("filters by selected statuses", () => {
    const item = { currentStock: 0, minStock: 5 };

    expect(matchesStockStatusFilter(item, ["out"])).toBe(true);
    expect(matchesStockStatusFilter(item, ["ok", "low"])).toBe(false);
  });

  it("defines two-line labels for table chips", () => {
    expect(inventoryStockStatusLines.ok).toEqual(["En", "Stock"]);
    expect(inventoryStockStatusLines.low).toEqual(["Stock", "Bajo"]);
    expect(inventoryStockStatusLines.out).toEqual(["Sin", "Stock"]);
  });

  it("omits stockStatus query when all statuses are selected", () => {
    expect(serializeStockStatusFilter(["ok", "low", "out"])).toBeUndefined();
    expect(serializeStockStatusFilter(["low", "out"])).toBe("low,out");
  });
});
