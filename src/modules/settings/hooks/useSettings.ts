"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { PaginatedList, PaginationParams } from "@/lib/api/pagination";
import { authQueryKeys } from "@/modules/auth/hooks/useCurrentUser";
import type { AdminCanSellState } from "@/modules/settings/services/adminCanSell";
import type { CashCloseSettings } from "@/modules/settings/services/cashCloseSettings.schemas";
import { apiFetch } from "@/shared/api/apiFetch";
import type {
  AppSettingsMock,
  PricingSettingsMock,
  UserProfileMock,
} from "@/shared/mocks/erp-data";
import type { StoreUserRole } from "@/shared/auth/permissions";

/**
 * Configuración de la tienda tal como la devuelve `/api/settings`:
 * `cashCloseDiffAlertVes` es el faltante en Bs (≥ 0, por defecto 0) que el
 * cierre de caja debe SUPERAR para pedir confirmación explícita.
 */
export type AppSettings = AppSettingsMock & CashCloseSettings;
export type { CashCloseSettings };
/**
 * `pricing` se envía completo (umbrales y chips); `defaultTaxRateId` debe ser una
 * alícuota activa de la tienda; `cashCloseDiffAlertVes` es un monto en Bs ≥ 0.
 */
export type SettingsInput = Partial<AppSettings>;
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
  adminCanSell: () => [...settingsQueryKeys.all, "admin-can-sell"] as const,
  all: ["settings"] as const,
  cashClose: () => [...settingsQueryKeys.all, "cash-close"] as const,
  detail: () => [...settingsQueryKeys.all, "detail"] as const,
  paymentMethods: () => [...settingsQueryKeys.all, "payment-methods"] as const,
  pricing: () => [...settingsQueryKeys.all, "pricing"] as const,
  users: () => [...settingsQueryKeys.all, "users"] as const,
};

export function useSettings() {
  return useQuery({
    queryKey: settingsQueryKeys.detail(),
    queryFn: () => apiFetch<AppSettings>("/api/settings"),
  });
}

/**
 * Umbral de faltante al cerrar caja para quien opera o ve la caja
 * (`GET /api/settings/cash-close`; el cajero no tiene `settings.view`). Mientras
 * carga, o si falla, quien lo use debe tratarlo como 0: cualquier faltante confirma.
 */
export function useCashCloseSettings() {
  return useQuery({
    queryKey: settingsQueryKeys.cashClose(),
    queryFn: () => apiFetch<CashCloseSettings>("/api/settings/cash-close"),
    staleTime: 60_000,
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
      apiFetch<AppSettings>("/api/settings", {
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
      queryClient.setQueryData<CashCloseSettings>(settingsQueryKeys.cashClose(), {
        cashCloseDiffAlertVes: settings.cashCloseDiffAlertVes,
      });
      void queryClient.invalidateQueries({
        queryKey: settingsQueryKeys.cashClose(),
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

export type { AdminCanSellState };

/**
 * «El administrador puede vender» (`GET /api/settings/admin-can-sell`, permiso
 * `users.manage`): si todos los administradores activos pueden vender y operar
 * caja, y cuáles son.
 */
export function useAdminCanSell(enabled = true) {
  return useQuery({
    enabled,
    queryKey: settingsQueryKeys.adminCanSell(),
    queryFn: () => apiFetch<AdminCanSellState>("/api/settings/admin-can-sell"),
  });
}

/**
 * Concede o retira la venta a los administradores de la tienda. Al guardar se
 * refresca el perfil propio: el menú («Ventas → POS», «Mi caja») sale de ahí.
 */
export function useSetAdminCanSell() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (enabled: boolean) =>
      apiFetch<AdminCanSellState>("/api/settings/admin-can-sell", {
        body: { enabled },
        method: "PUT",
      }),
    onSuccess: (state) => {
      queryClient.setQueryData(settingsQueryKeys.adminCanSell(), state);
      void queryClient.invalidateQueries({ queryKey: settingsQueryKeys.users() });
      void queryClient.invalidateQueries({ queryKey: authQueryKeys.me() });
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
      // Un cambio de rol o de estado mueve quiénes son los administradores activos.
      void queryClient.invalidateQueries({
        queryKey: settingsQueryKeys.adminCanSell(),
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
