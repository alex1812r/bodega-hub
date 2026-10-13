/**
 * @jest-environment node
 */
/**
 * PRO-F7 · paridad con `products.server`: un alta con una receta de empaque
 * inválida no deja el producto creado (ni su movimiento de stock inicial).
 */

import {
  mockProductPackConversions,
  mockProducts,
  mockStockMovements,
} from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { packConversionInputSchema } from "./packConversionSchemas";
import { createProduct } from "./products.mock-server";

const OTHER_STORE_ID = "00000000-0000-4000-8000-000000000002";

function seedProduct(id: string, name: string, storeId = DEFAULT_STORE_ID) {
  mockProducts.push({
    categoryId: "cat-tools",
    currentCostRef: 1.5,
    currentStock: 4,
    id,
    isActive: true,
    minStock: 0,
    name,
    salePriceRef: 2,
    sku: id,
    storeId,
  });
}

function assorted(unitProductIds: string[]) {
  return packConversionInputSchema.parse({
    components: unitProductIds.map((unitProductId) => ({ unitProductId, unitsPerPack: 2 })),
    enabled: true,
    mode: "assorted",
    totalUnits: unitProductIds.length * 2,
  });
}

function link(unitProductId: string) {
  return packConversionInputSchema.parse({
    enabled: true,
    mode: "link_existing",
    unitProductId,
    unitsPerPack: 6,
  });
}

function createUnit(sku: string) {
  return packConversionInputSchema.parse({
    enabled: true,
    mode: "create_unit",
    unitProduct: { salePriceRef: 3, sku },
    unitsPerPack: 6,
  });
}

function snapshot() {
  return {
    movements: mockStockMovements.length,
    products: mockProducts.length,
    recipes: mockProductPackConversions.length,
  };
}

beforeAll(() => {
  seedProduct("f7-cola", "F7 Cola");
  seedProduct("f7-uva", "F7 Uva");
  seedProduct("f7-caja", "F7 Caja de cola");
  seedProduct("f7-ajena", "F7 De otra tienda", OTHER_STORE_ID);
  createProduct(
    { name: "F7 Empaque previo", packConversion: link("f7-cola"), sku: "f7-empaque-previo" },
    DEFAULT_STORE_ID,
  );
});

describe("createProduct (mock) · receta inválida: no se crea el producto (PRO-F7)", () => {
  it.each([
    ["surtido con un componente que no existe", assorted(["f7-cola", "f7-fantasma"]), 404],
    ["surtido con un componente de otra tienda", assorted(["f7-cola", "f7-ajena"]), 404],
    ["1 a 1 con una unidad que no existe", link("f7-fantasma"), 404],
    ["1 a 1 con una unidad de otra tienda", link("f7-ajena"), 403],
    ["«crear unidad» con un SKU de unidad ya usado", createUnit("f7-cola"), 409],
    ["«crear unidad» con el mismo SKU que el empaque", createUnit("f7-nuevo"), 409],
  ])("%s: error y nada creado, ni con stock inicial", (_, packConversion, status) => {
    const before = snapshot();

    expect(() =>
      createProduct(
        { currentStock: 5, name: "F7 Nuevo", packConversion, sku: "f7-nuevo" },
        DEFAULT_STORE_ID,
      ),
    ).toThrow(expect.objectContaining({ status }));

    expect(snapshot()).toEqual(before);
    expect(mockProducts.some((product) => product.sku === "f7-nuevo")).toBe(false);
  });

  it("un componente que es empaque con receta activa: 409 y nada creado", () => {
    const pack = mockProducts.find((product) => product.sku === "f7-empaque-previo");
    const before = snapshot();

    expect(() =>
      createProduct(
        { name: "F7 Nuevo", packConversion: assorted(["f7-uva", pack?.id ?? ""]), sku: "f7-nuevo" },
        DEFAULT_STORE_ID,
      ),
    ).toThrow("Un componente es un empaque con receta activa: no puede salir de otro empaque.");

    expect(snapshot()).toEqual(before);
  });

  it("tras el error, el reintento con la receta corregida crea el producto con su SKU", () => {
    const created = createProduct(
      { currentStock: 5, name: "F7 Nuevo", packConversion: assorted(["f7-cola", "f7-uva"]), sku: "f7-nuevo" },
      DEFAULT_STORE_ID,
    );

    expect(created.sku).toBe("f7-nuevo");
    expect(created.currentStock).toBe(5);
    expect(created.packConversion).toMatchObject({ kind: "assorted", role: "pack", totalUnits: 4 });
  });
});
