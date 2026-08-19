"use client";

import { usePaginationState } from "@/shared/components/Pagination";

import { useProductSales } from "../../hooks/useProducts";

export function useProductSalesHistory(productId: string) {
  const pagination = usePaginationState([productId]);
  const query = useProductSales(productId, {
    limit: pagination.limit,
    skip: pagination.skip,
  });

  return {
    ...query,
    limit: pagination.limit,
    setLimit: pagination.setLimit,
    setSkip: pagination.setSkip,
    skip: pagination.skip,
  };
}
