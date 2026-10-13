import { mapCategory } from "./categories";
import { mapProduct } from "./products";

describe("category mappers · % de ganancia sugerido", () => {
  const row = { id: "cat-1", is_active: true, name: "Bebidas", tax_rate: "16.00" };

  it("mapea default_markup_pct a número", () => {
    expect(mapCategory({ ...row, default_markup_pct: "35.50" }).defaultMarkupPct).toBe(35.5);
    expect(mapCategory({ ...row, default_markup_pct: 20 }).defaultMarkupPct).toBe(20);
  });

  it.each([null, undefined, "", "abc", 0, -5])("sin sugerencia válida (%p) no expone el campo", (value) => {
    expect(mapCategory({ ...row, default_markup_pct: value }).defaultMarkupPct).toBeUndefined();
  });

  it("el producto expone el % sugerido de su categoría", () => {
    const product = mapProduct({
      category: { ...row, default_markup_pct: "35.50" },
      category_id: "cat-1",
      current_cost_ref: 1,
      id: "prod-1",
      name: "Malta",
      sale_price_ref: 2,
      sku: "mal-001",
    });

    expect(product.category).toEqual(expect.objectContaining({ defaultMarkupPct: 35.5, id: "cat-1" }));
  });
});
