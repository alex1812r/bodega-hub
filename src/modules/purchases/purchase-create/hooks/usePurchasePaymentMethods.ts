"use client";

import { useQuery } from "@tanstack/react-query";

import { settingsQueryKeys } from "@/modules/settings/hooks/useSettings";
import { apiFetch } from "@/shared/api/apiFetch";
import type { AppSettingsMock } from "@/shared/mocks/erp-data";

/**
 * Métodos de pago habilitados en la tienda, para "Pagar ahora". Misma consulta y
 * misma caché que `useEnabledPaymentMethods`, pero solo se pide con `enabled`:
 * un rol sin permisos de pagos (almacén) no ve la sección y la petición le
 * respondería 403.
 */
export function usePurchasePaymentMethods(enabled: boolean) {
  return useQuery({
    enabled,
    queryFn: async () => {
      const data = await apiFetch<{
        enabledPaymentMethods: AppSettingsMock["enabledPaymentMethods"];
      }>("/api/settings/payment-methods");

      return data.enabledPaymentMethods;
    },
    queryKey: settingsQueryKeys.paymentMethods(),
    staleTime: 60_000,
  });
}
