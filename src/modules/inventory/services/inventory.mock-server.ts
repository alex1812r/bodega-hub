import { ApiError } from "@/lib/api/apiError";
import { assertMockStoreResource } from "@/lib/api/assertStoreResource";
import { paginateList } from "@/lib/api/pagination";
import {
  mockCategories,
  mockProductPackConversions,
  mockProducts,
  mockPurchaseItems,
  mockPurchases,
  mockSaleItems,
  mockSales,
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
import { assertReturnAdjustmentHasDocument } from "./returnAdjustmentDocument";

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

/**
 * Resultados ya devueltos por clave de idempotencia (`operacion:storeId:clave`),
 * como hacen `adjust_stock` y `convert_pack_to_units` en la base: la misma clave
 * devuelve el resultado original sin mover stock otra vez (C6).
 */
const resultsByClientRequest = new Map<string, unknown>();

function requestKeyFor(operation: string, storeId: string, clientRequestId?: string) {
  return clientRequestId ? `${operation}:${storeId}:${clientRequestId}` : null;
}

export function createStockAdjustment(
  input: StockAdjustmentInput & { clientRequestId?: string },
  storeId: string,
) {
  const requestKey = requestKeyFor("adjustment", storeId, input.clientRequestId);
  const previous = requestKey ? resultsByClientRequest.get(requestKey) : undefined;

  if (previous) {
    return previous as ReturnType<typeof applyStockAdjustment>;
  }

  const movement = applyStockAdjustment(input, storeId);

  if (requestKey) {
    resultsByClientRequest.set(requestKey, movement);
  }

  return movement;
}

type StockAdjustmentInput = {
  productId: string;
  purchaseId?: string;
  quantityDelta: number;
  reason?: string;
  saleId?: string;
  type?: StockMovementType;
};

/**
 * R4 / C15, como `adjust_stock`: una devolucion ligada a su venta o compra exige
 * el documento en la tienda, en un estado devolvible, con ese producto, y no
 * puede superar lo vendido (o recibido) menos lo ya devuelto con movimientos
 * ligados al mismo documento.
 */
function assertLinkedReturnAllowed(input: StockAdjustmentInput, storeId: string) {
  assertReturnAdjustmentHasDocument(input);

  if (input.saleId && input.type !== "devolucion_cliente") {
    throw new ApiError(400, "BAD_REQUEST", "Solo una devolucion de cliente puede ligarse a una venta");
  }

  if (input.purchaseId && input.type !== "devolucion_proveedor") {
    throw new ApiError(400, "BAD_REQUEST", "Solo una devolucion a proveedor puede ligarse a una compra");
  }

  if (input.saleId) {
    // Como la RPC: la venta de otra tienda "no existe" (404), no es un 403.
    const sale = mockSales.find(
      (item) => item.id === input.saleId && (item.storeId ?? DEFAULT_STORE_ID) === storeId,
    );

    if (!sale) {
      throw new ApiError(404, "NOT_FOUND", "Venta no encontrada");
    }

    if (input.quantityDelta < 0) {
      throw new ApiError(400, "BAD_REQUEST", "Este tipo de ajuste requiere quantity_delta positivo");
    }

    if (sale.status === "cancelada" || sale.status === "devuelta") {
      throw new ApiError(409, "CONFLICT", "La venta ya fue cancelada o devuelta");
    }

    if (sale.status !== "pagada" && sale.status !== "pendiente_pago") {
      throw new ApiError(409, "CONFLICT", "Solo se pueden devolver ventas pagadas o pendientes de pago");
    }

    const sold = mockSaleItems
      .filter((item) => item.saleId === input.saleId && item.productId === input.productId)
      .reduce((total, item) => total + item.quantity, 0);

    if (sold === 0) {
      throw new ApiError(400, "BAD_REQUEST", "El producto no pertenece a la venta indicada");
    }

    const alreadyReturned = mockStockMovements
      .filter(
        (movement) =>
          movement.saleId === input.saleId &&
          movement.productId === input.productId &&
          movement.type === "devolucion_cliente",
      )
      .reduce((total, movement) => total + movement.quantityDelta, 0);

    if (input.quantityDelta > sold - alreadyReturned) {
      throw new ApiError(
        409,
        "CONFLICT",
        `La devolucion supera lo vendido en la venta ${sale.invoiceNumber}: vendido ${sold}, ya devuelto ${alreadyReturned}`,
      );
    }
  }

  if (input.purchaseId) {
    const purchase = mockPurchases.find(
      (item) => item.id === input.purchaseId && (item.storeId ?? DEFAULT_STORE_ID) === storeId,
    );

    if (!purchase) {
      throw new ApiError(404, "NOT_FOUND", "Compra no encontrada");
    }

    if (input.quantityDelta > 0) {
      throw new ApiError(
        400,
        "BAD_REQUEST",
        "ajuste_salida / devolucion_proveedor requiere quantity_delta negativo",
      );
    }

    if (purchase.status === "cancelado" || purchase.status === "devuelto") {
      throw new ApiError(409, "CONFLICT", "La compra ya fue cancelada o devuelta");
    }

    if (purchase.status !== "recibido") {
      throw new ApiError(409, "CONFLICT", "Solo se pueden devolver compras recibidas");
    }

    const received = mockPurchaseItems
      .filter((item) => item.purchaseId === input.purchaseId && item.productId === input.productId)
      .reduce((total, item) => total + item.quantity, 0);

    if (received === 0) {
      throw new ApiError(400, "BAD_REQUEST", "El producto no pertenece a la compra indicada");
    }

    const alreadyReturned = mockStockMovements
      .filter(
        (movement) =>
          movement.purchaseId === input.purchaseId &&
          movement.productId === input.productId &&
          movement.type === "devolucion_proveedor",
      )
      .reduce((total, movement) => total - movement.quantityDelta, 0);

    if (-input.quantityDelta > received - alreadyReturned) {
      throw new ApiError(
        409,
        "CONFLICT",
        `La devolucion supera lo recibido en la compra ${purchase.purchaseNumber}: recibido ${received}, ya devuelto ${alreadyReturned}`,
      );
    }
  }
}

function applyStockAdjustment(input: StockAdjustmentInput, storeId: string) {
  const product = mockProducts.find((item) => item.id === input.productId);
  assertMockStoreResource(product, storeId, "Producto no encontrado.");
  assertLinkedReturnAllowed(input, storeId);

  const stockAfter = product.currentStock + input.quantityDelta;

  if (stockAfter < 0) {
    throw new ApiError(400, "BAD_REQUEST", "El ajuste no puede dejar stock negativo.");
  }

  product.currentStock = stockAfter;

  const movement = {
    createdAt: new Date().toISOString(),
    id: `mov-mock-${Date.now()}`,
    productId: input.productId,
    ...(input.purchaseId ? { purchaseId: input.purchaseId } : {}),
    quantityDelta: input.quantityDelta,
    reason: input.reason,
    ...(input.saleId ? { saleId: input.saleId } : {}),
    stockAfter,
    storeId,
    type: input.type ?? "ajuste_entrada",
  };

  mockStockMovements.unshift(movement);
  return movement;
}

export function convertPackToUnits(
  input: {
    clientRequestId?: string;
    packProductId: string;
    packQuantity: number;
    reason?: string;
  },
  storeId: string,
) {
  const requestKey = requestKeyFor("conversion", storeId, input.clientRequestId);
  const previous = requestKey ? resultsByClientRequest.get(requestKey) : undefined;

  if (previous) {
    return previous as ReturnType<typeof applyPackConversion>;
  }

  const result = applyPackConversion(input, storeId);

  if (requestKey) {
    resultsByClientRequest.set(requestKey, result);
  }

  return result;
}

function applyPackConversion(
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
