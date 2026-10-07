"use client";

import { useCallback } from "react";

import { toggleSort, type SortOrder } from "@/lib/api/sorting";

/** Lo mínimo que necesita de `useUrlListState`: `sort` (columna) y `dir` en el schema. */
export type UrlSortSource<TSortBy extends string> = {
  state: { sort: TSortBy; dir: SortOrder };
  setState: (patch: { sort?: TSortBy; dir?: SortOrder }) => void;
};

/**
 * Misma forma que `useSortState` (`sortBy`, `sortOrder`, `handleSort`,
 * `setSortBy`, `setSortOrder`), pero leyendo y escribiendo `sort`/`dir` en la
 * URL a través de `useUrlListState`. Los defaults salen del schema, no de un
 * `config`. Una columna que el schema no permite se ignora (lo valida
 * `useUrlListState`), por eso `handleSort` acepta cualquier `string`.
 *
 * Migración de una lista (DET-06):
 * @example
 * // Antes
 * const { handleSort, sortBy, sortOrder } = useSortState({ defaultSortBy: "name" });
 * // Después (el schema declara `sort: listParams.sort(["name", "price"], "name")` y `dir: listParams.dir()`)
 * const list = useUrlListState(productsListSchema);
 * const { handleSort, sortBy, sortOrder } = useUrlSortState(list);
 */
export function useUrlSortState<TSortBy extends string>(listState: UrlSortSource<TSortBy>) {
  const { setState } = listState;
  const { dir: sortOrder, sort: sortBy } = listState.state;

  const setSortBy = useCallback(
    (column: string) => setState({ sort: column as TSortBy }),
    [setState],
  );
  const setSortOrder = useCallback((order: SortOrder) => setState({ dir: order }), [setState]);
  const handleSort = useCallback(
    (column: string) => {
      const next = toggleSort({ sortBy, sortOrder }, column);

      setState({ dir: next.sortOrder, sort: next.sortBy as TSortBy });
    },
    [setState, sortBy, sortOrder],
  );

  return { handleSort, setSortBy, setSortOrder, sortBy, sortOrder };
}
