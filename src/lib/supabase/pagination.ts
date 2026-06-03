import { parsePagination, type PaginatedList } from "@/lib/api/pagination";
import { throwIfSupabaseError } from "@/lib/supabase/errors";

type PaginatedQueryResult<TRow> = {
  count: number | null;
  data: TRow[] | null;
  error: unknown;
};

export async function toPaginatedList<TRow, TDto>(
  searchParams: URLSearchParams,
  queryResult: PaginatedQueryResult<TRow>,
  mapper: (row: TRow) => TDto,
): Promise<PaginatedList<TDto>> {
  throwIfSupabaseError(queryResult.error);

  const { limit, skip } = parsePagination(searchParams);

  return {
    items: (queryResult.data ?? []).map(mapper),
    limit,
    skip,
    total: queryResult.count ?? 0,
  };
}

export function getPaginationRange(searchParams: URLSearchParams) {
  const { limit, skip } = parsePagination(searchParams);

  return {
    limit,
    skip,
    to: skip + limit - 1,
  };
}
