/**
 * @jest-environment node
 */
/**
 * COM-F8 · paridad del mock con la base: `products_store_barcode_unique` (un código de
 * barras no vacío por tienda). El BFF recorta el código antes de guardarlo y el 23505
 * sale como 409 «El recurso ya existe.». No hay índice único sobre el nombre.
 */

import { ApiError } from "@/lib/api/apiError";
import { mockProducts } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { createProduct, updateProduct } from "./products.mock-server";

const initialLength = mockProducts.length;
// Código de barras de un producto de la semilla (Taladro percutor).
const SEED_BARCODE = "7501234567890";

function expectConflict(action: () => unknown) {
  let thrown: unknown;

  try {
    action();
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(ApiError);
  expect(thrown).toMatchObject({
    code: "CONFLICT",
    message: "El recurso ya existe.",
    status: 409,
  });
}

afterEach(() => {
  mockProducts.length = initialLength;
});

describe("products.mock-server createProduct: código de barras único por tienda (COM-F8)", () => {
  it("rechaza con 409 un código de barras que ya tiene un producto de la semilla, y no crea nada", () => {
    expectConflict(() =>
      createProduct({ barcode: SEED_BARCODE, name: "Otro taladro", salePriceRef: 4 }, DEFAULT_STORE_ID),
    );
    expect(mockProducts).toHaveLength(initialLength);
  });

  it("rechaza el código de un producto recién creado, también con espacios alrededor", () => {
    createProduct({ barcode: "7790000000011", name: "Caos uno", salePriceRef: 4 }, DEFAULT_STORE_ID);

    expectConflict(() =>
      createProduct({ barcode: "7790000000011", name: "Caos dos", salePriceRef: 4 }, DEFAULT_STORE_ID),
    );
    expectConflict(() =>
      createProduct(
        { barcode: "  7790000000011  ", name: "Caos tres", salePriceRef: 4 },
        DEFAULT_STORE_ID,
      ),
    );
    expect(mockProducts).toHaveLength(initialLength + 1);
  });

  it("el mismo código en otra tienda sí vale: el índice es por tienda", () => {
    const created = createProduct(
      { barcode: SEED_BARCODE, name: "Taladro de otra tienda", salePriceRef: 4 },
      "store-otra",
    );

    expect(created.barcode).toBe(SEED_BARCODE);
  });

  it("sin código, o con uno en blanco, no choca con nada", () => {
    createProduct({ name: "Sin código uno", salePriceRef: 4 }, DEFAULT_STORE_ID);
    createProduct({ barcode: "   ", name: "Sin código dos", salePriceRef: 4 }, DEFAULT_STORE_ID);
    createProduct({ barcode: null, name: "Sin código tres", salePriceRef: 4 }, DEFAULT_STORE_ID);

    expect(mockProducts).toHaveLength(initialLength + 3);
  });

  it("dos productos con el mismo nombre se aceptan: la base no tiene índice único de nombre", () => {
    createProduct({ name: "Caos repetido", salePriceRef: 4 }, DEFAULT_STORE_ID);
    createProduct({ name: "Caos repetido", salePriceRef: 4 }, DEFAULT_STORE_ID);

    expect(mockProducts.filter((product) => product.name === "Caos repetido")).toHaveLength(2);
  });
});

describe("products.mock-server updateProduct: código de barras único por tienda (COM-F8)", () => {
  it("rechaza con 409 poner a un producto el código de otro de la tienda, y no lo cambia", () => {
    const created = createProduct(
      { barcode: "7790000000028", name: "Caos editable", salePriceRef: 4 },
      DEFAULT_STORE_ID,
    );

    expectConflict(() =>
      updateProduct(created.id, { barcode: ` ${SEED_BARCODE} ` }, DEFAULT_STORE_ID),
    );
    expect(mockProducts.find((product) => product.id === created.id)?.barcode).toBe("7790000000028");
  });

  it("reenviar su propio código, o quitarlo, sigue valiendo", () => {
    const created = createProduct(
      { barcode: "7790000000035", name: "Caos propio", salePriceRef: 4 },
      DEFAULT_STORE_ID,
    );

    expect(updateProduct(created.id, { barcode: "7790000000035" }, DEFAULT_STORE_ID).barcode).toBe(
      "7790000000035",
    );
    expect(updateProduct(created.id, { barcode: "" }, DEFAULT_STORE_ID).barcode).toBeNull();
  });
});
