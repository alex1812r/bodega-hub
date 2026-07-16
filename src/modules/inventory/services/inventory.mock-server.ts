import { ApiError } from "@/lib/api/apiError";
import { assertMockStoreResource } from "@/lib/api/assertStoreResource";
import { paginateList } from "@/lib/api/pagination";
import {
  mockCategories,
  mockProducts,
  mockStockMovements,
  type StockMovementType,
} from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import {
  matchesInventoryListFilters,
  parseInventoryListFilters,
} from "../utils/inventoryListFilters";
import {
  matchesInventoryMovementFilters,
  parseInventoryMovementFilters,
} from "../utils/inventoryMovementFilters";

export function listInventory(searchParams: URLSearchParams, storeId: string) {
  const filters = parseInventoryListFilters(searchParams);

  const items = mockProducts
    .filter(
      (product) =>
        (product.storeId ?? DEFAULT_STORE_ID) === storeId &&
        matchesInventoryListFilters(product, filters),
    )
    .map((product) => ({
      ...product,
      category: mockCategories.find((category) => category.id === product.categoryId),
    }));

  return paginateList(items, searchParams);
}

export function listStockMovements(searchParams: URLSearchParams, storeId: string) {
  const filters = parseInventoryMovementFilters(searchParams);

  const items = mockStockMovements
    .filter(
      (movement) =>
        (movement.storeId ?? DEFAULT_STORE_ID) === storeId &&
        matchesInventoryMovementFilters(movement, filters),
    )
    .map((movement) => ({
      ...movement,
      product: mockProducts.find((product) => product.id === movement.productId),
    }));

  return paginateList(items, searchParams);
}

export function getStockCard(searchParams: URLSearchParams, storeId: string) {
  return listStockMovements(searchParams, storeId);
}

export function createStockAdjustment(
  input: {
    productId: string;
    quantityDelta: number;
    reason?: string;
    type?: StockMovementType;
  },
  storeId: string,
) {
  const product = mockProducts.find((item) => item.id === input.productId);
  assertMockStoreResource(product, storeId, "Producto no encontrado.");

  const stockAfter = product.currentStock + input.quantityDelta;

  if (stockAfter < 0) {
    throw new ApiError(400, "BAD_REQUEST", "El ajuste no puede dejar stock negativo.");
  }

  return {
    createdAt: new Date().toISOString(),
    id: `mov-mock-${Date.now()}`,
    productId: input.productId,
    quantityDelta: input.quantityDelta,
    reason: input.reason,
    stockAfter,
    storeId,
    type: input.type ?? "ajuste_entrada",
  };
}
