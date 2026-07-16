"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { PaginatedList, PaginationParams } from "@/lib/api/pagination";
import { apiFetch } from "@/shared/api/apiFetch";

import type { CreateStoreAdminInput, PlatformUser, PlatformUserDetail } from "../types/users";

export type PlatformUsersFilters = PaginationParams & {
  role?: string;
  search?: string;
  storeId?: string;
};

export const platformUsersQueryKeys = {
  all: ["platform", "users"] as const,
  detail: (id: string) => [...platformUsersQueryKeys.all, "detail", id] as const,
  list: (filters: PlatformUsersFilters = {}) =>
    [...platformUsersQueryKeys.all, "list", filters] as const,
};

export function usePlatformUsersList(filters: PlatformUsersFilters = {}) {
  return useQuery({
    queryKey: platformUsersQueryKeys.list(filters),
    queryFn: () =>
      apiFetch<PaginatedList<PlatformUser>>("/api/platform/users", { query: filters }),
  });
}

export function usePlatformUserDetail(id: string) {
  return useQuery({
    enabled: Boolean(id),
    queryKey: platformUsersQueryKeys.detail(id),
    queryFn: () => apiFetch<PlatformUserDetail>(`/api/platform/users/${id}`),
  });
}

export function useCreateStoreAdmin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateStoreAdminInput) =>
      apiFetch<PlatformUserDetail>("/api/platform/users", { body: input, method: "POST" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: platformUsersQueryKeys.all });
      void queryClient.invalidateQueries({ queryKey: ["platform", "stores"] });
    },
  });
}
