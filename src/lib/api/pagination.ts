export const DEFAULT_PAGE_LIMIT = 10;
export const MIN_PAGE_LIMIT = 10;
export const MAX_PAGE_LIMIT = 100;

/** Query params for list endpoints and list hooks (see products-list for reference wiring). */
export type PaginationParams = { skip?: number; limit?: number };

export type PaginatedList<T> = {
  items: T[];
  limit: number;
  skip: number;
  total: number;
};

export function parsePagination(searchParams: URLSearchParams) {
  const skip = Math.max(0, Number.parseInt(searchParams.get("skip") ?? "0", 10) || 0);
  const parsedLimit = Number.parseInt(searchParams.get("limit") ?? String(DEFAULT_PAGE_LIMIT), 10);
  const limit = Math.max(
    MIN_PAGE_LIMIT,
    Math.min(MAX_PAGE_LIMIT, Number.isFinite(parsedLimit) ? parsedLimit : DEFAULT_PAGE_LIMIT),
  );

  return { limit, skip };
}

export function paginateList<T>(items: T[], searchParams: URLSearchParams): PaginatedList<T> {
  const { limit, skip } = parsePagination(searchParams);

  return {
    items: items.slice(skip, skip + limit),
    limit,
    skip,
    total: items.length,
  };
}

export function getPaginatedItems<T>(data: PaginatedList<T> | null | undefined): T[] {
  return data?.items ?? [];
}
