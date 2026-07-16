"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { PaginatedList, PaginationParams } from "@/lib/api/pagination";
import { apiFetch } from "@/shared/api/apiFetch";

import type { CreateStoreInput, PlatformStore, PlatformStoreDetail, UpdateStoreInput } from "../types/stores";

export type StoresFilters = PaginationParams & { search?: string; status?: "active" | "paused" };

export const storesQueryKeys = {
  all: ["platform", "stores"] as const,
  detail: (id: string) => [...storesQueryKeys.all, "detail", id] as const,
  list: (filters: StoresFilters = {}) => [...storesQueryKeys.all, "list", filters] as const,
};

export function useStoresList(filters: StoresFilters = {}) {
  return useQuery({
    queryKey: storesQueryKeys.list(filters),
    queryFn: () => apiFetch<PaginatedList<PlatformStore>>("/api/platform/stores", { query: filters }),
  });
}

export function useStoreDetail(id: string) {
  return useQuery({
    enabled: Boolean(id),
    queryKey: storesQueryKeys.detail(id),
    queryFn: () => apiFetch<PlatformStoreDetail>(`/api/platform/stores/${id}`),
  });
}

export function useCreateStore() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateStoreInput) => apiFetch<PlatformStoreDetail>("/api/platform/stores", { body: input, method: "POST" }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: storesQueryKeys.all }),
  });
}

export function useUpdateStore(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateStoreInput) =>
      apiFetch<PlatformStoreDetail>(`/api/platform/stores/${id}`, {
        body: input,
        method: "PATCH",
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: storesQueryKeys.all }),
  });
}

export function usePatchStore() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateStoreInput }) =>
      apiFetch<PlatformStoreDetail>(`/api/platform/stores/${id}`, {
        body: input,
        method: "PATCH",
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: storesQueryKeys.all }),
  });
}
