"use client";

import { useQuery } from "@tanstack/react-query";

import type { PaymentImpact, PaymentImpactAction } from "@/modules/payments/services/paymentImpact";
import { apiFetch } from "@/shared/api/apiFetch";
import { impactQueryKey, impactQueryOptions } from "@/shared/impact/impactQuery";

export type UsePaymentImpactOptions = {
  /** Hoy solo existe `cancel`, que es el valor por defecto. */
  action?: PaymentImpactAction;
  /** `true` solo mientras el modal de confirmación está abierto. */
  enabled: boolean;
  paymentId?: string;
};

/**
 * Efecto de anular un pago (`GET /api/payments/{id}/impact`), para el modal de
 * confirmación. Solo pide mientras `enabled` (modal abierto) y no guarda
 * caché: cada apertura vuelve a calcular el efecto. Mientras `isPending` o con
 * `isError`, el modal no debe dejar confirmar.
 */
export function usePaymentImpact({
  action = "cancel",
  enabled,
  paymentId,
}: UsePaymentImpactOptions) {
  return useQuery({
    ...impactQueryOptions,
    enabled: enabled && Boolean(paymentId),
    queryFn: () =>
      apiFetch<PaymentImpact>(`/api/payments/${paymentId}/impact`, {
        query: { action },
      }),
    queryKey: impactQueryKey("payments", paymentId ?? "", action),
  });
}
