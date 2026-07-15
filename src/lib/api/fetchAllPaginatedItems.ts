import { apiFetch } from "@/shared/api/apiFetch";

import { MAX_PAGE_LIMIT, type PaginatedList } from "./pagination";

type QueryValue = boolean | null | number | string | undefined;

export async function fetchAllPaginatedItems<T>(
  path: string,
  query: Record<string, QueryValue> = {},
  pageSize = MAX_PAGE_LIMIT,
): Promise<T[]> {
  const items: T[] = [];
  let skip = 0;
  let total = Number.POSITIVE_INFINITY;

  while (skip < total) {
    const page = await apiFetch<PaginatedList<T>>(path, {
      query: {
        ...query,
        limit: pageSize,
        skip,
      },
    });

    items.push(...page.items);
    total = page.total;
    skip += page.limit;

    if (page.items.length === 0) {
      break;
    }
  }

  return items;
}
