/**
 * @jest-environment node
 *
 * PRO-F10 · paridad del mock con `products.server`: categoría del producto
 * (M3/M4), precio por PATCH con historial (M5) y búsqueda recortada (M6).
 */

import { mockCategories, mockProductPriceHistory, mockProducts } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import {
  createProduct,
  getProductPriceHistory,
  listProducts,
  updateProduct,
} from "./products.mock-server";

const OTHER_STORE_ID = "00000000-0000-4000-8000-000000000002";
const FOREIGN_CATEGORY = "cat-f10-ajena";
const INACTIVE_CATEGORY = "cat-f10-inactiva";

const CATEGORY_MESSAGE = "La categoría no existe o no pertenece a esta tienda.";
const INACTIVE_MESSAGE = "La categoría está inactiva: elige otra.";
const REQUIRED_MESSAGE = "El producto necesita una categoría.";

let sequence = 0;

function newProduct(overrides: Parameters<typeof createProduct>[0] = {}) {
  sequence += 1;

  return createProduct(
    {
      categoryId: "cat-tools",
      currentCostRef: 8,
      name: `F10 producto ${sequence}`,
      salePriceRef: 10,
      sku: `f10-mock-${sequence}`,
      ...overrides,
    },
    DEFAULT_STORE_ID,
  );
}

function history(productId: string) {
  return getProductPriceHistory(productId, new URLSearchParams("limit=100"), DEFAULT_STORE_ID).items;
}

beforeAll(() => {
  mockCategories.push(
    { id: FOREIGN_CATEGORY, isActive: true, name: "General ajena", storeId: OTHER_STORE_ID, taxRate: 16 },
    { id: INACTIVE_CATEGORY, isActive: false, name: "Inactiva", taxRate: 16 },
  );
});

afterAll(() => {
  for (const id of [FOREIGN_CATEGORY, INACTIVE_CATEGORY]) {
    mockCategories.splice(
      mockCategories.findIndex((category) => category.id === id),
      1,
    );
  }
});

describe("products.mock-server · categoría del producto (PRO-F10 · M3/M4)", () => {
  it("createProduct rechaza la categoría de otra tienda, una inexistente, una inactiva y una vacía", () => {
    const before = mockProducts.length;

    expect(() => newProduct({ categoryId: FOREIGN_CATEGORY })).toThrow(
      expect.objectContaining({ message: CATEGORY_MESSAGE, status: 400 }),
    );
    expect(() => newProduct({ categoryId: "cat-no-existe" })).toThrow(
      expect.objectContaining({ message: CATEGORY_MESSAGE, status: 400 }),
    );
    expect(() => newProduct({ categoryId: INACTIVE_CATEGORY })).toThrow(
      expect.objectContaining({ message: INACTIVE_MESSAGE, status: 400 }),
    );
    expect(() => newProduct({ categoryId: " " })).toThrow(
      expect.objectContaining({ message: REQUIRED_MESSAGE, status: 400 }),
    );
    expect(mockProducts).toHaveLength(before);
  });

  it("createProduct acepta una categoría activa de la tienda", () => {
    expect(newProduct({ categoryId: "cat-electric" }).categoryId).toBe("cat-electric");
  });

  it("updateProduct rechaza cambiar a una categoría ajena, inactiva o vacía y no toca el producto", () => {
    const product = newProduct();

    expect(() =>
      updateProduct(product.id, { categoryId: FOREIGN_CATEGORY, name: "Cambiado" }, DEFAULT_STORE_ID),
    ).toThrow(expect.objectContaining({ message: CATEGORY_MESSAGE, status: 400 }));
    expect(() =>
      updateProduct(product.id, { categoryId: INACTIVE_CATEGORY, name: "Cambiado" }, DEFAULT_STORE_ID),
    ).toThrow(expect.objectContaining({ message: INACTIVE_MESSAGE, status: 400 }));
    expect(() =>
      updateProduct(product.id, { categoryId: "", name: "Cambiado" }, DEFAULT_STORE_ID),
    ).toThrow(expect.objectContaining({ message: REQUIRED_MESSAGE, status: 400 }));

    expect(mockProducts.find((item) => item.id === product.id)).toMatchObject({
      categoryId: "cat-tools",
      name: product.name,
    });
  });

  it("updateProduct deja reenviar la categoría actual aunque esté inactiva y cambiar a otra activa", () => {
    const product = newProduct();
    const stored = mockProducts.find((item) => item.id === product.id);
    if (!stored) throw new Error("falta el producto recién creado");
    stored.categoryId = INACTIVE_CATEGORY;

    expect(
      updateProduct(product.id, { categoryId: INACTIVE_CATEGORY, name: "Otro" }, DEFAULT_STORE_ID).name,
    ).toBe("Otro");
    expect(
      updateProduct(product.id, { categoryId: "cat-electric" }, DEFAULT_STORE_ID).categoryId,
    ).toBe("cat-electric");
  });
});

describe("products.mock-server updateProduct · precio (PRO-F10 · M5)", () => {
  it("un precio distinto deja una entrada de historial con el motivo de la edición y el costo ya guardado", () => {
    const product = newProduct();
    const entriesBefore = history(product.id).length;

    const updated = updateProduct(
      product.id,
      { currentCostRef: 9, salePriceRef: 12.5 },
      DEFAULT_STORE_ID,
    );

    expect(updated.salePriceRef).toBe(12.5);
    expect(history(product.id)).toHaveLength(entriesBefore + 1);
    expect(history(product.id)[0]).toMatchObject({
      previousSalePriceRef: 10,
      reason: "Edición del producto",
      salePriceRef: 12.5,
    });
    // La instantánea se toma con el costo de esta misma edición: no entra en "Por revisar".
    expect(updated.priceReview).toBeUndefined();
  });

  it("el mismo precio se ignora: sin entrada de historial", () => {
    const product = newProduct();
    const entriesBefore = mockProductPriceHistory.length;

    updateProduct(product.id, { name: "Mismo precio", salePriceRef: 10 }, DEFAULT_STORE_ID);
    updateProduct(product.id, { salePriceRef: 10.004 }, DEFAULT_STORE_ID);

    expect(mockProductPriceHistory).toHaveLength(entriesBefore);
    expect(mockProducts.find((item) => item.id === product.id)?.salePriceRef).toBe(10);
  });
});

describe("products.mock-server listProducts · búsqueda (PRO-F10 · M6)", () => {
  it("recorta el término a 100 caracteres, como el server", () => {
    const name = `F10 ${"x".repeat(96)}`;
    const product = newProduct({ name });

    const found = listProducts(
      new URLSearchParams({ limit: "100", search: `${name}${"y".repeat(9_900)}` }),
      DEFAULT_STORE_ID,
    );

    expect(found.items.map((item) => item.id)).toEqual([product.id]);
  });

  it("encuentra por subcadena los términos con caracteres reservados de PostgREST", () => {
    const product = newProduct({ name: 'F10 Harina (1 kg) x, 100% "extra"' });

    for (const search of ["Harina (1 kg) x", "x, 100%", '"extra"', ")"]) {
      const found = listProducts(new URLSearchParams({ limit: "100", search }), DEFAULT_STORE_ID);

      expect(found.items.map((item) => item.id)).toContain(product.id);
    }
  });
});
