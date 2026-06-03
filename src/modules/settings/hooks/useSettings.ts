"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { PaginatedList, PaginationParams } from "@/lib/api/pagination";
import { apiFetch } from "@/shared/api/apiFetch";
import type { AppSettingsMock, UserProfileMock } from "@/shared/mocks/erp-data";

export type SettingsInput = Partial<AppSettingsMock>;
export type UserUpdateInput = Partial<
  Pick<
    UserProfileMock,
    "deniedPermissions" | "grantedPermissions" | "isActive" | "name" | "role"
  >
>;

export const settingsQueryKeys = {
  all: ["settings"] as const,
  detail: () => [...settingsQueryKeys.all, "detail"] as const,
  users: () => [...settingsQueryKeys.all, "users"] as const,
};

export function useSettings() {
  return useQuery({
    queryKey: settingsQueryKeys.detail(),
    queryFn: () => apiFetch<AppSettingsMock>("/api/settings"),
  });
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: SettingsInput) =>
      apiFetch<AppSettingsMock>("/api/settings", {
        body: input,
        method: "PATCH",
      }),
    onSuccess: (settings) => {
      queryClient.setQueryData(settingsQueryKeys.detail(), settings);
      void queryClient.invalidateQueries({
        queryKey: settingsQueryKeys.detail(),
        refetchType: "none",
      });
    },
  });
}

export type UsersFilters = PaginationParams;

export function useUsers(filters: UsersFilters = {}) {
  return useQuery({
    queryKey: [...settingsQueryKeys.users(), filters] as const,
    queryFn: () =>
      apiFetch<PaginatedList<UserProfileMock>>("/api/users", {
        query: filters,
      }),
  });
}

export function useUpdateUser(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UserUpdateInput) =>
      apiFetch<UserProfileMock>(`/api/users/${id}`, {
        body: input,
        method: "PATCH",
      }),
    onSuccess: (updatedUser) => {
      queryClient.setQueryData<PaginatedList<UserProfileMock>>(
        settingsQueryKeys.users(),
        (page) =>
          page
            ? {
                ...page,
                items: page.items.map((user) =>
                  user.id === updatedUser.id ? updatedUser : user,
                ),
              }
            : page,
      );
      void queryClient.invalidateQueries({
        queryKey: settingsQueryKeys.users(),
        refetchType: "none",
      });
    },
  });
}
