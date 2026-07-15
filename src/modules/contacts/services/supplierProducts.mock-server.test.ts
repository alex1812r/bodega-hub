/**
 * @jest-environment node
 */

import { createSupplierProduct, registerSupplierProductPrice } from "./supplierProducts.mock-server";

describe("supplierProducts.mock-server", () => {
  it("reactivates an inactive supplier-product link instead of returning 409", () => {
    const result = createSupplierProduct({
      lastCostRef: 5.1,
      notes: "Relinked pipe",
      productId: "prod-pipe",
      supplierId: "cont-both",
      supplierSku: "DOB-PVC-012-NEW",
    });

    expect(result.id).toBe("supp-prod-pipe");
    expect(result.isActive).toBe(true);
    expect(result.supplierSku).toBe("dob-pvc-012-new");
    expect(result.lastCostRef).toBe(5.1);
    expect(result.lastPriceOrigin).toBe("vinculacion");
  });

  it("stores pack price when registering by empaque and clears it for unit mode", () => {
    const packResult = registerSupplierProductPrice("supp-prod-drill", {
      newCostRef: 2.33,
      newPackCostRef: 28,
      origin: "cotizacion",
      priceInputMode: "pack",
    });

    expect(packResult.supplierProduct.lastCostRef).toBe(2.33);
    expect(packResult.supplierProduct.lastPackCostRef).toBe(28);

    const unitResult = registerSupplierProductPrice("supp-prod-drill", {
      newCostRef: 2.5,
      origin: "cotizacion",
      priceInputMode: "unit",
    });

    expect(unitResult.supplierProduct.lastCostRef).toBe(2.5);
    expect(unitResult.supplierProduct.lastPackCostRef).toBeUndefined();
  });

  it("returns 409 when linking an already active supplier-product pair", async () => {
    expect(() =>
      createSupplierProduct({
        productId: "prod-cable",
        supplierId: "cont-supplier",
        supplierSku: "SUP-CAB-DUP",
      }),
    ).toThrow(
      expect.objectContaining({
        code: "CONFLICT",
        status: 409,
      }),
    );
  });
});
