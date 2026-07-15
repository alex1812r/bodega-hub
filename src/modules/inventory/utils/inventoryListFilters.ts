import type { ProductMock } from "@/shared/mocks/erp-data";

import { matchesProductSearch } from "@/modules/products/services/productSearch";
import {
  getInventoryStockStatus,
  matchesStockStatusFilter,
  parseStockStatusFilter,
  type InventoryStockStatus,
} from "./inventoryStockStatus";

export type InventoryListQueryFilters = {
  categoryId?: string;
  lowStock?: boolean;
  maxPriceRef?: number;
  minPriceRef?: number;
  search?: string;
  stockStatus?: InventoryStockStatus[];
};

export function parseInventoryListFilters(
  searchParams: URLSearchParams,
): InventoryListQueryFilters {
  const minPriceRef = parseOptionalNumber(searchParams.get("minPriceRef"));
  const maxPriceRef = parseOptionalNumber(searchParams.get("maxPriceRef"));
  const stockStatus = parseStockStatusFilter(searchParams.get("stockStatus") ?? undefined);

  return {
    categoryId: searchParams.get("categoryId")?.trim() || undefined,
    lowStock: searchParams.get("lowStock") === "true" ? true : undefined,
    maxPriceRef,
    minPriceRef,
    search: searchParams.get("search")?.trim() || undefined,
    stockStatus,
  };
}

export function matchesInventoryListFilters(
  product: ProductMock,
  filters: InventoryListQueryFilters,
) {
  const search = filters.search?.toLowerCase();

  if (search && !matchesProductSearch(product, search)) {
    return false;
  }

  if (filters.categoryId && product.categoryId !== filters.categoryId) {
    return false;
  }

  if (filters.minPriceRef !== undefined && product.salePriceRef < filters.minPriceRef) {
    return false;
  }

  if (filters.maxPriceRef !== undefined && product.salePriceRef > filters.maxPriceRef) {
    return false;
  }

  if (filters.lowStock && getInventoryStockStatus(product) === "ok") {
    return false;
  }

  if (!matchesStockStatusFilter(product, filters.stockStatus)) {
    return false;
  }

  return product.isActive;
}

function parseOptionalNumber(value: string | null) {
  if (!value?.trim()) {
    return undefined;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : undefined;
}
