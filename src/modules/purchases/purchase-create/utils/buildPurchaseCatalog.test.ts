import type { SupplierProduct } from "@/modules/contacts/types/supplierProducts";

import { buildPurchaseCatalog } from "./buildPurchaseCatalog";

describe("buildPurchaseCatalog", () => {
  it("returns empty catalog when no supplier is selected", () => {
    expect(
      buildPurchaseCatalog("", [
        {
          id: "supp-prod-cable",
          isActive: true,
          lastCostRef: 2,
          product: { id: "prod-cable", name: "Cable", sku: "CAB-12" },
          productId: "prod-cable",
          supplierId: "cont-supplier",
        } as SupplierProduct,
      ]),
    ).toEqual([]);
  });

  it("maps supplier-linked products without falling back to global catalog", () => {
    expect(
      buildPurchaseCatalog("cont-supplier", [
        {
          id: "supp-prod-cable",
          isActive: true,
          lastCostRef: 2,
          product: { id: "prod-cable", name: "Cable 12 AWG", sku: "CAB-12" },
          productId: "prod-cable",
          supplierId: "cont-supplier",
          supplierSku: "sup-cab-12",
        } as SupplierProduct,
      ]),
    ).toEqual([
      {
        barcode: null,
        defaultPackUnit: undefined,
        productId: "prod-cable",
        name: "Cable 12 AWG",
        packUnits: [],
        sku: "sup-cab-12",
        unitCostRef: 2,
      },
    ]);
  });

  it("returns empty catalog when supplier has no linked products", () => {
    expect(buildPurchaseCatalog("cont-supplier", [])).toEqual([]);
  });

  it("skips rows without embedded product data", () => {
    expect(
      buildPurchaseCatalog("cont-supplier", [
        {
          id: "supp-prod-missing",
          isActive: true,
          lastCostRef: 1,
          productId: "prod-missing",
          supplierId: "cont-supplier",
        } as SupplierProduct,
      ]),
    ).toEqual([]);
  });
});
