import { DEFAULT_MARGIN_THRESHOLDS } from "@/shared/utils/pricing";

import {
  applyProductMarginFilter,
  getProductMarginThresholds,
  getProductPricingOptions,
  marginBandRange,
  matchesProductMarginFilter,
  parseProductMarginFilter,
  productMarginPct,
  PRODUCT_MARGIN_FILTERS,
  type ProductMarginFilter,
} from "./productMargin";

const thresholds = { high: 25, low: 15 };
const storePricing = { chipsPct: [5, 18, 50], greenFromPct: 40, yellowFromPct: 10 };

/** Costo 100: el precio es directamente 100 + %. */
function priced(pct: number) {
  return { currentCostRef: 100, salePriceRef: 100 + pct };
}

function bandsOf(product: { currentCostRef: number; salePriceRef: number }) {
  return PRODUCT_MARGIN_FILTERS.filter((filter) =>
    matchesProductMarginFilter(product, filter, thresholds),
  );
}

type Call = [method: "gte" | "is" | "lt", column: string, value: number | null];

function recordingQuery(calls: Call[] = []) {
  const query = {
    calls,
    gte: (column: string, value: number) => recordingQuery([...calls, ["gte", column, value]]),
    is: (column: string, value: null) => recordingQuery([...calls, ["is", column, value]]),
    lt: (column: string, value: number) => recordingQuery([...calls, ["lt", column, value]]),
  };

  return query;
}

describe("productMargin", () => {
  describe("getProductMarginThresholds", () => {
    it.each([undefined, null])("uses the defaults of @bodega/core without store settings (%p)", (pricing) => {
      expect(getProductMarginThresholds(pricing)).toEqual(DEFAULT_MARGIN_THRESHOLDS);
      expect(getProductMarginThresholds(pricing)).toEqual({ high: 25, low: 15 });
    });

    it("uses the thresholds configured in the store", () => {
      expect(getProductMarginThresholds(storePricing)).toEqual({ high: 40, low: 10 });
    });

    it("a yellow threshold of 0 is a configured value, not a missing one", () => {
      expect(getProductMarginThresholds({ ...storePricing, yellowFromPct: 0 })).toEqual({ high: 40, low: 0 });
    });

    it("moves the bands of the listing filter with the store thresholds", () => {
      const configured = getProductMarginThresholds(storePricing);

      expect(marginBandRange("low", configured)).toEqual({ lt: 10 });
      expect(marginBandRange("mid", configured)).toEqual({ gte: 10, lt: 40 });
      expect(marginBandRange("high", configured)).toEqual({ gte: 40 });
      expect(matchesProductMarginFilter(priced(30), "high", configured)).toBe(false);
      expect(matchesProductMarginFilter(priced(30), "mid", configured)).toBe(true);
      expect(matchesProductMarginFilter(priced(12), "low", configured)).toBe(false);
    });
  });

  describe("productMarginPct", () => {
    it("is the markup over the cost, without applying any tax again", () => {
      // Costo 1,16 (1,00 + 16 % de IVA ya incluido) y precio 1,45: 25 % sobre 1,16.
      expect(productMarginPct({ currentCostRef: 1.16, salePriceRef: 1.45 })).toBe(25);
    });

    it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
      "has no percentage with cost %p (never a division by zero)",
      (currentCostRef) => {
        expect(productMarginPct({ currentCostRef, salePriceRef: 5 })).toBeNull();
      },
    );

    it("is negative when the price is below the cost", () => {
      expect(productMarginPct({ currentCostRef: 10, salePriceRef: 8 })).toBe(-20);
    });
  });

  describe("bands at the edges", () => {
    it.each<[number, ProductMarginFilter]>([
      [-20, "low"],
      [0, "low"],
      [14.99, "low"],
      [15, "mid"],
      [24.99, "mid"],
      [25, "high"],
      [300, "high"],
    ])("%p %% falls only in the %s band", (pct, band) => {
      expect(bandsOf(priced(pct))).toEqual([band]);
    });

    it("keeps a product without cost out of the three bands, under 'none'", () => {
      expect(bandsOf({ currentCostRef: 0, salePriceRef: 5 })).toEqual(["none"]);
    });

    it("does not filter without a band", () => {
      expect(matchesProductMarginFilter(priced(5), null, thresholds)).toBe(true);
      expect(matchesProductMarginFilter({ currentCostRef: 0, salePriceRef: 5 }, null, thresholds)).toBe(
        true,
      );
    });
  });

  describe("marginBandRange", () => {
    it("derives the three ranges from the thresholds", () => {
      expect(marginBandRange("low", thresholds)).toEqual({ lt: 15 });
      expect(marginBandRange("mid", thresholds)).toEqual({ gte: 15, lt: 25 });
      expect(marginBandRange("high", thresholds)).toEqual({ gte: 25 });
    });

    it("follows other thresholds (PRO-09)", () => {
      expect(marginBandRange("mid", { high: 40, low: 10 })).toEqual({ gte: 10, lt: 40 });
    });
  });

  describe("applyProductMarginFilter", () => {
    it.each<[ProductMarginFilter, Call[]]>([
      ["low", [["lt", "margin_pct", 15]]],
      [
        "mid",
        [
          ["gte", "margin_pct", 15],
          ["lt", "margin_pct", 25],
        ],
      ],
      ["high", [["gte", "margin_pct", 25]]],
      ["none", [["is", "margin_pct", null]]],
    ])("sends the %s band as a range of margin_pct", (filter, expected) => {
      expect(applyProductMarginFilter(recordingQuery(), filter, thresholds).calls).toEqual(expected);
    });

    it("leaves the query untouched without a filter", () => {
      expect(applyProductMarginFilter(recordingQuery(), null, thresholds).calls).toEqual([]);
    });
  });

  describe("parseProductMarginFilter", () => {
    it.each(PRODUCT_MARGIN_FILTERS)("accepts margin=%s", (filter) => {
      expect(parseProductMarginFilter(new URLSearchParams(`margin=${filter}`))).toBe(filter);
    });

    it.each(["", "margin=", "margin=all", "margin=LOW", "margin=15", "margin=low%20"])(
      "ignores an unknown value [%s]",
      (queryString) => {
        expect(parseProductMarginFilter(new URLSearchParams(queryString))).toBeNull();
      },
    );
  });

  describe("getProductPricingOptions", () => {
    it("offers the default chips (12 / 20 / 30) and the same thresholds as the listing", () => {
      expect(getProductPricingOptions()).toEqual({
        chips: [12, 20, 30],
        thresholds: getProductMarginThresholds(),
      });
      expect(getProductPricingOptions(null, null)).toEqual(getProductPricingOptions());
    });

    it("offers the chips and thresholds configured in the store", () => {
      expect(getProductPricingOptions(storePricing)).toEqual({
        chips: [5, 18, 50],
        thresholds: { high: 40, low: 10 },
      });
    });

    it("puts the suggested % of the category first, before the store chips", () => {
      expect(getProductPricingOptions(storePricing, 35).chips).toEqual([35, 5, 18, 50]);
      expect(getProductPricingOptions(undefined, 35).chips).toEqual([35, 12, 20, 30]);
    });

    it("does not repeat the category % when the store already offers it", () => {
      expect(getProductPricingOptions(storePricing, 18).chips).toEqual([18, 5, 50]);
    });

    it.each([null, undefined, 0, -5, Number.NaN])(
      "ignores a category without a usable suggestion (%p)",
      (categoryMarkupPct) => {
        expect(getProductPricingOptions(storePricing, categoryMarkupPct).chips).toEqual([5, 18, 50]);
      },
    );

    it("never mutates the store settings", () => {
      getProductPricingOptions(storePricing, 35);

      expect(storePricing.chipsPct).toEqual([5, 18, 50]);
    });
  });
});
