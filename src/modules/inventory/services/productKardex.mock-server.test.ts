/**
 * @jest-environment node
 */
/**
 * INV-03 · kardex del producto en modo mock: mismas reglas que el servicio de
 * Supabase (serie de 30 días de Caracas, saldo desde el stock actual, tope de
 * la ventana y 404 para un producto de otra tienda).
 */

import { ApiError } from "@/lib/api/apiError";
import { mockProducts, mockStockMovements, type StockMovementMock } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { KARDEX_WINDOW_MAX_ROWS } from "./productKardex";
import { getProductKardex } from "./productKardex.mock-server";

const PRODUCT_ID = "prod-cable";
/** 20 de mayo de 2026, 11:00 en Caracas: los movimientos semilla caen en la ventana. */
const NOW = new Date("2026-05-20T15:00:00.000Z");

function kardex(productId = PRODUCT_ID, storeId = DEFAULT_STORE_ID) {
  return getProductKardex(new URLSearchParams({ productId }), storeId);
}

function expectApiError(run: () => unknown, status: number) {
  let error: unknown = null;

  try {
    run();
  } catch (reason) {
    error = reason;
  }

  expect(error).toBeInstanceOf(ApiError);
  expect((error as ApiError).status).toBe(status);
}

describe("productKardex.mock-server · getProductKardex", () => {
  const seedLength = mockStockMovements.length;

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
    jest.useRealTimers();
    // Los movimientos añadidos por un test entran al principio, como en el mock.
    mockStockMovements.splice(0, mockStockMovements.length - seedLength);
  });

  function addMovements(movements: StockMovementMock[]) {
    mockStockMovements.unshift(...movements);
  }

  it("devuelve el producto, 30 días de serie hasta hoy y el saldo de hoy igual al stock actual", () => {
    const product = mockProducts.find((candidate) => candidate.id === PRODUCT_ID);
    const result = kardex();

    expect(result.product).toEqual({
      currentStock: product?.currentStock,
      id: PRODUCT_ID,
      minStock: product?.minStock,
      name: product?.name,
      sku: product?.sku,
    });
    expect(result.series).toHaveLength(30);
    expect(result.series[0].date).toBe("2026-04-21");
    expect(result.series[29]).toMatchObject({
      balance: product?.currentStock,
      date: "2026-05-20",
    });
    expect(result.truncated).toBe(false);
  });

  it("la serie cuadra: cada cierre es el anterior más entradas menos salidas", () => {
    const result = kardex();
    const windowMovements = mockStockMovements.filter(
      (movement) => movement.productId === PRODUCT_ID,
    );
    const entries = windowMovements
      .filter((movement) => movement.quantityDelta > 0)
      .reduce((sum, movement) => sum + movement.quantityDelta, 0);
    const exits = windowMovements
      .filter((movement) => movement.quantityDelta < 0)
      .reduce((sum, movement) => sum - movement.quantityDelta, 0);

    expect(windowMovements.length).toBeGreaterThan(0);
    expect(result.entries30d).toBe(entries);
    expect(result.exits30d).toBe(exits);
    expect(result.openingBalance).toBe(result.product.currentStock - entries + exits);

    result.series.forEach((point, index) => {
      const previous = index === 0 ? result.openingBalance : result.series[index - 1].balance;

      expect(point.balance).toBe((previous ?? 0) + (point.entries ?? 0) - (point.exits ?? 0));
    });
  });

  it("asigna el movimiento a su día de Caracas y deja fuera lo anterior a la ventana", () => {
    const before = kardex();

    addMovements([
      {
        // 23:30 en Caracas del 19 de mayo (día 20 en UTC).
        createdAt: "2026-05-20T03:30:00.000Z",
        id: "mov-kardex-borde",
        productId: PRODUCT_ID,
        quantityDelta: -1,
        stockAfter: 0,
        type: "ajuste_salida",
      },
      {
        // 23:59 en Caracas del 20 de abril: un minuto antes de la ventana.
        createdAt: "2026-04-21T03:59:00.000Z",
        id: "mov-kardex-fuera",
        productId: PRODUCT_ID,
        quantityDelta: 50,
        stockAfter: 0,
        type: "ajuste_entrada",
      },
    ]);

    const result = kardex();
    const byDate = new Map(result.series.map((point) => [point.date, point]));
    const previousByDate = new Map(before.series.map((point) => [point.date, point]));

    expect(byDate.get("2026-05-19")?.exits).toBe((previousByDate.get("2026-05-19")?.exits ?? 0) + 1);
    expect(byDate.get("2026-05-20")?.exits).toBe(previousByDate.get("2026-05-20")?.exits);
    expect(result.entries30d).toBe(before.entries30d);
  });

  it("lista los últimos 10 movimientos del producto, del más reciente al más antiguo, con su documento", () => {
    addMovements(
      Array.from({ length: 12 }, (_, index) => ({
        createdAt: `2026-05-19T${String(10 + index).padStart(2, "0")}:00:00.000Z`,
        id: `mov-kardex-${index}`,
        productId: PRODUCT_ID,
        quantityDelta: 1,
        reason: "Conteo físico",
        stockAfter: index,
        type: "ajuste_entrada" as const,
      })),
    );

    const { lastMovements } = kardex();
    const dates = lastMovements.map((movement) => movement.createdAt);

    expect(lastMovements).toHaveLength(10);
    expect(dates).toEqual([...dates].sort().reverse());
    expect(lastMovements[0]).toEqual({
      conversionId: null,
      createdAt: "2026-05-19T21:00:00.000Z",
      documentKind: null,
      documentNumber: null,
      id: "mov-kardex-11",
      purchaseId: null,
      quantityDelta: 1,
      reason: "Conteo físico",
      saleId: null,
      stockAfter: 11,
      type: "ajuste_entrada",
    });
  });

  it("un producto sin movimientos devuelve la serie plana y la lista vacía", () => {
    const withoutMovements = mockProducts.find(
      (product) =>
        (product.storeId ?? DEFAULT_STORE_ID) === DEFAULT_STORE_ID &&
        !mockStockMovements.some((movement) => movement.productId === product.id),
    );

    expect(withoutMovements).toBeDefined();

    const result = kardex(withoutMovements?.id);

    expect(result.lastMovements).toEqual([]);
    expect(result.series.every((point) => point.balance === withoutMovements?.currentStock)).toBe(
      true,
    );
    expect(result).toMatchObject({ entries30d: 0, exits30d: 0, truncated: false });
  });

  it("con más movimientos que el tope marca truncated y deja sin dato los días no leídos", () => {
    addMovements([
      ...Array.from({ length: KARDEX_WINDOW_MAX_ROWS }, (_, index) => ({
        createdAt: "2026-05-20T14:00:00.000Z",
        id: `mov-kardex-masivo-${index}`,
        productId: PRODUCT_ID,
        quantityDelta: 1,
        stockAfter: 0,
        type: "ajuste_entrada" as const,
      })),
    ]);

    const result = kardex();

    expect(result.truncated).toBe(true);
    expect(result.openingBalance).toBeNull();
    // Todo lo leído es de hoy y el día pudo quedar a medias: ningún día tiene dato.
    expect(result.series).toHaveLength(30);
    expect(result.series.every((point) => point.balance === null)).toBe(true);
    expect(result.lastMovements).toHaveLength(10);
  });

  it("un producto de otra tienda o inexistente responde 404", () => {
    expectApiError(() => kardex("prod-sur-arroz"), 404);
    expectApiError(() => kardex("prod-no-existe"), 404);
    expectApiError(() => kardex(PRODUCT_ID, "00000000-0000-4000-8000-000000000002"), 404);
  });

  it("sin productId responde 400", () => {
    expectApiError(() => getProductKardex(new URLSearchParams(), DEFAULT_STORE_ID), 400);
    expectApiError(
      () => getProductKardex(new URLSearchParams({ productId: "a".repeat(201) }), DEFAULT_STORE_ID),
      400,
    );
  });
});
