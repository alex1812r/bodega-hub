"use client";

import { useQuery } from "@tanstack/react-query";

import type { PaginatedList, PaginationParams } from "@/lib/api/pagination";
import { apiFetch } from "@/shared/api/apiFetch";

import { supplierProductsQueryKeys } from "./useSupplierProducts";

import type { SupplierProductPriceHistoryEntry } from "../types/supplierProducts";

export function useSupplierProductPriceHistory(
  id?: string,
  filters: PaginationParams = {},
) {
  return useQuery({
    enabled: Boolean(id),
    queryKey: supplierProductsQueryKeys.priceHistory(id ?? "", filters),
    queryFn: () =>
      apiFetch<PaginatedList<SupplierProductPriceHistoryEntry>>(
        `/api/supplier-products/${id}/price-history`,
        { query: filters },
      ),
  });
}
