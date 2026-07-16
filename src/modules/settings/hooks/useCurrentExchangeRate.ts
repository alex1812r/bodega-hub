"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  DEFAULT_PAGE_LIMIT,
  type PaginatedList,
  type PaginationParams,
} from "@/lib/api/pagination";
import { apiFetch } from "@/shared/api/apiFetch";
import type { ExchangeRateMock } from "@/shared/mocks/erp-data";

export type ExchangeRateFilters = PaginationParams & {
  from?: string;
  to?: string;
};

export type ExchangeRateInput = {
  rateVes: number;
  source?: string;
};

export const exchangeRateQueryKeys = {
  all: ["exchange-rates"] as const,
  current: () => [...exchangeRateQueryKeys.all, "current"] as const,
  list: (filters: ExchangeRateFilters = {}) =>
    [...exchangeRateQueryKeys.all, "list", filters] as const,
};

export function useExchangeRates(filters: ExchangeRateFilters = {}) {
  return useQuery({
    queryKey: exchangeRateQueryKeys.list(filters),
    queryFn: () =>
      apiFetch<PaginatedList<ExchangeRateMock>>("/api/exchange-rates", {
        query: filters,
      }),
  });
}

export function useCurrentExchangeRate(options?: {
  enabled?: boolean;
  path?: string;
}) {
  const path = options?.path ?? "/api/exchange-rates/current";

  return useQuery({
    enabled: options?.enabled ?? true,
    queryKey: [...exchangeRateQueryKeys.current(), path] as const,
    queryFn: () => apiFetch<ExchangeRateMock>(path),
  });
}

export function useCreateExchangeRate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: ExchangeRateInput) =>
      apiFetch<ExchangeRateMock>("/api/exchange-rates", {
        body: input,
        method: "POST",
      }),
    onSuccess: (exchangeRate) => {
      queryClient.setQueryData(exchangeRateQueryKeys.current(), exchangeRate);
      queryClient.setQueryData<PaginatedList<ExchangeRateMock>>(
        exchangeRateQueryKeys.list(),
        (page) =>
          page
            ? {
                ...page,
                items: [exchangeRate, ...page.items],
                total: page.total + 1,
              }
            : {
                items: [exchangeRate],
                limit: DEFAULT_PAGE_LIMIT,
                skip: 0,
                total: 1,
              },
      );
      void queryClient.invalidateQueries({
        queryKey: exchangeRateQueryKeys.all,
        refetchType: "none",
      });
    },
  });
}
