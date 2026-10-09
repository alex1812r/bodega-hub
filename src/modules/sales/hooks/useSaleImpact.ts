"use client";

import { useQuery } from "@tanstack/react-query";

import type { SaleImpact, SaleImpactAction } from "@/modules/sales/services/saleImpact";
import { apiFetch } from "@/shared/api/apiFetch";
import { impactQueryKey, impactQueryOptions } from "@/shared/impact/impactQuery";

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
 * o con `isError`, el modal no debe dejar confirmar.
 */
export function useSaleImpact({ action, enabled, saleId }: UseSaleImpactOptions) {
  return useQuery({
    ...impactQueryOptions,
    enabled: enabled && Boolean(saleId),
    queryFn: () =>
      apiFetch<SaleImpact>(`/api/sales/${saleId}/impact`, {
        query: { action },
      }),
    queryKey: impactQueryKey("sales", saleId ?? "", action),
  });
}
