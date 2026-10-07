/**
 * @jest-environment node
 */

import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { listProducts } from "./products.mock-server";

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
