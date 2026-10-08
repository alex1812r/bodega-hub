import { DEFAULT_MARGIN_THRESHOLDS } from "@/shared/utils/pricing";

import {
  buildPriceReview,
  buildRepriceReason,
  comparePriceReviewItems,
  getPriceHistoryKind,
  getPriceSnapshotBand,
  isPriceReviewFilterOn,
  PRICE_BASELINE_REASON,
  summarizeReprice,
  toProductPriceHistoryEntry,
  type ProductPriceReviewItem,
} from "./priceReview";

const thresholds = DEFAULT_MARGIN_THRESHOLDS;

function review(currentCostRef: number, snapshot: { band: "high" | "low" | "mid" | "none"; costRef: number }) {
  return buildPriceReview({
    currentCostRef,
    salePriceRef: 10,
    snapshot: { at: "2026-10-01T10:00:00.000Z", ...snapshot },
    thresholds,
  });
}

describe("getPriceHistoryKind", () => {
  it("is a change when the price moved or the previous price was never recorded", () => {
    expect(getPriceHistoryKind(12, 14, null)).toBe("change");
    expect(getPriceHistoryKind(null, 14, null)).toBe("change");
    expect(getPriceHistoryKind(undefined, 14, PRICE_BASELINE_REASON)).toBe("change");
    // Un cambio real nunca es línea base, aunque alguien escriba ese motivo.
    expect(getPriceHistoryKind(12, 14, PRICE_BASELINE_REASON)).toBe("change");
  });

  it("is the baseline when the price did not move and the reason is the baseline one", () => {
    expect(getPriceHistoryKind(10, 10, PRICE_BASELINE_REASON)).toBe("baseline");
  });

  it("is a keep when the price did not move for any other reason", () => {
    expect(getPriceHistoryKind(10, 10, "Precio mantenido")).toBe("keep");
    expect(getPriceHistoryKind(10, 10, "Lo reviso el lunes")).toBe("keep");
    expect(getPriceHistoryKind(10, 10, null)).toBe("keep");
  });
});

describe("toProductPriceHistoryEntry", () => {
  const row = {
    changed_by: "user-1",
    created_at: "2026-05-20T10:00:00.000Z",
    id: "price-1",
    new_sale_price_ref: 14,
    old_sale_price_ref: 12,
    product_id: "prod-1",
    reason: "  Sube el proveedor ",
  };

  it("exposes the previous price stored in the row, the trimmed reason and the kind", () => {
    expect(toProductPriceHistoryEntry(row)).toEqual({
      createdAt: "2026-05-20T10:00:00.000Z",
      id: "price-1",
      kind: "change",
      previousSalePriceRef: 12,
      productId: "prod-1",
      reason: "Sube el proveedor",
      salePriceRef: 14,
      userId: "user-1",
    });
  });

  it("keeps a missing previous price as null instead of inventing one", () => {
    expect(toProductPriceHistoryEntry({ ...row, old_sale_price_ref: null, reason: null })).toMatchObject({
      kind: "change",
      previousSalePriceRef: null,
      reason: null,
    });
  });

  it("labels the baseline and the kept-price rows", () => {
    const same = { ...row, new_sale_price_ref: "10.00", old_sale_price_ref: "10.00" };

    expect(toProductPriceHistoryEntry({ ...same, reason: PRICE_BASELINE_REASON }).kind).toBe("baseline");
    expect(toProductPriceHistoryEntry({ ...same, reason: "Precio mantenido" }).kind).toBe("keep");
  });
});

describe("getPriceSnapshotBand", () => {
  it("uses the store thresholds with the same edges as the margin badge, and none without cost", () => {
    expect(getPriceSnapshotBand(8, 10, thresholds)).toBe("high");
    expect(getPriceSnapshotBand(8.5, 10, thresholds)).toBe("mid");
    expect(getPriceSnapshotBand(9, 10, thresholds)).toBe("low");
    expect(getPriceSnapshotBand(10, 11.5, thresholds)).toBe("mid");
    expect(getPriceSnapshotBand(10, 12.5, thresholds)).toBe("high");
    expect(getPriceSnapshotBand(0, 10, thresholds)).toBe("none");
  });
});

describe("buildPriceReview (same rule as the products_price_review view)", () => {
  it("enters when the cost rose and the band is worse than the stored one", () => {
    expect(review(9, { band: "high", costRef: 8 })).toEqual({
      currentBand: "low",
      currentCostRef: 9,
      currentMarginPct: 11.111111,
      previousBand: "high",
      previousCostRef: 8,
      previousMarginPct: 25,
      snapshotAt: "2026-10-01T10:00:00.000Z",
    });
    expect(review(8.5, { band: "high", costRef: 8 })).toMatchObject({ currentBand: "mid", previousBand: "high" });
    expect(review(9, { band: "mid", costRef: 8.5 })).toMatchObject({ currentBand: "low", previousBand: "mid" });
  });

  it("stays out when the band is the same or better than the stored one", () => {
    expect(review(9.5, { band: "low", costRef: 9 })).toBeNull();
    expect(review(8.2, { band: "mid", costRef: 8.1 })).toBeNull();
    expect(review(7.9, { band: "high", costRef: 8 })).toBeNull();
  });

  it("stays out when the cost did not rise, even if the band is worse (price lowered or thresholds raised)", () => {
    expect(review(9, { band: "high", costRef: 9 })).toBeNull();
    expect(review(9, { band: "high", costRef: 9.5 })).toBeNull();
  });

  it("stays out when either side has no cost", () => {
    expect(review(9, { band: "none", costRef: 0 })).toBeNull();
    expect(review(0, { band: "high", costRef: 8 })).toBeNull();
  });

  it("carries the purchase that raised the cost only when there is one", () => {
    const purchase = { id: "pur-1", number: "C-001", receivedAt: "2026-10-02T10:00:00.000Z" };
    const withPurchase = buildPriceReview({
      currentCostRef: 9,
      purchase,
      salePriceRef: 10,
      snapshot: { at: "2026-10-01T10:00:00.000Z", band: "high", costRef: 8 },
      thresholds,
    });

    expect(withPurchase?.purchase).toEqual(purchase);
    expect(review(9, { band: "high", costRef: 8 })).not.toHaveProperty("purchase");
  });

  it("recomputes the current band with the thresholds it receives", () => {
    const input = {
      currentCostRef: 9,
      salePriceRef: 10,
      snapshot: { at: "2026-10-01T10:00:00.000Z", band: "high" as const, costRef: 8 },
    };

    expect(buildPriceReview({ ...input, thresholds: { high: 10, low: 5 } })).toBeNull();
    expect(buildPriceReview({ ...input, thresholds: { high: 12, low: 5 } })).toMatchObject({ currentBand: "mid" });
  });
});

describe("comparePriceReviewItems", () => {
  function item(productId: string, currentBand: "low" | "mid", previousMarginPct: number, currentMarginPct: number) {
    return {
      currentBand,
      currentCostRef: 9,
      currentMarginPct,
      name: productId,
      previousBand: "high",
      previousCostRef: 8,
      previousMarginPct,
      productId,
      salePriceRef: 10,
      sku: productId,
      snapshotAt: "",
    } satisfies ProductPriceReviewItem;
  }

  it("puts the worst band first and, inside a band, the biggest drop", () => {
    const items = [
      item("mid-small", "mid", 25, 20),
      item("low-small", "low", 25, 14),
      item("mid-big", "mid", 60, 16),
      item("low-big", "low", 80, 5),
    ];

    expect(items.sort(comparePriceReviewItems).map((entry) => entry.productId)).toEqual([
      "low-big",
      "low-small",
      "mid-big",
      "mid-small",
    ]);
  });
});

describe("reprice helpers", () => {
  it("builds the default reason with a decimal comma", () => {
    expect(buildRepriceReason(25)).toBe("Reprecio al 25 %");
    expect(buildRepriceReason(12.5)).toBe("Reprecio al 12,5 %");
  });

  it("counts updated and failed products", () => {
    expect(
      summarizeReprice([
        { productId: "a", salePriceRef: 11.25, status: "ok" },
        { code: "NO_COST", message: "Sin costo", productId: "b", status: "error" },
      ]),
    ).toMatchObject({ failed: 1, updated: 1 });
  });
});

describe("isPriceReviewFilterOn", () => {
  it.each([
    ["review=1", true],
    ["review=true", true],
    ["review=TRUE", true],
    ["review=0", false],
    ["review=", false],
    ["", false],
  ])("%s → %s", (query, expected) => {
    expect(isPriceReviewFilterOn(new URLSearchParams(query))).toBe(expected);
  });
});
