import { sortPosCatalogProducts } from "./sortPosCatalogProducts";

describe("sortPosCatalogProducts", () => {
  it("puts products with stock before products without stock, then sorts by name", () => {
    const sorted = sortPosCatalogProducts([
      { currentStock: 0, name: "Aceite" },
      { currentStock: 5, name: "Zumo" },
      { currentStock: 0, name: "Yogur" },
      { currentStock: 2, name: "Arroz" },
      { currentStock: 1, name: "azucar" },
    ]);

    expect(sorted.map((item) => item.name)).toEqual([
      "Arroz",
      "azucar",
      "Zumo",
      "Aceite",
      "Yogur",
    ]);
  });

  it("does not rank by stock quantity among in-stock products", () => {
    const sorted = sortPosCatalogProducts([
      { currentStock: 100, name: "Beta" },
      { currentStock: 1, name: "Alpha" },
    ]);

    expect(sorted.map((item) => `${item.name}:${item.currentStock}`)).toEqual([
      "Alpha:1",
      "Beta:100",
    ]);
  });
});
