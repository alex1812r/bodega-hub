import { getBusinessTodayIsoDate } from "@/modules/dashboard/utils/businessDate";
import {
  mockCategories,
  mockProducts,
  mockSaleItems,
  mockStockMovements,
  type StockMovementMock,
} from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";
import { toCaracasDateKey } from "@/shared/utils/caracasBusinessDay";
import { roundMoney } from "@/shared/utils/currency";

import {
  buildDeadStockReport,
  buildStockAdjustmentsReport,
  buildStockTurnoverReport,
  isManualAdjustmentMovement,
  isSaleLedgerMovement,
  normalizeAdjustmentReason,
  type DeadStockQuery,
  type DeadStockReport,
  type ProductLedgerRow,
  type StockAdjustmentInput,
  type StockAdjustmentsQuery,
  type StockAdjustmentsReport,
  type StockFlowRow,
  type StockTurnoverQuery,
  type StockTurnoverReport,
} from "./inventoryReports";
import { UNCATEGORIZED_LABEL } from "./moneyReports";

/**
 * Mock de los reportes de inventario (REP-07): mismas formas y reglas que
 * `inventoryReports.server.ts`, sobre el libro en memoria
 * (`mockStockMovements`).
 */

function inStore(entityStoreId: string | null | undefined, storeId: string) {
  return (entityStoreId ?? DEFAULT_STORE_ID) === storeId;
}

type LedgerEntry = { movement: StockMovementMock; seq: number };

/**
 * Libro de la tienda del movimiento más antiguo al más reciente, con su
 * posición. El mock no tiene `seq`: ordena por `createdAt` y, a igualdad, es
 * posterior el que está antes en `mockStockMovements` (los nuevos entran al
 * principio), como `inventory.mock-server`.
 */
function storeLedger(storeId: string): LedgerEntry[] {
  return mockStockMovements
    .filter((movement) => inStore(movement.storeId, storeId))
    .reverse()
    .sort((first, second) => Date.parse(first.createdAt) - Date.parse(second.createdAt))
    .map((movement, index) => ({ movement, seq: index + 1 }));
}

function storeProducts(storeId: string) {
  return mockProducts.filter((product) => inStore(product.storeId, storeId));
}

/**
 * Lo que da `report_product_last_movement`. El mock no guarda la fecha de alta
 * del producto: uno sin movimientos cuenta desde `today` (no lleva días sin
 * vender).
 */
function productLedgerRows(storeId: string, today: string): ProductLedgerRow[] {
  const ledger = storeLedger(storeId);

  return storeProducts(storeId).map((product) => {
    const movements = ledger.filter(({ movement }) => movement.productId === product.id);
    const lastSaleAt = movements.findLast(({ movement }) => movement.type === "venta")?.movement.createdAt ?? null;
    const idleFrom = lastSaleAt ?? movements[0]?.movement.createdAt ?? null;
    const categoryId = product.categoryId || null;

    return {
      categoryId,
      categoryName:
        mockCategories.find((category) => category.id === categoryId)?.name ?? UNCATEGORIZED_LABEL,
      costRef: product.currentCostRef,
      idleSince: idleFrom === null ? today : toCaracasDateKey(idleFrom),
      isActive: product.isActive,
      lastMovementAt: movements.at(-1)?.movement.createdAt ?? null,
      lastSaleAt,
      name: product.name,
      productId: product.id,
      sku: product.sku,
      stock: product.currentStock,
      stockValueRef: roundMoney(product.currentStock * product.currentCostRef),
    };
  });
}

/** Costo de la línea de venta de ese producto (promedio ponderado); `null` si la venta no tiene línea. */
function saleLineUnitCost(saleId: string | undefined, productId: string) {
  const lines = mockSaleItems.filter((item) => item.saleId === saleId && item.productId === productId);
  const units = lines.reduce((sum, item) => sum + item.quantity, 0);

  return units === 0
    ? null
    : lines.reduce((sum, item) => sum + item.unitCostRefSnapshot * item.quantity, 0) / units;
}

/** Lo que da `report_stock_daily_flow`, con una fila por movimiento (el reporte las suma). */
function stockFlowRows(storeId: string): StockFlowRow[] {
  const costOf = new Map(storeProducts(storeId).map((product) => [product.id, product.currentCostRef]));

  return storeLedger(storeId).flatMap(({ movement }) => {
    const currentCost = costOf.get(movement.productId);

    if (currentCost === undefined) {
      return [];
    }

    const isSale = isSaleLedgerMovement(movement);
    const unitCost = isSale ? (saleLineUnitCost(movement.saleId, movement.productId) ?? currentCost) : 0;

    return [
      {
        cogsRef: isSale ? roundMoney(-movement.quantityDelta * unitCost) : 0,
        day: toCaracasDateKey(movement.createdAt),
        netDelta: movement.quantityDelta,
        productId: movement.productId,
        soldUnits: isSale ? -movement.quantityDelta : 0,
      },
    ];
  });
}

/** Lo que da `report_stock_adjustments`. */
function stockAdjustmentRows(storeId: string): StockAdjustmentInput[] {
  const productOf = new Map(storeProducts(storeId).map((product) => [product.id, product]));

  return storeLedger(storeId).flatMap(({ movement, seq }) => {
    const product = productOf.get(movement.productId);

    if (!product || !isManualAdjustmentMovement(movement)) {
      return [];
    }

    return [
      {
        createdAt: movement.createdAt,
        date: toCaracasDateKey(movement.createdAt),
        movementId: movement.id,
        productId: product.id,
        productName: product.name,
        quantityDelta: movement.quantityDelta,
        reason: normalizeAdjustmentReason(movement.reason),
        seq,
        sku: product.sku,
        type: movement.type as StockAdjustmentInput["type"],
        unitCostRef: product.currentCostRef,
        valueRef: roundMoney(movement.quantityDelta * product.currentCostRef),
      },
    ];
  });
}

/** `today`: día operativo Caracas desde el que se cuentan los días (fijo en mock). */
export function getDeadStockReport(
  query: DeadStockQuery,
  storeId: string,
  today: string = getBusinessTodayIsoDate(),
): DeadStockReport {
  return buildDeadStockReport({ query, rows: productLedgerRows(storeId, today), today });
}

export function getStockTurnoverReport(
  query: StockTurnoverQuery,
  storeId: string,
  today: string = getBusinessTodayIsoDate(),
): StockTurnoverReport {
  return buildStockTurnoverReport({
    flow: stockFlowRows(storeId),
    products: productLedgerRows(storeId, today),
    query,
  });
}

export function getStockAdjustmentsReport(
  query: StockAdjustmentsQuery,
  storeId: string,
): StockAdjustmentsReport {
  return buildStockAdjustmentsReport({ query, rows: stockAdjustmentRows(storeId) });
}
