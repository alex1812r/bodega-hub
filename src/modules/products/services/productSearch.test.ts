/**
 * @jest-environment node
 */

import {
  buildProductSearchOrFilter,
  escapeIlike,
  findProductByExactBarcode,
  matchesExactBarcode,
  matchesProductSearch,
  normalizeBarcode,
} from "./productSearch";

const sampleProduct = {
  barcode: "7501234567890",
  name: "Harina PAN",
  sku: "HAR-PAN-001",
};

describe("productSearch", () => {
  describe("normalizeBarcode", () => {
    it("returns null for empty or whitespace values", () => {
      expect(normalizeBarcode("")).toBeNull();
      expect(normalizeBarcode("   ")).toBeNull();
      expect(normalizeBarcode(null)).toBeNull();
      expect(normalizeBarcode(undefined)).toBeNull();
    });

    it("trims non-empty barcodes", () => {
      expect(normalizeBarcode(" 7501234567890 ")).toBe("7501234567890");
    });
  });

  describe("escapeIlike", () => {
    it("removes ilike wildcard characters", () => {
      expect(escapeIlike("100%_off")).toBe("100off");
    });
  });

  describe("matchesProductSearch", () => {
    it("matches empty search", () => {
      expect(matchesProductSearch(sampleProduct, "")).toBe(true);
      expect(matchesProductSearch(sampleProduct, "   ")).toBe(true);
    });

    it("matches by name, sku, or barcode", () => {
      expect(matchesProductSearch(sampleProduct, "harina")).toBe(true);
      expect(matchesProductSearch(sampleProduct, "HAR-PAN")).toBe(true);
      expect(matchesProductSearch(sampleProduct, "7501234")).toBe(true);
    });

    it("ignores null barcode", () => {
      expect(
        matchesProductSearch({ ...sampleProduct, barcode: null }, "7501234"),
      ).toBe(false);
    });

    it("returns false when nothing matches", () => {
      expect(matchesProductSearch(sampleProduct, "xyz-not-found")).toBe(false);
    });
  });

  describe("matchesExactBarcode", () => {
    it("matches trimmed barcode values", () => {
      expect(matchesExactBarcode(sampleProduct, "7501234567890")).toBe(true);
      expect(matchesExactBarcode(sampleProduct, " 7501234567890 ")).toBe(true);
      expect(matchesExactBarcode(sampleProduct, "000")).toBe(false);
    });
  });

  describe("findProductByExactBarcode", () => {
    it("returns the matching product", () => {
      expect(findProductByExactBarcode([sampleProduct], "7501234567890")?.sku).toBe(
        "HAR-PAN-001",
      );
    });
  });

  describe("buildProductSearchOrFilter", () => {
    it("builds supabase or filter for name, sku, and barcode", () => {
      expect(buildProductSearchOrFilter("harina")).toBe(
        "name.ilike.%harina%,sku.ilike.%harina%,barcode.ilike.%harina%",
      );
    });

    it("escapes special characters in search term", () => {
      expect(buildProductSearchOrFilter("100%")).toBe(
        "name.ilike.%100%,sku.ilike.%100%,barcode.ilike.%100%",
      );
    });
  });
});
