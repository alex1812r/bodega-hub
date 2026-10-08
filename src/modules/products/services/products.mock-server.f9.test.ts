/**
 * @jest-environment node
 *
 * PRO-F9 · paridad del mock con la base y `products.server`: costo esperado en
 * reprecio, cambio de precio y "Mantener precio" (ALTA-1, M1) y clave de
 * idempotencia del alta (ALTA-2).
 */

import { ApiError } from "@/lib/api/apiError";
import { mockPurchases, mockStockMovements } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import {
  applyMockPurchaseCost,
  keepProductPrice,
  listPriceReview,
  repriceProducts,
} from "./priceReview.mock-server";
import { PRODUCT_CREATE_REQUEST_REUSED_MESSAGE } from "./productSchemas";
import {
  createProduct,
  createProductPriceHistoryEntry,
  getProductById,
  getProductPriceHistory,
  listProducts,
} from "./products.mock-server";

const OTHER_STORE_ID = "00000000-0000-4000-8000-000000000002";
const KEY = "33333333-3333-4333-8333-333333333333";
const [purchase] = mockPurchases;

let sequence = 0;

function newProduct(costRef: number, priceRef: number) {
  sequence += 1;

  return createProduct(
    { currentCostRef: costRef, name: `F9 producto ${sequence}`, salePriceRef: priceRef, sku: `f9-mock-${sequence}` },
    DEFAULT_STORE_ID,
  ).id;
}

function history(productId: string) {
  return getProductPriceHistory(productId, new URLSearchParams("limit=100"), DEFAULT_STORE_ID).items;
}

function inQueue(productId: string) {
  return listPriceReview(new URLSearchParams("limit=100"), DEFAULT_STORE_ID).items.some(
    (item) => item.productId === productId,
  );
}

function caught(run: () => unknown) {
  try {
    run();
  } catch (error) {
    return error instanceof ApiError ? { code: error.code, message: error.message, status: error.status } : error;
  }

  return null;
}

describe("mock · reprecio con el costo que vio el usuario (ALTA-1)", () => {
  it("la fila cuyo costo ya es otro responde COST_CHANGED, no cambia de precio y sigue en la cola; las demás se reprecian", () => {
    // Verde con costo 12; una compra lo sube a 20 después de que el usuario abriera la vista previa.
    const stale = newProduct(12, 16);
    const fresh = newProduct(12, 16);
    applyMockPurchaseCost(stale, 20, purchase.id);

    const result = repriceProducts(
      {
        items: [
          { expectedCostRef: 12, productId: stale },
          { expectedCostRef: 12, productId: fresh },
        ],
        markupPct: 30,
        reason: null,
      },
      DEFAULT_STORE_ID,
    );

    expect(result).toEqual({
      failed: 1,
      results: [
        {
          code: "COST_CHANGED",
          message: "El costo cambió de 12.00 a 20.00; revisa el precio",
          productId: stale,
          status: "error",
        },
        { productId: fresh, salePriceRef: 15.6, status: "ok" },
      ],
      updated: 1,
    });
    expect(getProductById(stale, DEFAULT_STORE_ID).salePriceRef).toBe(16);
    expect(history(stale).filter((entry) => entry.kind === "change")).toEqual([]);
    expect(inQueue(stale)).toBe(true);
  });

  it("solo con productIds no hay comprobación de costo: el precio sale del costo vigente", () => {
    const id = newProduct(12, 16);
    applyMockPurchaseCost(id, 20, purchase.id);

    const result = repriceProducts({ markupPct: 30, productIds: [id], reason: null }, DEFAULT_STORE_ID);

    expect(result.results).toEqual([{ productId: id, salePriceRef: 26, status: "ok" }]);
    expect(inQueue(id)).toBe(false);
  });

  it("items y productIds se combinan sin repetir: manda el costo esperado de items", () => {
    const id = newProduct(9, 10);

    const result = repriceProducts(
      { items: [{ expectedCostRef: 9, productId: id }], markupPct: 25, productIds: [id], reason: null },
      DEFAULT_STORE_ID,
    );

    expect(result.results).toEqual([{ productId: id, salePriceRef: 11.25, status: "ok" }]);
  });
});

describe("mock · precio fijo y Mantener precio con costo esperado (ALTA-1, M1)", () => {
  it("Mantener precio con el costo viejo responde 409 y no guarda la instantánea que sacaría al producto de la cola", () => {
    const id = newProduct(10, 12.5);
    applyMockPurchaseCost(id, 14, purchase.id);
    const rowsBefore = history(id).length;

    expect(caught(() => keepProductPrice(id, { expectedCostRef: 10, reason: null }, DEFAULT_STORE_ID))).toEqual({
      code: "CONFLICT",
      message: "El costo cambió de 10.00 a 14.00; revisa el precio",
      status: 409,
    });
    expect(history(id)).toHaveLength(rowsBefore);
    expect(inQueue(id)).toBe(true);

    // Con el costo real (o sin costo esperado) sí se mantiene.
    keepProductPrice(id, { expectedCostRef: 14.004, reason: null }, DEFAULT_STORE_ID);
    expect(inQueue(id)).toBe(false);
  });

  it("el cambio de precio con el costo viejo responde 409 antes de registrar nada", () => {
    const id = newProduct(12, 16);
    applyMockPurchaseCost(id, 20, purchase.id);
    const rowsBefore = history(id).length;

    expect(
      caught(() =>
        createProductPriceHistoryEntry(id, { expectedCostRef: 12, salePriceRef: 15.6 }, DEFAULT_STORE_ID),
      ),
    ).toMatchObject({ message: "El costo cambió de 12.00 a 20.00; revisa el precio", status: 409 });
    expect(history(id)).toHaveLength(rowsBefore);

    expect(
      createProductPriceHistoryEntry(id, { expectedCostRef: 20, salePriceRef: 26 }, DEFAULT_STORE_ID),
    ).toMatchObject({ kind: "change", salePriceRef: 26 });
  });
});

describe("mock · clave de idempotencia del alta (ALTA-2)", () => {
  const harina = { categoryId: "cat-tools", currentCostRef: 3, currentStock: 9, name: "F9 Harina reintento", salePriceRef: 5 };

  function countByName(name: string, storeId = DEFAULT_STORE_ID) {
    return listProducts(new URLSearchParams(`limit=100&search=${encodeURIComponent(name)}`), storeId).items.filter(
      (product) => product.name === name,
    );
  }

  it("alta reintentada con la misma clave: el mismo producto, uno solo, con un solo inventario_inicial de 9", () => {
    const first = createProduct({ ...harina, clientRequestId: KEY }, DEFAULT_STORE_ID);
    const retry = createProduct({ ...harina, clientRequestId: KEY }, DEFAULT_STORE_ID);

    const created = countByName(harina.name);
    const initial = mockStockMovements.filter(
      (movement) => movement.productId === first.id && movement.type === "inventario_inicial",
    );

    expect(retry.id).toBe(first.id);
    expect(created).toHaveLength(1);
    expect(created[0].currentStock).toBe(9);
    expect(initial.map((movement) => movement.quantityDelta)).toEqual([9]);
  });

  it("la misma clave con otro contenido es un 409; en otra tienda es otra clave; sin clave cada envío crea", () => {
    expect(
      caught(() => createProduct({ ...harina, clientRequestId: KEY, currentStock: 20 }, DEFAULT_STORE_ID)),
    ).toEqual({ code: "CONFLICT", message: PRODUCT_CREATE_REQUEST_REUSED_MESSAGE, status: 409 });
    expect(countByName(harina.name)).toHaveLength(1);

    const elsewhere = { ...harina, categoryId: undefined, name: "F9 Harina otra tienda" };
    createProduct({ ...elsewhere, clientRequestId: KEY }, OTHER_STORE_ID);
    expect(countByName(elsewhere.name, OTHER_STORE_ID)).toHaveLength(1);

    const keyless = { ...harina, name: "F9 Harina sin clave" };
    createProduct(keyless, DEFAULT_STORE_ID);
    createProduct(keyless, DEFAULT_STORE_ID);
    expect(countByName(keyless.name)).toHaveLength(2);
  });
});
