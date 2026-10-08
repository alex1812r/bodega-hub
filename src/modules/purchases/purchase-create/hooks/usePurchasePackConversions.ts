"use client";

import { useQuery } from "@tanstack/react-query";

import {
  inventoryQueryKeys,
  type PackConversionListItem,
} from "@/modules/inventory/hooks/useInventory";
import { apiFetch } from "@/shared/api/apiFetch";

/**
 * Recetas de apertura de la tienda, para «Desarmar al recibir». Misma consulta y misma
 * caché que `usePackConversions`, pero solo se pide con `enabled`: a un rol sin
 * `inventory.view` la petición le respondería 403, y sin recetas ninguna línea
 * ofrece el chip.
 */
export function usePurchasePackConversions(enabled: boolean) {
  return useQuery({
    enabled,
    queryFn: () => apiFetch<PackConversionListItem[]>("/api/inventory/pack-conversions"),
    queryKey: inventoryQueryKeys.packConversions(),
  });
}
