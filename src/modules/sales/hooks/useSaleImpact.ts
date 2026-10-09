"use client";

import { useQuery } from "@tanstack/react-query";

import type { SaleImpact, SaleImpactAction } from "@/modules/sales/services/saleImpact";
import {
  fetchImpact,
  hasImpactShape,
  impactQueryKey,
  impactQueryOptions,
} from "@/shared/impact/impactQuery";

export type UseSaleImpactOptions = {
  action: SaleImpactAction;
  /** `true` solo mientras el modal de confirmación está abierto. */
  enabled: boolean;
  saleId?: string;
};

/**
 * Efecto de anular o devolver una venta (`GET /api/sales/{id}/impact`), para el
 * modal de confirmación. Solo pide mientras `enabled` (modal abierto) y no
 * guarda caché: cada apertura vuelve a calcular el efecto. Mientras `isPending`
 * o con `isError`, el modal no debe dejar confirmar. Una respuesta que no llega a
 * tiempo, sin la forma esperada o de otra venta también acaba en `isError`.
 */
export function useSaleImpact({ action, enabled, saleId }: UseSaleImpactOptions) {
  return useQuery({
    ...impactQueryOptions,
    enabled: enabled && Boolean(saleId),
    queryFn: () =>
      fetchImpact<SaleImpact>(`/api/sales/${saleId}/impact`, {
        isExpected: (data) =>
          hasImpactShape(data, { action, arrays: ["payments", "stock"], documentId: saleId }),
        query: { action },
      }),
    queryKey: impactQueryKey("sales", saleId ?? "", action),
  });
}
