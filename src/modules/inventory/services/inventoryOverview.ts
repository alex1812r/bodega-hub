import type { CategoryMock, ProductMock, StockMovementType } from "@/shared/mocks/erp-data";
import type { UserRole } from "@/shared/auth/permissions";

import type { InventoryStockStatus } from "../utils/inventoryStockStatus";

/** Ventana de "entradas / salidas 30 d": 30 × 24 h hacia atrás desde el momento de la consulta. */
export const INVENTORY_OVERVIEW_WINDOW_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Inicio de la ventana de 30 días (misma regla que la vista `inventory_overview`). */
export function inventoryOverviewWindowStart(now: Date = new Date()): Date {
  return new Date(now.getTime() - INVENTORY_OVERVIEW_WINDOW_DAYS * DAY_MS);
}

/**
 * Fila de `GET /api/inventory` (vista única de stock): el producto con su
 * categoría más las cifras del libro `stock_movements`.
 */
export type InventoryOverviewItem = ProductMock & {
  category?: CategoryMock;
  /** Σ de los movimientos positivos de los últimos 30 días. */
  entries30d: number;
  /** Σ del valor absoluto de los movimientos negativos de los últimos 30 días. */
  exits30d: number;
  /** Fecha del último movimiento del producto; `null` si nunca tuvo uno. */
  lastMovementAt: string | null;
  lastMovementType: StockMovementType | null;
  /**
   * Solo viaja si quien consulta es admin: `current_stock − Σ movimientos`
   * (`stock_reconciliation.diff`); `null` si el producto cuadra. Para cualquier
   * otro rol la propiedad no existe en la respuesta.
   */
  reconciliationDiff?: number | null;
  stockStatus: InventoryStockStatus;
};

/** Quién consulta el listado: decide si viaja `reconciliationDiff`. */
export type ListInventoryOptions = {
  role?: UserRole;
};

export function canSeeInventoryReconciliation(role: UserRole | undefined): boolean {
  return role === "admin";
}
