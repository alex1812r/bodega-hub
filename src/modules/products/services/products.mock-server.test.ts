/**
 * @jest-environment node
 */

import { mockProductPriceHistory, mockProducts, type ProductMock } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import {
  createProductPriceHistoryEntry,
  getProductById,
  getProductPriceHistory,
  listProducts,
  updateProductPrice,
} from "./products.mock-server";

const OTHER_STORE_ID = "00000000-0000-4000-8000-000000000002";

function list(queryString: string, storeId = DEFAULT_STORE_ID) {
  return listProducts(new URLSearchParams(queryString), storeId);
}

describe("products.mock-server listProducts: exact sku filter", () => {
  it("returns only the product with that exact sku", () => {
    const result = list("sku=her-tal-001");

    expect(result.items.map((product) => product.id)).toEqual(["prod-drill"]);
    expect(result.total).toBe(1);
  });

  it("normalizes case and surrounding spaces like product creation does", () => {
    expect(list("sku=%20%20HER-TAL-001%20").items.map((product) => product.id)).toEqual([
      "prod-drill",
    ]);
  });

  it("does not match partial skus", () => {
    expect(list("sku=her-tal").items).toEqual([]);
    expect(list("search=her-tal").total).toBeGreaterThan(0);
  });

  it("ignores an empty or blank sku parameter", () => {
    const total = list("limit=100").total;

    expect(list("sku=&limit=100").total).toBe(total);
    expect(list("sku=%20%20&limit=100").total).toBe(total);
  });

  it("takes precedence over the partial search", () => {
    expect(list("sku=her-tal-001&search=no-coincide").items.map((product) => product.id)).toEqual([
      "prod-drill",
    ]);
  });

  it("combines with the other filters", () => {
    expect(list("sku=her-tal-001&barcode=0000000000000").items).toEqual([]);
    expect(list("sku=her-tal-001&categoryId=cat-inexistente").items).toEqual([]);
    expect(list("sku=her-tal-001&barcode=7501234567890").items.map((product) => product.id)).toEqual(
      ["prod-drill"],
    );
  });

  it("never returns a product of another store", () => {
    expect(list("sku=sur-arr-001").items).toEqual([]);
    expect(list("sku=her-tal-001", OTHER_STORE_ID).items).toEqual([]);
    expect(list("sku=sur-arr-001", OTHER_STORE_ID).items.map((product) => product.id)).toEqual([
      "prod-sur-arroz",
    ]);
  });
});

describe("products.mock-server listProducts: packLink=none", () => {
  function ids(queryString: string, storeId = DEFAULT_STORE_ID) {
    return list(`${queryString}&limit=100`, storeId).items.map((product) => product.id);
  }

  it("leaves out the pack and the unit of every active link", () => {
    expect(ids("search=cig")).toEqual(
      expect.arrayContaining(["prod-cigar-pack", "prod-cigar-unit"]),
    );
    expect(ids("search=cig&packLink=none")).toEqual([]);
    expect(ids("packLink=none")).toEqual(expect.arrayContaining(["prod-drill", "prod-latex"]));
  });

  it("combines with the other filters", () => {
    const active = ids("packLink=none&isActive=true");

    expect(active).toContain("prod-drill");
    expect(active).not.toContain("prod-latex");
    expect(active).not.toContain("prod-cigar-unit");
    expect(ids("packLink=none&sku=cig-und-001")).toEqual([]);
    expect(ids("packLink=none&sku=her-tal-001")).toEqual(["prod-drill"]);
  });

  it("only removes the linked products from the listing", () => {
    expect(ids("packLink=none")).toEqual(
      ids("").filter((id) => id !== "prod-cigar-pack" && id !== "prod-cigar-unit"),
    );
  });

  it.each(["packLink=", "packLink=pack", "packLink=NONE"])(
    "keeps the default listing for [%s]",
    (queryString) => {
      expect(ids(queryString)).toEqual(ids(""));
    },
  );

  it("ignores the links of another store", () => {
    expect(ids("packLink=none", OTHER_STORE_ID)).toEqual(ids("", OTHER_STORE_ID));
  });
});

describe("products.mock-server listProducts: margin filter and sort (parity with products.server)", () => {
  const MARGIN_STORE_ID = "00000000-0000-4000-8000-0000000000aa";

  /** Costo 100: el precio es 100 + %. Costo 0 = sin costo. */
  function marginProduct(id: string, currentCostRef: number, salePriceRef: number): ProductMock {
    return {
      categoryId: "cat-tools",
      currentCostRef,
      currentStock: 1,
      id,
      isActive: true,
      minStock: 0,
      name: id,
      salePriceRef,
      sku: id,
      storeId: MARGIN_STORE_ID,
    };
  }

  const fixtures = [
    marginProduct("m-sin-costo", 0, 5),
    marginProduct("m-25", 100, 125),
    marginProduct("m-14.99", 100, 114.99),
    marginProduct("m-negativo", 100, 80),
    marginProduct("m-15", 100, 115),
    marginProduct("m-24.99", 100, 124.99),
    marginProduct("m-sin-costo-gratis", 0, 0),
  ];

  function marginIds(queryString: string) {
    return list(`${queryString}&limit=100`, MARGIN_STORE_ID).items.map((product) => product.id);
  }

  beforeAll(() => {
    mockProducts.push(...fixtures);
  });

  afterAll(() => {
    for (const fixture of fixtures) {
      mockProducts.splice(mockProducts.indexOf(fixture), 1);
    }
  });

  it("low = below 15 %, including a price under the cost", () => {
    expect(marginIds("margin=low&sortBy=marginPct")).toEqual(["m-negativo", "m-14.99"]);
  });

  it("mid = from 15 % up to, not including, 25 %", () => {
    expect(marginIds("margin=mid&sortBy=marginPct")).toEqual(["m-15", "m-24.99"]);
  });

  it("high = 25 % or more", () => {
    expect(marginIds("margin=high")).toEqual(["m-25"]);
  });

  it("none = products without cost, outside the three bands", () => {
    expect(marginIds("margin=none&sortBy=sku")).toEqual(["m-sin-costo", "m-sin-costo-gratis"]);
  });

  it("the four filters split the catalog without overlap", () => {
    const all = ["low", "mid", "high", "none"].flatMap((band) => marginIds(`margin=${band}`));

    expect([...all].sort()).toEqual(fixtures.map((fixture) => fixture.id).sort());
  });

  it.each(["margin=", "margin=all", "margin=verde"])("does not filter for [%s]", (queryString) => {
    expect(marginIds(queryString)).toHaveLength(fixtures.length);
  });

  it("sorts ascending by percentage with the products without cost last", () => {
    expect(marginIds("sortBy=marginPct&sortOrder=asc")).toEqual([
      "m-negativo",
      "m-14.99",
      "m-15",
      "m-24.99",
      "m-25",
      "m-sin-costo",
      "m-sin-costo-gratis",
    ]);
  });

  it("sorts descending by percentage with the products without cost still last", () => {
    expect(marginIds("sortBy=marginPct&sortOrder=desc")).toEqual([
      "m-25",
      "m-24.99",
      "m-15",
      "m-14.99",
      "m-negativo",
      "m-sin-costo",
      "m-sin-costo-gratis",
    ]);
  });

  it("combines with the other filters and never leaves the store", () => {
    expect(marginIds("margin=high&search=m-25&isActive=true")).toEqual(["m-25"]);
    expect(list("margin=high&search=m-25").items).toEqual([]);
  });
});

describe("products.mock-server updateProductPrice (parity with the update_product_price RPC)", () => {
  const original = getProductById("prod-drill", DEFAULT_STORE_ID).salePriceRef;

  afterEach(() => {
    updateProductPrice("prod-drill", { salePriceRef: original }, DEFAULT_STORE_ID);
  });

  it("persists the new sale price: later reads and listings return it", () => {
    const updated = updateProductPrice("prod-drill", { salePriceRef: 17.25 }, DEFAULT_STORE_ID);

    expect(updated.salePriceRef).toBe(17.25);
    expect(getProductById("prod-drill", DEFAULT_STORE_ID).salePriceRef).toBe(17.25);
    expect(list("sku=her-tal-001").items[0].salePriceRef).toBe(17.25);
  });

  it("changes nothing but the sale price", () => {
    const before = getProductById("prod-drill", DEFAULT_STORE_ID);

    updateProductPrice("prod-drill", { salePriceRef: 17.25 }, DEFAULT_STORE_ID);

    expect(getProductById("prod-drill", DEFAULT_STORE_ID)).toEqual({
      ...before,
      salePriceRef: 17.25,
    });
  });

  it("does not touch a product of another store", () => {
    expect(() => updateProductPrice("prod-drill", { salePriceRef: 1 }, OTHER_STORE_ID)).toThrow(
      /No tienes permisos/,
    );
    expect(getProductById("prod-drill", DEFAULT_STORE_ID).salePriceRef).toBe(original);
  });
});

describe("products.mock-server createProductPriceHistoryEntry (parity with the update_product_price RPC)", () => {
  const seeded = [...mockProductPriceHistory];

  afterEach(() => {
    mockProductPriceHistory.splice(0, mockProductPriceHistory.length, ...seeded);
  });

  function history(productId: string) {
    return getProductPriceHistory(productId, new URLSearchParams("limit=50"), DEFAULT_STORE_ID);
  }

  it("stores the entry: the history read afterwards includes the price change", () => {
    const before = history("prod-drill");

    const entry = createProductPriceHistoryEntry("prod-drill", { salePriceRef: 17.25 }, DEFAULT_STORE_ID);
    const after = history("prod-drill");

    expect(entry).toMatchObject({ productId: "prod-drill", salePriceRef: 17.25 });
    expect(after.total).toBe(before.total + 1);
    expect(after.items).toContainEqual(entry);
  });

  it("keeps one entry per change, each with its own id", () => {
    const first = createProductPriceHistoryEntry("prod-drill", { salePriceRef: 16 }, DEFAULT_STORE_ID);
    const second = createProductPriceHistoryEntry("prod-drill", { salePriceRef: 17 }, DEFAULT_STORE_ID);

    expect(second.id).not.toBe(first.id);
    expect(history("prod-drill").items.map((item) => item.salePriceRef)).toEqual(
      expect.arrayContaining([16, 17]),
    );
  });

  it("only adds to the history of that product", () => {
    const other = history("prod-hammer");

    createProductPriceHistoryEntry("prod-drill", { salePriceRef: 17.25 }, DEFAULT_STORE_ID);

    expect(history("prod-hammer")).toEqual(other);
  });

  it("stores nothing for a product of another store", () => {
    expect(() =>
      createProductPriceHistoryEntry("prod-drill", { salePriceRef: 1 }, OTHER_STORE_ID),
    ).toThrow(/No tienes permisos/);
    expect(mockProductPriceHistory).toEqual(seeded);
  });
});
