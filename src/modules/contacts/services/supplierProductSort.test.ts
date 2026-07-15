/**
 * @jest-environment node
 */

import {
  parseSupplierProductSort,
  sortSupplierProductItems,
  SUPPLIER_PRODUCT_SORT_CONFIG,
} from "./supplierProductSort";

import type { SupplierProduct } from "../types/supplierProducts";

const baseItem = (overrides: Partial<SupplierProduct> = {}): SupplierProduct => ({
  id: "sp-1",
  isActive: true,
  lastCostRef: 5,
  product: { id: "p-1", name: "Zeta", sku: "Z-001" } as SupplierProduct["product"],
  productId: "p-1",
  supplierId: "s-1",
  updatedAt: "2026-07-01T10:00:00.000Z",
  ...overrides,
});

describe("supplierProductSort", () => {
  describe("parseSupplierProductSort", () => {
    it("returns updatedAt desc by default", () => {
      expect(parseSupplierProductSort(new URLSearchParams())).toEqual({
        sortBy: "updatedAt",
        sortOrder: "desc",
      });
    });

    it("parses valid sort params", () => {
      const params = new URLSearchParams("sortBy=lastCostRef&sortOrder=asc");

      expect(parseSupplierProductSort(params)).toEqual({
        sortBy: "lastCostRef",
        sortOrder: "asc",
      });
    });

    it("falls back for invalid sortBy", () => {
      const params = new URLSearchParams("sortBy=invalid&sortOrder=asc");

      expect(parseSupplierProductSort(params)).toEqual({
        sortBy: "updatedAt",
        sortOrder: "asc",
      });
    });
  });

  describe("sortSupplierProductItems", () => {
    it("sorts by product name", () => {
      const items = [
        baseItem({ id: "1", product: { id: "p1", name: "Zeta", sku: "Z" } as SupplierProduct["product"] }),
        baseItem({ id: "2", product: { id: "p2", name: "Alpha", sku: "A" } as SupplierProduct["product"] }),
      ];

      expect(sortSupplierProductItems(items, "product", "asc").map((item) => item.id)).toEqual([
        "2",
        "1",
      ]);
    });

    it("sorts by lastCostRef", () => {
      const items = [
        baseItem({ id: "1", lastCostRef: 10 }),
        baseItem({ id: "2", lastCostRef: 2 }),
      ];

      expect(sortSupplierProductItems(items, "lastCostRef", "asc").map((item) => item.id)).toEqual([
        "2",
        "1",
      ]);
    });

    it("sorts by packCostRef using stored pack price when available", () => {
      const items = [
        baseItem({
          id: "1",
          lastCostRef: 2.33,
          lastPackCostRef: 28,
          packUnits: [{ id: "pu-1", isActive: true, isDefault: true, label: "Bulto", supplierProductId: "1", unitsPerPack: 12 }],
        }),
        baseItem({
          id: "2",
          lastCostRef: 3,
          packUnits: [{ id: "pu-2", isActive: true, isDefault: true, label: "Bulto", supplierProductId: "2", unitsPerPack: 12 }],
        }),
      ];

      expect(sortSupplierProductItems(items, "packCostRef", "asc").map((item) => item.id)).toEqual([
        "1",
        "2",
      ]);
    });
  });

  it("exports whitelist aligned with config", () => {
    expect(SUPPLIER_PRODUCT_SORT_CONFIG.defaultSortBy).toBe("updatedAt");
    expect(SUPPLIER_PRODUCT_SORT_CONFIG.whitelist).toContain("supplierSku");
  });
});
