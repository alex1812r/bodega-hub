"use client";

import { useQuery } from "@tanstack/react-query";

import type {
  PurchaseImpact,
  PurchaseImpactAction,
  PurchaseImpactDisassembleEntry,
} from "@/modules/purchases/services/purchaseImpact";
import {
  fetchImpact,
  hasImpactShape,
  impactQueryKey,
  impactQueryOptions,
} from "@/shared/impact/impactQuery";

/** Listas que los modales de compra recorren sin comprobar. */
const PURCHASE_IMPACT_ARRAYS = ["blockingProducts", "costs", "disassemble", "payments", "stock"];

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
 * dejar confirmar. Una respuesta que no llega a tiempo, sin la forma esperada o
 * de otra compra también acaba en `isError`.
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
      fetchImpact<PurchaseImpact>(`/api/purchases/${purchaseId}/impact`, {
        isExpected: (data) =>
          hasImpactShape(data, {
            action,
            arrays: PURCHASE_IMPACT_ARRAYS,
            documentId: purchaseId,
          }),
        query: list === null ? { action } : { action, disassemble: list },
      }),
    queryKey: [...impactQueryKey("purchases", purchaseId ?? "", action), list] as const,
  });
}
