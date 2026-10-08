"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { PaginatedList, PaginationParams } from "@/lib/api/pagination";
import { apiFetch, ClientApiError } from "@/shared/api/apiFetch";

import type {
  ProductPriceHistoryEntry,
  ProductPriceReviewItem,
  RepriceProductResult,
  RepriceResult,
} from "../services/priceReview";
import { productsQueryKeys, type ProductWithCategory } from "./useProducts";

export type { ProductPriceReviewItem, RepriceProductResult, RepriceResult };

export type PriceReviewFilters = PaginationParams & {
  /** Solo los productos cuyo costo subió esta compra. */
  purchaseId?: string;
};

export type KeepProductPriceInput = {
  /**
   * Costo (REF) con el que se mostró la ganancia que el usuario acepta. Si el
   * producto ya cuesta otra cosa responde 409 y no se guarda nada.
   */
  expectedCostRef?: number;
  productId: string;
  /** Máx. 200 caracteres. Sin motivo se guarda "Precio mantenido". */
  reason?: string;
};

export type KeepProductPriceResult = {
  history: ProductPriceHistoryEntry;
  product: ProductWithCategory;
};

export type RepriceProductsInput = {
  /** % de ganancia sobre el costo (> 0 y ≤ 1000). */
  markupPct: number;
  /**
   * Productos con el costo (REF) que el usuario vio en la vista previa: si el
   * costo de uno ya es otro, su fila responde `COST_CHANGED` y no cambia.
   * Entre `items` y `productIds`, de 1 a 100 productos por llamada.
   */
  items?: { expectedCostRef: number; productId: string }[];
  /** Productos sin comprobación de costo: el precio sale del costo vigente. */
  productIds?: string[];
  /** Sin motivo se guarda "Reprecio al X %". */
  reason?: string;
};

// Bajo `productsQueryKeys.all`: cualquier cambio de producto o de precio las invalida.
export const priceReviewQueryKeys = {
  all: [...productsQueryKeys.all, "price-review"] as const,
  list: (filters: PriceReviewFilters = {}) =>
    [...priceReviewQueryKeys.all, "list", filters] as const,
  summary: () => [...priceReviewQueryKeys.all, "summary"] as const,
};

/** Cola "Por revisar": peor banda primero y, dentro de ella, la mayor caída de %. */
export function usePriceReview(filters: PriceReviewFilters = {}, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: priceReviewQueryKeys.list(filters),
    queryFn: () =>
      apiFetch<PaginatedList<ProductPriceReviewItem>>("/api/products/price-review", {
        query: filters,
      }),
    ...options,
  });
}

/** Cuántos productos hay en la cola (tarjeta del dashboard). */
export function usePriceReviewSummary(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: priceReviewQueryKeys.summary(),
    queryFn: () => apiFetch<{ total: number }>("/api/products/price-review/summary"),
    ...options,
  });
}

function isConflict(error: unknown) {
  return error instanceof ClientApiError && error.status === 409;
}

/** "Mantener precio": el producto sale de la cola sin cambiar su precio. */
export function useKeepProductPrice() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ expectedCostRef, productId, reason }: KeepProductPriceInput) =>
      apiFetch<KeepProductPriceResult>(`/api/products/${productId}/keep-price`, {
        body: { expectedCostRef, reason },
        method: "POST",
      }),
    onError: (error) => {
      // 409: el costo cambió mientras el usuario decidía. Se refrescan los datos
      // para que vea la ganancia real antes de volver a confirmar.
      if (isConflict(error)) {
        void queryClient.invalidateQueries({ queryKey: productsQueryKeys.all });
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: productsQueryKeys.all });
    },
  });
}

/**
 * Reprecio masivo. La respuesta trae un resultado por producto: un lote puede
 * terminar con productos actualizados y otros con error (`failed > 0`).
 */
export function useRepriceProducts() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: RepriceProductsInput) =>
      apiFetch<RepriceResult>("/api/products/price-review/reprice", {
        body: input,
        method: "POST",
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: productsQueryKeys.all });
    },
  });
}
