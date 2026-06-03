"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { PaginatedList, PaginationParams } from "@/lib/api/pagination";
import { apiFetch } from "@/shared/api/apiFetch";
import type {
  CategoryMock,
  ProductMock,
  ProductPriceHistoryMock,
  SupplierProductMock,
} from "@/shared/mocks/erp-data";

export type ProductWithCategory = ProductMock & {
  category?: CategoryMock;
};

export type ProductsFilters = PaginationParams & {
  categoryId?: string;
  isActive?: boolean | string;
  search?: string;
};

export type ProductInput = {
  categoryId?: string;
  currentCostRef?: number;
  currentStock?: number;
  minStock?: number;
  name: string;
  salePriceRef: number;
  sku: string;
};

export type ProductUpdateInput = Partial<ProductInput> & {
  isActive?: boolean;
};

export type ProductPriceUpdateInput = {
  salePriceRef: number;
};

export type ProductPriceUpdateResult = {
  history: ProductPriceHistoryMock;
  product: ProductWithCategory;
};

export const productsQueryKeys = {
  all: ["products"] as const,
  categories: () => [...productsQueryKeys.all, "categories"] as const,
  detail: (id: string) => [...productsQueryKeys.all, "detail", id] as const,
  list: (filters: ProductsFilters = {}) =>
    [...productsQueryKeys.all, "list", filters] as const,
  priceHistory: (id: string) =>
    [...productsQueryKeys.all, "price-history", id] as const,
  suppliers: (id: string) => [...productsQueryKeys.all, "suppliers", id] as const,
};

export function useProducts(filters: ProductsFilters = {}) {
  return useQuery({
    queryKey: productsQueryKeys.list(filters),
    queryFn: () =>
      apiFetch<PaginatedList<ProductWithCategory>>("/api/products", {
        query: filters,
      }),
  });
}

export function useProduct(id: string) {
  return useQuery({
    enabled: Boolean(id),
    queryKey: productsQueryKeys.detail(id),
    queryFn: () => apiFetch<ProductWithCategory>(`/api/products/${id}`),
  });
}

export function useCategories() {
  return useQuery({
    queryKey: productsQueryKeys.categories(),
    queryFn: () => apiFetch<PaginatedList<CategoryMock>>("/api/categories"),
  });
}

export function useProductPriceHistory(id: string) {
  return useQuery({
    enabled: Boolean(id),
    queryKey: productsQueryKeys.priceHistory(id),
    queryFn: () =>
      apiFetch<PaginatedList<ProductPriceHistoryMock>>(`/api/products/${id}/price-history`),
  });
}

export function useProductSuppliers(id: string) {
  return useQuery({
    enabled: Boolean(id),
    queryKey: productsQueryKeys.suppliers(id),
    queryFn: () =>
      apiFetch<PaginatedList<SupplierProductMock>>(`/api/products/${id}/suppliers`),
  });
}

export function useCreateProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: ProductInput) =>
      apiFetch<ProductWithCategory>("/api/products", {
        body: input,
        method: "POST",
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: productsQueryKeys.all });
    },
  });
}

export function useUpdateProduct(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: ProductUpdateInput) =>
      apiFetch<ProductWithCategory>(`/api/products/${id}`, {
        body: input,
        method: "PATCH",
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: productsQueryKeys.all });
      void queryClient.invalidateQueries({
        queryKey: productsQueryKeys.detail(id),
      });
    },
  });
}

export function useUpdateProductPrice(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: ProductPriceUpdateInput) =>
      apiFetch<ProductPriceUpdateResult>(`/api/products/${id}/price`, {
        body: input,
        method: "POST",
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: productsQueryKeys.all });
      void queryClient.invalidateQueries({
        queryKey: productsQueryKeys.detail(id),
      });
      void queryClient.invalidateQueries({
        queryKey: productsQueryKeys.priceHistory(id),
      });
    },
  });
}
