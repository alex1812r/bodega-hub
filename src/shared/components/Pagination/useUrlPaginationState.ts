"use client";

import { useCallback } from "react";

import { getCurrentPage, getSkipForPage } from "./pagination-utils";

/** Lo mínimo que necesita de `useUrlListState`: `page` (base 1) y `limit` en el schema. */
export type UrlPaginationSource = {
  state: { page: number; limit: number };
  setState: (patch: { page?: number; limit?: number }) => void;
};

/**
 * Misma forma que `usePaginationState` (`skip`, `limit`, `setSkip`, `setLimit`),
 * pero leyendo y escribiendo `page`/`limit` en la URL a través de
 * `useUrlListState`. No lleva `resetDeps`: el hook de lista ya devuelve la
 * página a 1 cuando cambia cualquier filtro, la búsqueda, el orden o el tamaño.
 *
 * Migración de una lista (DET-06):
 * @example
 * // Antes
 * const { limit, setLimit, setSkip, skip } = usePaginationState([search, status, sortBy, sortOrder]);
 * // Después (el schema declara `page: listParams.page()` y `limit: listParams.limit()`)
 * const list = useUrlListState(productsListSchema);
 * const { limit, setLimit, setSkip, skip } = useUrlPaginationState(list);
 */
export function useUrlPaginationState(listState: UrlPaginationSource) {
  const { setState } = listState;
  const { limit, page } = listState.state;

  const setSkip = useCallback(
    (skip: number) => setState({ page: getCurrentPage(Math.max(0, skip), limit) }),
    [limit, setState],
  );
  const setLimit = useCallback((nextLimit: number) => setState({ limit: nextLimit }), [setState]);

  return { limit, setLimit, setSkip, skip: getSkipForPage(page, limit) };
}
