import {
  computeVariationPercent,
  mapProductSupplierLink,
  mapSaveProductSuppliersResult,
  mapSupplierProduct,
} from "@/lib/supabase/mappers/supplierProducts";

describe("supplierProducts mapper", () => {
  it("computes variation percent when previous cost is positive", () => {
    expect(computeVariationPercent(8, 8.5)).toBe(6.25);
  });

  it("returns null when previous cost is zero or missing", () => {
    expect(computeVariationPercent(undefined, 8.5)).toBeNull();
    expect(computeVariationPercent(0, 8.5)).toBeNull();
  });

  it("maps is_preferred and defaults to false when the column is not there yet", () => {
    const row = { id: "sp-1", product_id: "p-1", supplier_id: "s-1" };

    expect(mapSupplierProduct({ ...row, is_preferred: true }).isPreferred).toBe(true);
    expect(mapSupplierProduct({ ...row, is_preferred: null }).isPreferred).toBe(false);
    expect(mapSupplierProduct(row).isPreferred).toBe(false);
  });

  it("maps a save_product_suppliers link row: numeric cost, normalized sku and no empty optionals", () => {
    expect(
      mapProductSupplierLink({
        cost_ref: "4.20",
        id: "sp-1",
        is_preferred: true,
        last_purchased_at: "2026-10-01T12:00:00+00:00",
        supplier_id: "s-1",
        supplier_is_active: false,
        supplier_name: "Alfa",
        supplier_sku: " ALF-01 ",
        updated_at: "2026-10-08T12:00:00+00:00",
      }),
    ).toEqual({
      costRef: 4.2,
      id: "sp-1",
      isPreferred: true,
      lastPurchasedAt: "2026-10-01T12:00:00+00:00",
      supplierId: "s-1",
      supplierIsActive: false,
      supplierName: "Alfa",
      supplierSku: "alf-01",
      updatedAt: "2026-10-08T12:00:00+00:00",
    });
    expect(mapProductSupplierLink({ id: "sp-2", supplier_id: "s-2" })).toEqual({
      costRef: 0,
      id: "sp-2",
      isPreferred: false,
      supplierId: "s-2",
      supplierIsActive: true,
      supplierName: "",
    });
  });

  it("maps the save_product_suppliers result and treats missing fields as no preferred / no change", () => {
    expect(
      mapSaveProductSuppliersResult({
        preferred_auto_assigned: true,
        preferred_changed: true,
        preferred_supplier_id: "s-2",
        previous_preferred_supplier_id: "s-1",
        suppliers: [{ id: "sp-2", is_preferred: true, supplier_id: "s-2", supplier_name: "Beta" }],
      }),
    ).toEqual({
      preferredAutoAssigned: true,
      preferredChanged: true,
      preferredSupplierId: "s-2",
      previousPreferredSupplierId: "s-1",
      suppliers: [
        {
          costRef: 0,
          id: "sp-2",
          isPreferred: true,
          supplierId: "s-2",
          supplierIsActive: true,
          supplierName: "Beta",
        },
      ],
    });
    expect(mapSaveProductSuppliersResult({})).toEqual({
      preferredAutoAssigned: false,
      preferredChanged: false,
      preferredSupplierId: null,
      previousPreferredSupplierId: null,
      suppliers: [],
    });
  });
});
