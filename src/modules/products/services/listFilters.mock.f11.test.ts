/**
 * @jest-environment node
 *
 * PRO-F11 · paridad del mock con los servicios reales: filtros desmedidos → 400,
 * búsqueda de solo comodines → lista vacía, búsqueda de categorías recortada.
 */

import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { listCategories } from "./categories.mock-server";
import { listPriceReview } from "./priceReview.mock-server";
import { listProducts } from "./products.mock-server";

function list(query: Record<string, string>) {
  return listProducts(new URLSearchParams({ limit: "100", ...query }), DEFAULT_STORE_ID);
}

describe("products.mock-server listProducts (PRO-F11)", () => {
  it.each(["categoryId", "sku", "barcode"])("un %s de 10 000 caracteres responde 400", (name) => {
    expect(() => list({ [name]: "a".repeat(10_000) })).toThrow(
      expect.objectContaining({ code: "BAD_REQUEST", status: 400 }),
    );
  });

  it("un id de categoría del mock (cat-…) sigue filtrando", () => {
    const { items } = list({ categoryId: "cat-tools" });

    expect(items.length).toBeGreaterThan(0);
    expect(items.every((product) => product.categoryId === "cat-tools")).toBe(true);
  });

  it.each(['"', "%", "_", "*", "\\", "\u0000"])(
    "el término [%s] devuelve la lista vacía, no la tienda entera",
    (search) => {
      expect(list({ search })).toMatchObject({ items: [], total: 0 });
    },
  );

  it("sin término devuelve la tienda", () => {
    expect(list({ search: "  " }).total).toBeGreaterThan(0);
  });
});

describe("categories.mock-server listCategories (PRO-F11)", () => {
  it("un término de solo comodines devuelve la lista vacía", () => {
    expect(listCategories(new URLSearchParams({ search: "%" }), DEFAULT_STORE_ID).total).toBe(0);
  });

  it("un término con un NUL busca sin él", () => {
    const all = listCategories(new URLSearchParams({ limit: "100" }), DEFAULT_STORE_ID);
    const name = all.items[0]?.name ?? "";

    expect(
      listCategories(new URLSearchParams({ search: `\u0000${name}` }), DEFAULT_STORE_ID).total,
    ).toBeGreaterThan(0);
  });
});

describe("priceReview.mock-server listPriceReview (PRO-F11)", () => {
  it("un purchaseId de 10 000 caracteres responde 400", () => {
    expect(() =>
      listPriceReview(new URLSearchParams({ purchaseId: "a".repeat(10_000) }), DEFAULT_STORE_ID),
    ).toThrow(expect.objectContaining({ status: 400 }));
  });
});
