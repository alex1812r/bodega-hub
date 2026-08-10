import { ApiError } from "@/lib/api/apiError";
import { assertMockStoreResource } from "@/lib/api/assertStoreResource";
import { paginateList } from "@/lib/api/pagination";
import {
  mockCategories,
  mockProductPackConversions,
  mockProducts,
  mockStockMovements,
  type StockMovementType,
} from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { listPackConversions } from "@/modules/products/services/products.mock-server";
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

  product.currentStock = stockAfter;

  const movement = {
    createdAt: new Date().toISOString(),
    id: `mov-mock-${Date.now()}`,
    productId: input.productId,
    quantityDelta: input.quantityDelta,
    reason: input.reason,
    stockAfter,
    storeId,
    type: input.type ?? "ajuste_entrada",
  };

  mockStockMovements.unshift(movement);
  return movement;
}

export function convertPackToUnits(
  input: {
    packProductId: string;
    packQuantity: number;
    reason?: string;
  },
  storeId: string,
) {
  const link = mockProductPackConversions.find(
    (item) =>
      item.isActive &&
      item.storeId === storeId &&
      item.packProductId === input.packProductId,
  );

  if (!link) {
    throw new ApiError(
      400,
      "BAD_REQUEST",
      "El producto no tiene conversion de empaque a unidad activa.",
    );
  }

  const pack = mockProducts.find((item) => item.id === link.packProductId);
  const unit = mockProducts.find((item) => item.id === link.unitProductId);
  assertMockStoreResource(pack, storeId, "Producto de empaque no encontrado.");
  assertMockStoreResource(unit, storeId, "Producto unidad no encontrado.");

  if (input.packQuantity <= 0) {
    throw new ApiError(400, "BAD_REQUEST", "La cantidad de empaques debe ser mayor a cero.");
  }

  if (pack.currentStock < input.packQuantity) {
    throw new ApiError(400, "BAD_REQUEST", "Stock insuficiente de empaque.");
  }

  const unitQuantity = input.packQuantity * link.unitsPerPack;
  const transferredValue = input.packQuantity * pack.currentCostRef;
  const unitCostRef = Number((transferredValue / unitQuantity).toFixed(2));
  const previousUnitStock = unit.currentStock;
  const packStockAfter = pack.currentStock - input.packQuantity;
  const unitStockAfter = unit.currentStock + unitQuantity;

  pack.currentStock = packStockAfter;
  unit.currentStock = unitStockAfter;
  unit.currentCostRef =
    previousUnitStock <= 0
      ? unitCostRef
      : Number(
          (
            (previousUnitStock * unit.currentCostRef + transferredValue) /
            unitStockAfter
          ).toFixed(2),
        );

  const conversionId = `conv-mock-${Date.now()}`;
  const createdAt = new Date().toISOString();

  const packMovement = {
    conversionId,
    createdAt,
    id: `mov-pack-${Date.now()}`,
    productId: pack.id,
    quantityDelta: -input.packQuantity,
    reason: input.reason,
    stockAfter: packStockAfter,
    storeId,
    type: "conversion_salida" as const,
  };
  const unitMovement = {
    conversionId,
    createdAt,
    id: `mov-unit-${Date.now()}`,
    productId: unit.id,
    quantityDelta: unitQuantity,
    reason: input.reason,
    stockAfter: unitStockAfter,
    storeId,
    type: "conversion_entrada" as const,
  };

  mockStockMovements.unshift(unitMovement, packMovement);

  return {
    conversionId,
    packQuantity: input.packQuantity,
    unitCostRef,
    unitQuantity,
    unitsPerPack: link.unitsPerPack,
    packMovement,
    unitMovement,
  };
}

export { listPackConversions };
