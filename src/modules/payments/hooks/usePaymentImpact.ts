"use client";

import { useQuery } from "@tanstack/react-query";

import type { PaymentImpact, PaymentImpactAction } from "@/modules/payments/services/paymentImpact";
import {
  fetchImpact,
  hasImpactShape,
  impactQueryKey,
  impactQueryOptions,
  isImpactRecord,
} from "@/shared/impact/impactQuery";

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
 * `isError`, el modal no debe dejar confirmar. Una respuesta que no llega a tiempo,
 * sin la forma esperada o de otro pago también acaba en `isError`.
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
      fetchImpact<PaymentImpact>(`/api/payments/${paymentId}/impact`, {
        // `document` es la venta o la compra del pago: el pedido es `payment`.
        isExpected: (data) =>
          hasImpactShape(data, { action, arrays: ["effects"] }) &&
          typeof data.description === "string" &&
          isImpactRecord(data.payment) &&
          data.payment.id === paymentId,
        query: { action },
      }),
    queryKey: impactQueryKey("payments", paymentId ?? "", action),
  });
}
