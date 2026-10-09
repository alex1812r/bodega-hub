"use client";

import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "@/shared/api/apiFetch";

import type { ProductKardex } from "../services/productKardex";
import { inventoryQueryKeys } from "./useInventory";

/** Cuelga de `inventoryQueryKeys.all`: se refresca con cada ajuste o conversión. */
export const productKardexQueryKey = (productId: string) =>
  [...inventoryQueryKeys.all, "kardex", productId] as const;

/** Kardex de un producto (`GET /api/inventory/kardex`). */
export function useProductKardex(productId: string, enabled = true) {
  return useQuery({
    enabled: enabled && Boolean(productId),
    queryKey: productKardexQueryKey(productId),
    queryFn: () => apiFetch<ProductKardex>("/api/inventory/kardex", { query: { productId } }),
  });
}
