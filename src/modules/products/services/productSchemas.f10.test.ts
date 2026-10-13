/**
 * PRO-F10 · M6: los textos que llegan a Postgres pierden NUL y los demás
 * caracteres de control en los schemas del módulo (antes: 500).
 */

import { createCategorySchema, updateCategorySchema } from "./categorySchemas";
import { packConversionInputSchema } from "./packConversionSchemas";
import {
  addProductBarcodeSchema,
  createProductSchema,
  keepProductPriceSchema,
  productPriceSchema,
  repriceProductsSchema,
  updateProductSchema,
} from "./productSchemas";
import { saveProductSuppliersSchema } from "./productSuppliers";

const NUL = "\u0000";

describe("product schemas · control characters (PRO-F10 · M6)", () => {
  it("createProductSchema cleans name, SKU, barcode and category", () => {
    const parsed = createProductSchema.parse({
      barcode: `7591${NUL}000`,
      categoryId: `cat-${NUL}tools`,
      name: `Hari${NUL}na Piñón 🍕`,
      salePriceRef: 2,
      sku: `HAR-${NUL}01`,
    });

    expect(parsed).toMatchObject({
      barcode: "7591000",
      categoryId: "cat-tools",
      name: "Harina Piñón 🍕",
      sku: "har-01",
    });
  });

  it("updateProductSchema cleans name, SKU, barcode and category", () => {
    const parsed = updateProductSchema.parse({
      barcode: `7591${NUL}000`,
      categoryId: `cat-${NUL}tools`,
      name: `Hari${NUL}na`,
      sku: `HAR-${NUL}01`,
    });

    expect(parsed).toMatchObject({
      barcode: "7591000",
      categoryId: "cat-tools",
      name: "Harina",
      sku: "har-01",
    });
  });

  it.each([NUL, `${NUL}${NUL}`, "   ", ` ${NUL} `])(
    "a name that is empty once cleaned is rejected [%j]",
    (name) => {
      expect(createProductSchema.safeParse({ name, salePriceRef: 2 }).success).toBe(false);
      expect(updateProductSchema.safeParse({ name }).success).toBe(false);
    },
  );

  it("keeps the name as written apart from control characters and outer spaces", () => {
    expect(createProductSchema.parse({ name: "  Café  con leche ", salePriceRef: 2 }).name).toBe(
      "Café  con leche",
    );
  });

  it("the barcode endpoint cleans its barcode and rejects one that ends up empty", () => {
    expect(addProductBarcodeSchema.parse({ barcode: `75${NUL}91` }).barcode).toBe("7591");
    expect(addProductBarcodeSchema.safeParse({ barcode: NUL }).success).toBe(false);
  });

  it("the price reason is cleaned in price, keep-price and reprice", () => {
    expect(productPriceSchema.parse({ reason: `Sub${NUL}ida`, salePriceRef: 2 }).reason).toBe("Subida");
    expect(keepProductPriceSchema.parse({ reason: `Sub${NUL}ida` }).reason).toBe("Subida");
    expect(keepProductPriceSchema.parse({ reason: NUL }).reason).toBeNull();
    expect(
      repriceProductsSchema.parse({ markupPct: 30, productIds: ["p-1"], reason: `Sub${NUL}ida` }).reason,
    ).toBe("Subida");
  });

  it("category name and description are cleaned; a name left empty is rejected", () => {
    expect(
      createCategorySchema.parse({ description: `Des${NUL}c`, name: `Beb${NUL}idas` }),
    ).toMatchObject({ description: "Desc", name: "Bebidas" });
    expect(updateCategorySchema.parse({ name: `Beb${NUL}idas` }).name).toBe("Bebidas");
    expect(createCategorySchema.safeParse({ name: NUL }).success).toBe(false);
    expect(updateCategorySchema.safeParse({ name: NUL }).success).toBe(false);
  });

  it("the supplier SKU and the supplier id are cleaned", () => {
    const parsed = saveProductSuppliersSchema.parse({
      suppliers: [{ supplierId: `sup-${NUL}1`, supplierSku: `AB${NUL}C` }],
    });

    expect(parsed.suppliers[0]).toMatchObject({ supplierId: "sup-1", supplierSku: "ABC" });
  });

  it("the pack recipe label and the new unit's texts are cleaned", () => {
    const parsed = packConversionInputSchema.parse({
      enabled: true,
      label: `Caja ${NUL}surtida`,
      mode: "create_unit",
      unitProduct: { barcode: `75${NUL}91`, name: `Uni${NUL}dad`, salePriceRef: 1, sku: `U-${NUL}1` },
      unitsPerPack: 6,
    });

    expect(parsed.label).toBe("Caja surtida");
    expect(parsed.unitProduct).toMatchObject({ barcode: "7591", name: "Unidad", sku: "u-1" });
  });
});
