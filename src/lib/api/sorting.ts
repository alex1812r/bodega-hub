export type SortOrder = "asc" | "desc";

export type SortState = {
  sortBy: string;
  sortOrder: SortOrder;
};

export type SortConfig<TSortBy extends string = string> = {
  defaultSortBy: TSortBy;
  defaultSortOrder?: SortOrder;
  sortByParam?: string;
  sortOrderParam?: string;
  whitelist: readonly TSortBy[];
};

export function parseSortOrder(value: string | null, fallback: SortOrder = "asc"): SortOrder {
  if (value === "desc") return "desc";
  if (value === "asc") return "asc";
  return fallback;
}

export function parseSort<TSortBy extends string>(
  searchParams: URLSearchParams,
  config: SortConfig<TSortBy>,
): SortState {
  const sortByParam = config.sortByParam ?? "sortBy";
  const sortOrderParam = config.sortOrderParam ?? "sortOrder";
  const defaultSortOrder = config.defaultSortOrder ?? "asc";

  const rawSortBy = searchParams.get(sortByParam);
  const sortBy =
    rawSortBy && (config.whitelist as readonly string[]).includes(rawSortBy)
      ? rawSortBy
      : config.defaultSortBy;

  const sortOrder = parseSortOrder(searchParams.get(sortOrderParam), defaultSortOrder);

  return { sortBy, sortOrder };
}

export function toggleSort(current: SortState, column: string): SortState {
  if (current.sortBy !== column) {
    return { sortBy: column, sortOrder: "asc" };
  }

  return {
    sortBy: column,
    sortOrder: current.sortOrder === "asc" ? "desc" : "asc",
  };
}

export function compareSortValues(
  left: string | number | boolean | null | undefined,
  right: string | number | boolean | null | undefined,
): number {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;

  if (typeof left === "boolean" && typeof right === "boolean") {
    return Number(left) - Number(right);
  }

  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }

  return String(left).localeCompare(String(right), "es", { sensitivity: "base" });
}

export function sortItems<T>(
  items: T[],
  getValue: (item: T) => string | number | boolean | null | undefined,
  sortOrder: SortOrder,
): T[] {
  const direction = sortOrder === "asc" ? 1 : -1;

  return [...items].sort((left, right) => compareSortValues(getValue(left), getValue(right)) * direction);
}
