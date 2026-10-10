"use client";

import { useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { apiFetch } from "@/shared/api/apiFetch";
import { useDebouncedValue } from "@/shared/hooks/useDebouncedValue";

import {
  isGlobalSearchQueryTooShort,
  normalizeGlobalSearchQuery,
} from "../services/searchQuery";
import type { GlobalSearchResults } from "../types";

/** Espera desde la última tecla antes de consultar. */
export const GLOBAL_SEARCH_DEBOUNCE_MS = 250;

export const globalSearchQueryKeys = {
  all: ["global-search"] as const,
  term: (term: string) => [...globalSearchQueryKeys.all, term] as const,
};

export type UseGlobalSearchResult = {
  /** Consulta el término actual ya, sin esperar el resto del debounce (Enter). */
  flush: () => void;
  /** La consulta del término actual falló. */
  isError: boolean;
  /** Hay consulta pendiente para el término actual (debounce incluido). */
  isLoading: boolean;
  /** El término no llega al mínimo: no se consulta. */
  isTooShort: boolean;
  /** Resultados del término actual; `undefined` mientras no hayan llegado. */
  results: GlobalSearchResults | undefined;
  /** El texto tal como se busca: recortado y con espacios simples. */
  term: string;
};

/**
 * Búsqueda global del header contra `GET /api/search`. Consulta con debounce, no
 * consulta por debajo del mínimo y cancela la petición anterior al cambiar el
 * término (React Query aborta con `signal` la consulta que deja de observarse).
 * Nunca entrega resultados de un término distinto al que hay escrito.
 */
export function useGlobalSearch(
  input: string,
  debounceMs = GLOBAL_SEARCH_DEBOUNCE_MS,
): UseGlobalSearchResult {
  const term = normalizeGlobalSearchQuery(input);
  const debouncedTerm = useDebouncedValue(term, debounceMs);
  const [flushedTerm, setFlushedTerm] = useState<string | null>(null);
  const requestedTerm = flushedTerm === term ? term : debouncedTerm;
  const isTooShort = isGlobalSearchQueryTooShort(term);
  const isCurrent = requestedTerm === term;

  const query = useQuery({
    enabled: !isGlobalSearchQueryTooShort(requestedTerm),
    queryFn: ({ signal }) =>
      apiFetch<GlobalSearchResults>("/api/search", { query: { q: requestedTerm }, signal }),
    queryKey: globalSearchQueryKeys.term(requestedTerm),
    retry: false,
    staleTime: 30_000,
  });

  const flush = useCallback(() => setFlushedTerm(term), [term]);

  return {
    flush,
    isError: !isTooShort && isCurrent && query.isError,
    isLoading: !isTooShort && (!isCurrent || query.isPending),
    isTooShort,
    results: !isTooShort && isCurrent && query.isSuccess ? query.data : undefined,
    term,
  };
}
