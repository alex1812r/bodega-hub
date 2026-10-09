import type { SupplierProduct } from "@/modules/contacts/types/supplierProducts";
import type { ProductWithCategory } from "@/modules/products/hooks/useProducts";

import {
  buildPurchaseCatalog,
  buildUnlinkedCatalogProduct,
  mergePurchaseCatalog,
  netCostRef,
  PURCHASE_CATALOG_LIMIT,
} from "./buildPurchaseCatalog";

function link(
  productId: string,
  input: Omit<Partial<SupplierProduct>, "product"> & {
    product?: Partial<NonNullable<SupplierProduct["product"]>>;
  } = {},
): SupplierProduct {
  return {
    id: `supp-${productId}`,
    isActive: true,
    lastCostRef: 2,
    productId,
    supplierId: "cont-supplier",
    ...input,
    product: { id: productId, name: productId, sku: productId.toUpperCase(), ...input.product },
  } as SupplierProduct;
}

function product(id: string, input: Partial<ProductWithCategory> = {}): ProductWithCategory {
  return {
    categoryId: "cat-1",
    currentCostRef: 0,
    currentStock: 0,
    id,
    isActive: true,
    minStock: 0,
    name: id,
    salePriceRef: 0,
    sku: id.toUpperCase(),
    ...input,
  } as ProductWithCategory;
}

describe("buildPurchaseCatalog", () => {
  it("returns empty catalog when no supplier is selected", () => {
    expect(buildPurchaseCatalog("", [link("prod-cable")])).toEqual([]);
  });

  it("maps supplier-linked products with the supplier sku and its last cost", () => {
    expect(
      buildPurchaseCatalog("cont-supplier", [
        link("prod-cable", {
          product: { currentStock: 4, name: "Cable 12 AWG", sku: "CAB-12" },
          supplierSku: "sup-cab-12",
        }),
      ]),
    ).toEqual([
      {
        barcode: null,
        costWithTaxRef: 2,
        currentStock: 4,
        defaultPackUnit: undefined,
        link: "linked",
        name: "Cable 12 AWG",
        packUnits: [],
        productId: "prod-cable",
        sku: "sup-cab-12",
        taxRate: 0,
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

  it("no ofrece un producto inactivo aunque siga vinculado al proveedor", () => {
    expect(
      buildPurchaseCatalog("cont-supplier", [
        link("prod-viejo", { product: { isActive: false } }),
        link("prod-activo"),
      ]).map((item) => item.productId),
    ).toEqual(["prod-activo"]);
  });

  it("marca el vínculo habitual y lo pone primero", () => {
    const catalog = buildPurchaseCatalog("cont-supplier", [
      link("prod-a"),
      link("prod-b", { isPreferred: true }),
      link("prod-c"),
    ]);

    expect(catalog.map((item) => [item.productId, item.link])).toEqual([
      ["prod-b", "preferred"],
      ["prod-a", "linked"],
      ["prod-c", "linked"],
    ]);
  });

  it("el último costo del proveedor ya trae IVA: la línea sugiere el costo sin IVA", () => {
    const [item] = buildPurchaseCatalog("cont-supplier", [
      link("prod-iva", { lastCostRef: 1.16, product: { taxRate: 16 } }),
    ]);

    expect(item).toMatchObject({ costWithTaxRef: 1.16, taxRate: 16, unitCostRef: 1 });
  });
});

describe("netCostRef", () => {
  it("quita el IVA de un costo que ya lo incluye y no toca los exentos", () => {
    expect(netCostRef(1.16, 16)).toBe(1);
    expect(netCostRef(2.5, 0)).toBe(2.5);
    expect(netCostRef(10.8, 8)).toBe(10);
    expect(netCostRef(-3, 16)).toBe(0);
  });
});

describe("buildUnlinkedCatalogProduct", () => {
  it("entra por unidad, sin empaques, con el IVA de la categoría y el costo actual sin IVA", () => {
    expect(
      buildUnlinkedCatalogProduct(
        product("prod-suelto", {
          barcode: "7591234",
          category: { id: "cat-1", isActive: true, name: "Víveres", taxRate: 16 },
          currentCostRef: 1.16,
          currentStock: 7,
          name: "Harina suelta",
          sku: "HAR-01",
        }),
      ),
    ).toEqual({
      barcode: "7591234",
      costWithTaxRef: 1.16,
      currentStock: 7,
      link: "none",
      name: "Harina suelta",
      packUnits: [],
      productId: "prod-suelto",
      sku: "HAR-01",
      taxRate: 16,
      unitCostRef: 1,
    });
  });

  it("sugiere el mismo costo que un vinculado con el mismo costo con IVA", () => {
    const [linked] = buildPurchaseCatalog("cont-supplier", [
      link("prod-x", { lastCostRef: 3.48, product: { taxRate: 16 } }),
    ]);
    const unlinked = buildUnlinkedCatalogProduct(
      product("prod-x", {
        category: { id: "cat-1", isActive: true, name: "Víveres", taxRate: 16 },
        currentCostRef: 3.48,
      }),
    );

    expect(unlinked.unitCostRef).toBe(linked?.unitCostRef);
    expect(unlinked.taxRate).toBe(linked?.taxRate);
  });
});

describe("mergePurchaseCatalog", () => {
  it("sin proveedor no ofrece nada", () => {
    expect(mergePurchaseCatalog("", [], [product("prod-a")])).toEqual([]);
  });

  it("vinculados primero (habitual arriba), después el resto de la tienda, sin repetir", () => {
    const catalog = mergePurchaseCatalog(
      "cont-supplier",
      [link("prod-b"), link("prod-c", { isPreferred: true })],
      [product("prod-a"), product("prod-b"), product("prod-c"), product("prod-d")],
    );

    expect(catalog.map((item) => [item.productId, item.link])).toEqual([
      ["prod-c", "preferred"],
      ["prod-b", "linked"],
      ["prod-a", "none"],
      ["prod-d", "none"],
    ]);
  });

  it("nunca ofrece inactivos: ni el vinculado ni el de la tienda", () => {
    const catalog = mergePurchaseCatalog(
      "cont-supplier",
      [link("prod-viejo", { product: { isActive: false } })],
      [product("prod-viejo", { isActive: false }), product("prod-baja", { isActive: false }), product("prod-ok")],
    );

    expect(catalog.map((item) => item.productId)).toEqual(["prod-ok"]);
  });

  it("corta en 20 resultados dejando los vinculados dentro", () => {
    const products = Array.from({ length: 30 }, (_, index) => product(`prod-${index}`));
    const catalog = mergePurchaseCatalog("cont-supplier", [link("prod-29")], products);

    expect(catalog).toHaveLength(PURCHASE_CATALOG_LIMIT);
    expect(catalog[0]).toMatchObject({ link: "linked", productId: "prod-29" });
  });
});
