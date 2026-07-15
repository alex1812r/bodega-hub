import { parseSort, sortItems, type SortOrder } from "@/lib/api/sorting";

import type { SupplierProduct } from "../types/supplierProducts";

export const SUPPLIER_PRODUCT_SORT_COLUMNS = [
  "product",
  "sku",
  "supplierSku",
  "lastCostRef",
  "packCostRef",
  "updatedAt",
  "isActive",
] as const;

export type SupplierProductSortBy = (typeof SUPPLIER_PRODUCT_SORT_COLUMNS)[number];

export const SUPPLIER_PRODUCT_SORT_CONFIG = {
  defaultSortBy: "updatedAt" as const,
  defaultSortOrder: "desc" as const,
  whitelist: SUPPLIER_PRODUCT_SORT_COLUMNS,
};

export function parseSupplierProductSort(searchParams: URLSearchParams): {
  sortBy: SupplierProductSortBy;
  sortOrder: SortOrder;
} {
  const parsed = parseSort(searchParams, SUPPLIER_PRODUCT_SORT_CONFIG);

  return {
    sortBy: parsed.sortBy as SupplierProductSortBy,
    sortOrder: parsed.sortOrder,
  };
}

type SupplierProductSortQuery = {
  order: (
    column: string,
    options?: { ascending?: boolean; foreignTable?: string; referencedTable?: string },
  ) => SupplierProductSortQuery;
};

export function applySupplierProductSort<TQuery extends SupplierProductSortQuery>(
  query: TQuery,
  searchParams: URLSearchParams,
): TQuery {
  const { sortBy, sortOrder } = parseSupplierProductSort(searchParams);
  const ascending = sortOrder === "asc";

  switch (sortBy) {
    case "product":
      return query.order("name", { ascending, referencedTable: "products" }) as TQuery;
    case "sku":
      return query.order("sku", { ascending, referencedTable: "products" }) as TQuery;
    case "supplierSku":
      return query.order("supplier_sku", { ascending }) as TQuery;
    case "lastCostRef":
      return query.order("last_cost_ref", { ascending }) as TQuery;
    case "packCostRef":
      return query
        .order("last_pack_cost_ref", { ascending })
        .order("last_cost_ref", { ascending }) as TQuery;
    case "isActive":
      return query.order("is_active", { ascending }) as TQuery;
    case "updatedAt":
    default:
      return query.order("updated_at", { ascending }) as TQuery;
  }
}

function resolvePackCostSortValue(item: SupplierProduct): number | null {
  const defaultPackUnit =
    item.defaultPackUnit ??
    item.packUnits?.find((packUnit) => packUnit.isDefault && packUnit.isActive) ??
    item.packUnits?.find((packUnit) => packUnit.isActive);

  if (!defaultPackUnit || defaultPackUnit.unitsPerPack <= 1) {
    return null;
  }

  if (item.lastPackCostRef != null) {
    return item.lastPackCostRef;
  }

  return Number(((item.lastCostRef ?? 0) * defaultPackUnit.unitsPerPack).toFixed(2));
}

export function sortSupplierProductItems<T extends SupplierProduct>(
  items: T[],
  sortBy: SupplierProductSortBy,
  sortOrder: SortOrder,
): T[] {
  switch (sortBy) {
    case "product":
      return sortItems(items, (item) => item.product?.name ?? "", sortOrder);
    case "sku":
      return sortItems(items, (item) => item.product?.sku ?? "", sortOrder);
    case "supplierSku":
      return sortItems(items, (item) => item.supplierSku ?? "", sortOrder);
    case "lastCostRef":
      return sortItems(items, (item) => item.lastCostRef ?? 0, sortOrder);
    case "packCostRef":
      return sortItems(items, (item) => resolvePackCostSortValue(item), sortOrder);
    case "isActive":
      return sortItems(items, (item) => item.isActive, sortOrder);
    case "updatedAt":
    default:
      return sortItems(items, (item) => item.updatedAt ?? "", sortOrder);
  }
}
