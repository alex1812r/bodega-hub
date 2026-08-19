import type { StockMovementType } from "@/shared/mocks/erp-data";
import { isUtcTimestampInCaracasDateRange } from "@/shared/utils/caracasBusinessDay";

export type InventoryMovementListFilters = {
  from?: string;
  productId?: string;
  to?: string;
  type?: StockMovementType;
};

export function parseInventoryMovementFilters(
  searchParams: URLSearchParams,
): InventoryMovementListFilters {
  const type = searchParams.get("type");

  return {
    from: searchParams.get("from") ?? undefined,
    productId: searchParams.get("productId") ?? undefined,
    to: searchParams.get("to") ?? undefined,
    type: (type || undefined) as StockMovementType | undefined,
  };
}

export function matchesInventoryMovementFilters(
  movement: { createdAt: string; productId: string; type: StockMovementType },
  filters: InventoryMovementListFilters,
) {
  if (filters.productId && movement.productId !== filters.productId) {
    return false;
  }

  if (filters.type && movement.type !== filters.type) {
    return false;
  }

  return isUtcTimestampInCaracasDateRange(movement.createdAt, filters.from, filters.to);
}
