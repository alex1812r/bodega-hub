import {
  mapProduct,
  mapProductPriceHistory,
  mapProductPriceReview,
  mapProductPriceReviewItem,
  type ProductPriceReviewRow,
} from "./products";

const reviewRow: ProductPriceReviewRow = {
  current_band: "yellow",
  current_cost_ref: "8.50",
  current_margin_pct: "17.647059",
  name: "Harina PAN",
  previous_band: "green",
  previous_cost_ref: "8.00",
  previous_margin_pct: "25.000000",
  product_id: "prod-1",
  purchase_id: "pur-1",
  purchase_number: "C-0001",
  purchase_received_at: "2026-10-02T10:00:00.000Z",
  sale_price_ref: "10.00",
  sku: " HAR-001 ",
  snapshot_at: "2026-10-01T10:00:00.000Z",
  supplier_name: "Distribuidora Lara",
};

describe("mapProductPriceReview", () => {
  it("maps the SQL bands to the margin bands of the UI and the numerics to numbers", () => {
    expect(mapProductPriceReview(reviewRow)).toEqual({
      currentBand: "mid",
      currentCostRef: 8.5,
      currentMarginPct: 17.647059,
      previousBand: "high",
      previousCostRef: 8,
      previousMarginPct: 25,
      purchase: {
        id: "pur-1",
        number: "C-0001",
        receivedAt: "2026-10-02T10:00:00.000Z",
        supplierName: "Distribuidora Lara",
      },
      snapshotAt: "2026-10-01T10:00:00.000Z",
    });
    expect(mapProductPriceReview({ ...reviewRow, current_band: "red" })?.currentBand).toBe("low");
  });

  it("omits the purchase without one and the supplier name without one", () => {
    const withoutPurchase = mapProductPriceReview({ ...reviewRow, purchase_id: null });
    const withoutSupplier = mapProductPriceReview({ ...reviewRow, supplier_name: null });

    expect(withoutPurchase).not.toHaveProperty("purchase");
    expect(withoutSupplier?.purchase).toEqual({
      id: "pur-1",
      number: "C-0001",
      receivedAt: "2026-10-02T10:00:00.000Z",
    });
  });

  it.each(["none", null, "purple"])("returns null when a band is %p: nothing to compare", (band) => {
    expect(mapProductPriceReview({ ...reviewRow, current_band: band })).toBeNull();
    expect(mapProductPriceReview({ ...reviewRow, previous_band: band })).toBeNull();
  });
});

describe("mapProductPriceReviewItem", () => {
  it("adds the product columns of the queue row", () => {
    expect(mapProductPriceReviewItem(reviewRow)).toMatchObject({
      currentBand: "mid",
      name: "Harina PAN",
      productId: "prod-1",
      salePriceRef: 10,
      sku: "har-001",
    });
    expect(mapProductPriceReviewItem({ ...reviewRow, previous_band: "none" })).toBeNull();
  });
});

describe("mapProduct · price_review relation", () => {
  const productRow = { id: "prod-1", name: "Harina PAN", sale_price_ref: 10, sku: "har-001" };

  it("exposes priceReview from the embedded row, as object or as a one-row list", () => {
    expect(mapProduct({ ...productRow, price_review: reviewRow }).priceReview).toMatchObject({ currentBand: "mid" });
    expect(mapProduct({ ...productRow, price_review: [reviewRow] }).priceReview).toMatchObject({
      previousBand: "high",
    });
  });

  it.each([[undefined], [null], [[]]])("has no priceReview when the relation is %p", (embed) => {
    expect(mapProduct({ ...productRow, price_review: embed })).not.toHaveProperty("priceReview");
  });
});

describe("mapProductPriceHistory", () => {
  const row = {
    changed_by: "user-1",
    created_at: "2026-05-20T10:00:00.000Z",
    id: "price-1",
    new_sale_price_ref: "14.00",
    old_sale_price_ref: "12.00",
    product_id: "prod-1",
  };

  it("returns the previous price stored in the row next to the new one", () => {
    expect(mapProductPriceHistory(row)).toEqual({
      createdAt: "2026-05-20T10:00:00.000Z",
      id: "price-1",
      previousSalePriceRef: 12,
      productId: "prod-1",
      salePriceRef: 14,
      userId: "user-1",
    });
  });

  it("keeps a previous price of 0 and maps a missing one to null", () => {
    expect(mapProductPriceHistory({ ...row, old_sale_price_ref: 0 }).previousSalePriceRef).toBe(0);
    expect(mapProductPriceHistory({ ...row, old_sale_price_ref: null }).previousSalePriceRef).toBeNull();
    expect(mapProductPriceHistory({ ...row, old_sale_price_ref: undefined }).previousSalePriceRef).toBeNull();
  });
});
