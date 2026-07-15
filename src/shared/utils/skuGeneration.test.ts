/**
 * @jest-environment node
 */

import {
  generateProductSkuFromName,
  generateSupplierSkuFromProduct,
  normalizeOptionalSku,
  normalizeSku,
  shortenSupplierName,
} from "./skuGeneration";

describe("skuGeneration", () => {
  describe("normalizeSku", () => {
    it("trims and lowercases sku values", () => {
      expect(normalizeSku(" HER-TAL-001 ")).toBe("her-tal-001");
    });
  });

  describe("normalizeOptionalSku", () => {
    it("returns null for empty values and preserves undefined", () => {
      expect(normalizeOptionalSku(undefined)).toBeUndefined();
      expect(normalizeOptionalSku("")).toBeNull();
      expect(normalizeOptionalSku(" SUP-01 ")).toBe("sup-01");
    });
  });

  describe("generateProductSkuFromName", () => {
    it("builds abbreviated tokens from product name", () => {
      expect(generateProductSkuFromName("Taladro percutor")).toBe("tala-perc");
      expect(generateProductSkuFromName("Harina PAN 1Kg")).toBe("hari-pan-1kg");
    });

    it("removes accents and special characters", () => {
      expect(generateProductSkuFromName("Aceite Capri de Oliva 500ml")).toBe(
        "acei-capr-oliv-500m",
      );
    });

    it("returns fallback when name is empty", () => {
      expect(generateProductSkuFromName("   ")).toBe("producto");
    });
  });

  describe("shortenSupplierName", () => {
    it("uses initials for long multi-word names", () => {
      expect(shortenSupplierName("Comercial Doble Via")).toBe("cdv");
      expect(shortenSupplierName("Suministros Industriales C.A.")).toBe("sumind");
    });

    it("abbreviates single significant word", () => {
      expect(shortenSupplierName("Ferrera")).toBe("ferrera");
    });

    it("strips legal suffixes", () => {
      expect(shortenSupplierName("Distribuidora Norte S.A.")).toBe("disnor");
    });
  });

  describe("generateSupplierSkuFromProduct", () => {
    it("combines product sku with supplier short code", () => {
      expect(generateSupplierSkuFromProduct("HER-TAL-001", "Comercial Doble Via")).toBe(
        "her-tal-001-cdv",
      );
    });

    it("returns supplier short when product sku is empty", () => {
      expect(generateSupplierSkuFromProduct("", "Ferrera Ferrera Mayorista")).toBe("ffm");
    });
  });
});
