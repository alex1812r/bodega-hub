import { parsePagination, type PaginatedList } from "@/lib/api/pagination";
import { throwIfSupabaseError } from "@/lib/supabase/errors";
import { isRangeNotSatisfiable, listCountOptions } from "@/modules/products/services/listRange";

type PaginatedQueryResult<TRow> = {
  count: number | null;
  data: TRow[] | null;
  error: unknown;
};

/** Opciones de `select` de una lista: `listCountOptions(true)` es la consulta que solo cuenta. */
export { listCountOptions };

type ListPageQueryResult<TRow> = PaginatedQueryResult<TRow> & { status?: number };

/**
 * Ejecuta la página de una lista (`count: "exact"` + `.range()`). Una página que
 * empieza más allá del total (PostgREST 416 / `PGRST103`) no es un error: se
 * cuenta con los mismos filtros (`count`, una consulta `head: true`) y se
 * responde sin filas y con el total real, igual que `paginateList` en el mock.
 *
 * `count` SOLO se ejecuta en ese caso: el camino normal hace una única consulta.
 * Cualquier otro error se devuelve tal cual, para que el servicio lo trate como
 * siempre (`throwIfSupabaseError` / `toPaginatedList`).
 */
export async function fetchListPage<TRow>(input: {
  count: () => PromiseLike<{ count: number | null; error: unknown }>;
  rows: () => PromiseLike<ListPageQueryResult<TRow>>;
}): Promise<PaginatedQueryResult<TRow>> {
  const page = await input.rows();

  const outOfRange =
    typeof page.error === "object" &&
    page.error !== null &&
    isRangeNotSatisfiable(page.error, page.status);

  if (!outOfRange) {
    return { count: page.count, data: page.data, error: page.error };
  }

  const recount = await input.count();

  throwIfSupabaseError(recount.error);

  return { count: recount.count ?? 0, data: [], error: null };
}

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
