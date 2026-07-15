import { ApiError } from "@/lib/api/apiError";
import { paginateList } from "@/lib/api/pagination";
import {
  mockCategories,
  mockProducts,
  mockStockMovements,
  type StockMovementType,
} from "@/shared/mocks/erp-data";

import {
  matchesInventoryListFilters,
  parseInventoryListFilters,
} from "../utils/inventoryListFilters";
import {
  matchesInventoryMovementFilters,
  parseInventoryMovementFilters,
} from "../utils/inventoryMovementFilters";

export function listInventory(searchParams: URLSearchParams) {
  const filters = parseInventoryListFilters(searchParams);

  const items = mockProducts
    .filter((product) => matchesInventoryListFilters(product, filters))
    .map((product) => ({
      ...product,
      category: mockCategories.find((category) => category.id === product.categoryId),
    }));

  return paginateList(items, searchParams);
}

export function listStockMovements(searchParams: URLSearchParams) {
  const filters = parseInventoryMovementFilters(searchParams);

  const items = mockStockMovements
    .filter((movement) => matchesInventoryMovementFilters(movement, filters))
    .map((movement) => ({
      ...movement,
      product: mockProducts.find((product) => product.id === movement.productId),
    }));

  return paginateList(items, searchParams);
}

export function getStockCard(searchParams: URLSearchParams) {
  return listStockMovements(searchParams);
}

export function createStockAdjustment(input: {
  productId: string;
  quantityDelta: number;
  reason?: string;
  type?: StockMovementType;
}) {
  const product = mockProducts.find((item) => item.id === input.productId);
  const stockAfter = (product?.currentStock ?? 0) + input.quantityDelta;

  if (!product) {
    throw new ApiError(404, "NOT_FOUND", "Producto no encontrado.");
  }

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
    type: input.type ?? "ajuste_entrada",
  };
}
