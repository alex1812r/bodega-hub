"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { PaginatedList, PaginationParams } from "@/lib/api/pagination";
import type { SortOrder } from "@/lib/api/sorting";
import { apiFetch } from "@/shared/api/apiFetch";
import type { CategoryInput } from "../services/categories.mock-server";
import type {
  CategoryMock,
  ProductMock,
  ProductPriceHistoryMock,
  SupplierProductMock,
} from "@/shared/mocks/erp-data";

export type { CategoryInput };

export type CategoriesFilters = PaginationParams & {
  isActive?: boolean | string;
  search?: string;
};

export type ProductWithCategory = ProductMock & {
  category?: CategoryMock;
};

export type ProductsFilters = PaginationParams & {
  barcode?: string;
  categoryId?: string;
  isActive?: boolean | string;
  search?: string;
  sortBy?: string;
  sortOrder?: SortOrder;
};

export type ProductInput = {
  barcode?: string | null;
  categoryId?: string;
  currentCostRef?: number;
  currentStock?: number;
  imageUrl?: string | null;
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
  categories: (filters: CategoriesFilters = {}) =>
    [...productsQueryKeys.all, "categories", filters] as const,
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

export function useCategories(filters: CategoriesFilters = {}) {
  return useQuery({
    queryKey: productsQueryKeys.categories(filters),
    queryFn: () =>
      apiFetch<PaginatedList<CategoryMock>>("/api/categories", {
        query: filters,
      }),
  });
}

export function useCreateCategory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CategoryInput) =>
      apiFetch<CategoryMock>("/api/categories", {
        body: input,
        method: "POST",
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: productsQueryKeys.all });
    },
  });
}

export function useUpdateCategory(id: string = "") {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CategoryInput & { id?: string }) => {
      const categoryId = input.id ?? id;
      const { id: _ignored, ...body } = input;

      return apiFetch<CategoryMock>(`/api/categories/${categoryId}`, {
        body,
        method: "PATCH",
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: productsQueryKeys.all });
    },
  });
}

export function useDeleteCategory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<CategoryMock & { deleted?: boolean }>(`/api/categories/${id}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: productsQueryKeys.all });
    },
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
