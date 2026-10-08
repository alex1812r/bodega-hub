"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { PaginatedList, PaginationParams } from "@/lib/api/pagination";
import { apiFetch } from "@/shared/api/apiFetch";
import type {
  AppSettingsMock,
  PricingSettingsMock,
  UserProfileMock,
} from "@/shared/mocks/erp-data";
import type { StoreUserRole } from "@/shared/auth/permissions";

/**
 * `pricing` se envía completo (umbrales y chips); `defaultTaxRateId` debe ser una
 * alícuota activa de la tienda.
 */
export type SettingsInput = Partial<AppSettingsMock>;
/** Semáforo de ganancia y chips de % de la tienda. */
export type PricingSettings = PricingSettingsMock;
export type UserUpdateInput = Partial<
  Pick<
    UserProfileMock,
    "deniedPermissions" | "grantedPermissions" | "isActive" | "name" | "role"
  >
>;
export type CreateUserInput = {
  email: string;
  fullName: string;
  password: string;
  role: StoreUserRole;
};

export const settingsQueryKeys = {
  all: ["settings"] as const,
  detail: () => [...settingsQueryKeys.all, "detail"] as const,
  paymentMethods: () => [...settingsQueryKeys.all, "payment-methods"] as const,
  pricing: () => [...settingsQueryKeys.all, "pricing"] as const,
  users: () => [...settingsQueryKeys.all, "users"] as const,
};

export function useSettings() {
  return useQuery({
    queryKey: settingsQueryKeys.detail(),
    queryFn: () => apiFetch<AppSettingsMock>("/api/settings"),
  });
}

export function useEnabledPaymentMethods() {
  return useQuery({
    queryKey: settingsQueryKeys.paymentMethods(),
    queryFn: async () => {
      const data = await apiFetch<{ enabledPaymentMethods: AppSettingsMock["enabledPaymentMethods"] }>(
        "/api/settings/payment-methods",
      );
      return data.enabledPaymentMethods;
    },
    staleTime: 60_000,
  });
}

/**
 * Semáforo de ganancia y chips de % de la tienda para quien ve productos
 * (`GET /api/settings/pricing`, permiso `products.view`; `useSettings` exige
 * `settings.view`). Mientras carga, `getProductPricingOptions(undefined)` da los
 * valores por defecto.
 */
export function usePricingSettings() {
  return useQuery({
    queryKey: settingsQueryKeys.pricing(),
    queryFn: () => apiFetch<PricingSettings>("/api/settings/pricing"),
    staleTime: 60_000,
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
      queryClient.setQueryData(
        settingsQueryKeys.paymentMethods(),
        settings.enabledPaymentMethods,
      );
      void queryClient.invalidateQueries({
        queryKey: settingsQueryKeys.detail(),
        refetchType: "none",
      });
      void queryClient.invalidateQueries({
        queryKey: settingsQueryKeys.paymentMethods(),
        refetchType: "none",
      });
      queryClient.setQueryData(settingsQueryKeys.pricing(), settings.pricing);
      void queryClient.invalidateQueries({
        queryKey: settingsQueryKeys.pricing(),
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
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: settingsQueryKeys.users(),
      });
    },
  });
}

export function useCreateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateUserInput) =>
      apiFetch<UserProfileMock>("/api/users", {
        body: input,
        method: "POST",
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: settingsQueryKeys.users(),
      });
    },
  });
}
