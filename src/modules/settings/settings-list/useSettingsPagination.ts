"use client";

import { useCallback, useEffect } from "react";

import { getCurrentPage, getSkipForPage, getTotalPages } from "@/shared/components/Pagination";
import { useUrlListState } from "@/shared/hooks/useUrlListState";

import { settingsRatesListSchema, settingsUsersListSchema } from "./settingsListParams";

/** Misma forma que `usePaginationState`, más la página (base 1) que hay en la URL. */
function usePagination(
  page: number,
  limit: number,
  setPage: (page: number) => void,
  setLimit: (limit: number) => void,
) {
  const setSkip = useCallback(
    (skip: number) => setPage(getCurrentPage(Math.max(0, skip), limit)),
    [limit, setPage],
  );

  return { limit, page, setLimit, setPage, setSkip, skip: getSkipForPage(page, limit) };
}

export type SettingsPagination = ReturnType<typeof usePagination>;

/** Página y tamaño de «Usuarios del negocio» en la URL (`usersPage`, `usersLimit`). */
export function useSettingsUsersPagination(): SettingsPagination {
  const { setState, state } = useUrlListState(settingsUsersListSchema, {
    pageField: "usersPage",
  });
  const setPage = useCallback((page: number) => setState({ usersPage: page }), [setState]);
  const setLimit = useCallback((limit: number) => setState({ usersLimit: limit }), [setState]);

  return usePagination(state.usersPage, state.usersLimit, setPage, setLimit);
}

/** Página y tamaño de «Historial de tasas» en la URL (`ratesPage`, `ratesLimit`). */
export function useSettingsRatesPagination(): SettingsPagination {
  const { setState, state } = useUrlListState(settingsRatesListSchema, {
    pageField: "ratesPage",
  });
  const setPage = useCallback((page: number) => setState({ ratesPage: page }), [setState]);
  const setLimit = useCallback((limit: number) => setState({ ratesLimit: limit }), [setState]);

  return usePagination(state.ratesPage, state.ratesLimit, setPage, setLimit);
}

type PagedQuery = {
  data?: { total: number } | null;
  isFetching: boolean;
  isSuccess: boolean;
};

/**
 * Una página más allá de la última (`?usersPage=9999`, o un enlace viejo) cae en
 * la última que existe, y la URL lo refleja.
 */
export function useLastValidPage({ limit, page, setPage }: SettingsPagination, query: PagedQuery) {
  const lastPage = getTotalPages(query.data?.total ?? 0, limit);
  const isPastLastPage = query.isSuccess && !query.isFetching && page > lastPage;

  useEffect(() => {
    if (isPastLastPage) {
      setPage(lastPage);
    }
  }, [isPastLastPage, lastPage, setPage]);
}
