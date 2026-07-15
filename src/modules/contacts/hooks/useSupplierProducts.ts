"use client";

import { useQuery } from "@tanstack/react-query";

import type { PaginatedList, PaginationParams } from "@/lib/api/pagination";
import type { SortOrder } from "@/lib/api/sorting";
import { apiFetch } from "@/shared/api/apiFetch";

import type { SupplierProduct } from "../types/supplierProducts";

export type SupplierProductsFilters = PaginationParams & {
  /** When false, includes inactive relations. Defaults to true (active only). */
  activeOnly?: boolean;
  isActive?: boolean | string;
  productId?: string;
  search?: string;
  sortBy?: string;
  sortOrder?: SortOrder;
  supplierId?: string;
};

export const supplierProductsQueryKeys = {
  all: ["supplier-products"] as const,
  byProduct: (productId: string, filters: SupplierProductsFilters = {}) =>
    [...supplierProductsQueryKeys.all, "product", productId, filters] as const,
  bySupplier: (supplierId: string, filters: SupplierProductsFilters = {}) =>
    [...supplierProductsQueryKeys.all, "supplier", supplierId, filters] as const,
  detail: (id: string) => [...supplierProductsQueryKeys.all, "detail", id] as const,
  list: (filters: SupplierProductsFilters = {}) =>
    [...supplierProductsQueryKeys.all, "list", filters] as const,
  priceHistory: (id: string, filters: PaginationParams = {}) =>
    [...supplierProductsQueryKeys.all, "price-history", id, filters] as const,
};

function resolveIsActiveFilter(filters: SupplierProductsFilters) {
  if (filters.isActive != null && filters.isActive !== "") {
    return String(filters.isActive);
  }

  return filters.activeOnly === false ? undefined : "true";
}

export function useSupplierProducts(
  supplierId?: string,
  filters: Omit<SupplierProductsFilters, "supplierId"> = {},
) {
  const { activeOnly, ...queryFilters } = filters;
  const resolvedIsActive = resolveIsActiveFilter({ ...filters, activeOnly });

  return useQuery({
    enabled: Boolean(supplierId),
    queryKey: supplierProductsQueryKeys.bySupplier(supplierId ?? "", {
      ...queryFilters,
      activeOnly: activeOnly ?? true,
    }),
    queryFn: () =>
      apiFetch<PaginatedList<SupplierProduct>>(`/api/suppliers/${supplierId}/products`, {
        query: {
          ...queryFilters,
          ...(resolvedIsActive ? { isActive: resolvedIsActive } : {}),
        },
      }),
  });
}

export function useProductSupplierProducts(
  productId?: string,
  filters: Omit<SupplierProductsFilters, "productId"> = {},
) {
  return useQuery({
    enabled: Boolean(productId),
    queryKey: supplierProductsQueryKeys.byProduct(productId ?? "", filters),
    queryFn: () =>
      apiFetch<PaginatedList<SupplierProduct>>(`/api/products/${productId}/suppliers`, {
        query: filters,
      }),
  });
}

export function useSupplierProduct(id?: string) {
  return useQuery({
    enabled: Boolean(id),
    queryKey: supplierProductsQueryKeys.detail(id ?? ""),
    queryFn: () => apiFetch<SupplierProduct>(`/api/supplier-products/${id}`),
  });
}
