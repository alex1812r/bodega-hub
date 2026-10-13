"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { MAX_PAGE_LIMIT, type PaginatedList } from "@/lib/api/pagination";
import {
  fetchImpact,
  impactQueryOptions,
  ImpactUnavailableError,
  isImpactRecord,
} from "@/shared/impact";

import type { ProductPriceReviewItem } from "../../hooks/usePriceReview";
import type { ProductWithCategory } from "../../hooks/useProducts";

/**
 * Relectura de precio y costo al abrir una confirmación de precio (CAOS-04, CAOS-04b):
 * el «antes → después» se pinta con lo que el servidor dice en ese momento, no con la
 * lista o el detalle que se cargó antes. Como un impact: sin caché entre aperturas, con
 * el mismo tiempo máximo (`IMPACT_TIMEOUT_MS`) y una respuesta sin cifras numéricas
 * cuenta como fallo.
 */

/** Precio y costo de un producto recién leídos del servidor. */
export type FreshProductPricing = { currentCostRef: number; currentPriceRef: number };

export type FreshPricingStatus = "error" | "loading" | "ready";

/** Páginas de la cola que se leen como mucho para dar con los seleccionados. */
const MAX_REVIEW_PAGES = 10;

// Fuera de `productsQueryKeys.all`: guardar un precio no debe releer la confirmación abierta.
const FRESH_PRICING_KEY = "price-confirm";

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function hasPricing(value: unknown) {
  return (
    isImpactRecord(value) && isFiniteNumber(value.currentCostRef) && isFiniteNumber(value.salePriceRef)
  );
}

function isReviewPage(value: unknown) {
  return (
    isImpactRecord(value) &&
    isFiniteNumber(value.total) &&
    Array.isArray(value.items) &&
    value.items.every((item) => hasPricing(item) && typeof item.productId === "string")
  );
}

/** `GET /api/products/{id}` con tiempo máximo; rechaza si no trae precio y costo numéricos. */
export function fetchFreshProduct(productId: string) {
  return fetchImpact<ProductWithCategory>(`/api/products/${productId}`, { isExpected: hasPricing });
}

/**
 * Precio y costo actuales de los productos pedidos, leídos de la cola «Por revisar» por
 * páginas de `MAX_PAGE_LIMIT` (una petición salvo que la cola sea más larga). Los que no
 * aparecen ya no están en la cola.
 */
export async function fetchFreshReviewPricing(productIds: readonly string[]) {
  const wanted = new Set(productIds);
  const found = new Map<string, FreshProductPricing>();

  for (let page = 0; found.size < wanted.size; page += 1) {
    if (page === MAX_REVIEW_PAGES) {
      throw new ImpactUnavailableError();
    }

    const list = await fetchImpact<PaginatedList<ProductPriceReviewItem>>(
      "/api/products/price-review",
      {
        isExpected: isReviewPage,
        query: { limit: String(MAX_PAGE_LIMIT), skip: String(page * MAX_PAGE_LIMIT) },
      },
    );

    for (const item of list.items) {
      if (wanted.has(item.productId)) {
        found.set(item.productId, {
          currentCostRef: item.currentCostRef,
          currentPriceRef: item.salePriceRef,
        });
      }
    }

    if (list.items.length === 0 || (page + 1) * MAX_PAGE_LIMIT >= list.total) {
      break;
    }
  }

  return found;
}

/** Sube con cada apertura: ninguna confirmación reutiliza la lectura de otra. */
function useOpeningCount(open: boolean) {
  const [seen, setSeen] = useState({ count: 0, open });

  if (seen.open !== open) {
    setSeen({ count: open ? seen.count + 1 : seen.count, open });
  }

  return seen.count;
}

function getStatus(query: { data: unknown; isFetching: boolean }): FreshPricingStatus {
  if (query.data !== undefined) {
    return "ready";
  }

  return query.isFetching ? "loading" : "error";
}

/**
 * Relee el producto en cada apertura (`open`). Sin `fresh` (cargando o error) la
 * confirmación no debe dejar confirmar; `refetch` es su «Reintentar» y también sirve
 * tras un guardado rechazado (lo ya pintado sigue a la vista mientras llega).
 */
export function useFreshProductPricing(productId: string | undefined, open: boolean) {
  const opening = useOpeningCount(open);
  const query = useQuery({
    ...impactQueryOptions,
    enabled: open && Boolean(productId),
    queryFn: () => fetchFreshProduct(productId ?? ""),
    queryKey: [FRESH_PRICING_KEY, "product", productId, opening],
  });
  const fresh: FreshProductPricing | null = query.data
    ? { currentCostRef: query.data.currentCostRef, currentPriceRef: query.data.salePriceRef }
    : null;

  return { fresh, refetch: () => void query.refetch(), status: getStatus(query) };
}

/** Como `useFreshProductPricing`, para varios productos de la cola «Por revisar». */
export function useFreshReviewPricing(productIds: readonly string[], open: boolean) {
  const opening = useOpeningCount(open);
  const query = useQuery({
    ...impactQueryOptions,
    enabled: open && productIds.length > 0,
    queryFn: () => fetchFreshReviewPricing(productIds),
    queryKey: [FRESH_PRICING_KEY, "review", productIds.join(","), opening],
  });

  return { fresh: query.data ?? null, refetch: () => void query.refetch(), status: getStatus(query) };
}
