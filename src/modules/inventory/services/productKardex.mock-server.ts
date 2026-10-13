import { ApiError } from "@/lib/api/apiError";
import { mockProducts, mockStockMovements } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { listStockMovements } from "./inventory.mock-server";
import {
  buildKardexSeries,
  getKardexWindow,
  KARDEX_LAST_MOVEMENTS,
  KARDEX_WINDOW_MAX_ROWS,
  type ProductKardex,
  readKardexProductId,
  toKardexMovement,
} from "./productKardex";

/**
 * Kardex de un producto, con las reglas de `productKardex.server.ts`: mismo
 * tope de filas de la ventana, misma serie y 404 para un producto de otra
 * tienda. El mock no tiene `seq`: la ventana se ordena por `createdAt`.
 */
export function getProductKardex(searchParams: URLSearchParams, storeId: string): ProductKardex {
  const productId = readKardexProductId(searchParams);
  const product = mockProducts.find(
    (candidate) =>
      candidate.id === productId && (candidate.storeId ?? DEFAULT_STORE_ID) === storeId,
  );

  if (!product) {
    throw new ApiError(404, "NOT_FOUND", "Producto no encontrado.");
  }

  const window = getKardexWindow();
  const startTime = new Date(window.startUtc).getTime();
  const windowRows = mockStockMovements
    .filter(
      (movement) =>
        movement.productId === productId &&
        (movement.storeId ?? DEFAULT_STORE_ID) === storeId &&
        new Date(movement.createdAt).getTime() >= startTime,
    )
    .sort(
      (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
    );
  const truncated = windowRows.length >= KARDEX_WINDOW_MAX_ROWS;
  const lastMovements = listStockMovements(
    new URLSearchParams({ limit: String(KARDEX_LAST_MOVEMENTS), productId }),
    storeId,
  );

  return {
    ...buildKardexSeries({
      currentStock: product.currentStock,
      dates: window.dates,
      rows: windowRows.slice(0, KARDEX_WINDOW_MAX_ROWS),
      truncated,
    }),
    lastMovements: lastMovements.items.map(toKardexMovement),
    product: {
      currentStock: product.currentStock,
      id: product.id,
      minStock: product.minStock,
      name: product.name,
      sku: product.sku,
    },
    truncated,
  };
}
