import { parseSort, sortItems, type SortOrder } from "@/lib/api/sorting";
import type { CategoryMock, ProductMock } from "@/shared/mocks/erp-data";

export const PRODUCT_SORT_COLUMNS = [
  "sku",
  "name",
  "category",
  "currentCostRef",
  "salePriceRef",
  "currentStock",
  "status",
] as const;

export type ProductSortBy = (typeof PRODUCT_SORT_COLUMNS)[number];

export const PRODUCT_SORT_CONFIG = {
  defaultSortBy: "name" as const,
  whitelist: PRODUCT_SORT_COLUMNS,
};

export function parseProductSort(searchParams: URLSearchParams): {
  sortBy: ProductSortBy;
  sortOrder: SortOrder;
} {
  const parsed = parseSort(searchParams, PRODUCT_SORT_CONFIG);

  return {
    sortBy: parsed.sortBy as ProductSortBy,
    sortOrder: parsed.sortOrder,
  };
}

type ProductSortQuery = {
  order: (
    column: string,
    options?: { ascending?: boolean; referencedTable?: string },
  ) => ProductSortQuery;
};

export function applyProductSort<TQuery extends ProductSortQuery>(
  query: TQuery,
  searchParams: URLSearchParams,
): TQuery {
  const { sortBy, sortOrder } = parseProductSort(searchParams);
  const ascending = sortOrder === "asc";

  switch (sortBy) {
    case "sku":
      return query.order("sku", { ascending }) as TQuery;
    case "category":
      return query.order("name", { ascending, referencedTable: "categories" }) as TQuery;
    case "currentCostRef":
      return query.order("current_cost_ref", { ascending }) as TQuery;
    case "salePriceRef":
      return query.order("sale_price_ref", { ascending }) as TQuery;
    case "currentStock":
      return query.order("current_stock", { ascending }) as TQuery;
    case "status":
      return query.order("is_active", { ascending }) as TQuery;
    case "name":
    default:
      return query.order("name", { ascending }) as TQuery;
  }
}

export type ProductWithOptionalCategory = ProductMock & {
  category?: CategoryMock;
};

export function sortProductItems<T extends ProductWithOptionalCategory>(
  items: T[],
  sortBy: ProductSortBy,
  sortOrder: SortOrder,
): T[] {
  switch (sortBy) {
    case "sku":
      return sortItems(items, (item) => item.sku, sortOrder);
    case "category":
      return sortItems(items, (item) => item.category?.name ?? "", sortOrder);
    case "currentCostRef":
      return sortItems(items, (item) => item.currentCostRef, sortOrder);
    case "salePriceRef":
      return sortItems(items, (item) => item.salePriceRef, sortOrder);
    case "currentStock":
      return sortItems(items, (item) => item.currentStock, sortOrder);
    case "status":
      return sortItems(items, (item) => item.isActive, sortOrder);
    case "name":
    default:
      return sortItems(items, (item) => item.name, sortOrder);
  }
}
