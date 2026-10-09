"use client";

import { useQuery } from "@tanstack/react-query";

import type {
  PurchaseImpact,
  PurchaseImpactAction,
  PurchaseImpactDisassembleEntry,
} from "@/modules/purchases/services/purchaseImpact";
import { apiFetch } from "@/shared/api/apiFetch";
import { impactQueryKey, impactQueryOptions } from "@/shared/impact/impactQuery";

export type UsePurchaseImpactOptions = {
  action: PurchaseImpactAction;
  /**
   * Solo `receive`: la lista `disassemble` que el modal enviará en
   * `PATCH /receive` (`buildReceiveDisassembleRequest`). Sin ella el efecto es
   * el de las marcas guardadas con el pedido. Cambiarla vuelve a pedir el efecto.
   */
  disassemble?: readonly PurchaseImpactDisassembleEntry[];
  /** `true` solo mientras el modal de confirmación está abierto. */
  enabled: boolean;
  purchaseId?: string;
};

/**
 * Efecto de recibir, cancelar o devolver una compra
 * (`GET /api/purchases/{id}/impact`), para el modal de confirmación. Solo pide
 * mientras `enabled` (modal abierto) y no guarda caché: cada apertura vuelve a
 * calcular el efecto. Mientras `isPending` o con `isError`, el modal no debe
 * dejar confirmar.
 */
export function usePurchaseImpact({
  action,
  disassemble,
  enabled,
  purchaseId,
}: UsePurchaseImpactOptions) {
  const list = action === "receive" && disassemble ? JSON.stringify(disassemble) : null;

  return useQuery({
    ...impactQueryOptions,
    enabled: enabled && Boolean(purchaseId),
    queryFn: () =>
      apiFetch<PurchaseImpact>(`/api/purchases/${purchaseId}/impact`, {
        query: list === null ? { action } : { action, disassemble: list },
      }),
    queryKey: [...impactQueryKey("purchases", purchaseId ?? "", action), list] as const,
  });
}
