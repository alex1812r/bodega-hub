"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UseQueryOptions } from "@tanstack/react-query";

import { fetchAllPaginatedItems } from "@/lib/api/fetchAllPaginatedItems";
import type { PaginatedList, PaginationParams } from "@/lib/api/pagination";
import type { SortOrder } from "@/lib/api/sorting";
import { apiFetch } from "@/shared/api/apiFetch";
import type { CategoryInput } from "../services/categories.mock-server";
import type { ProductPriceHistoryEntry, ProductPriceReview } from "../services/priceReview";
import type { ProductMarginFilter } from "../services/productMargin";
import type {
  ProductSaleHistoryResult,
  ProductSaleHistoryRow,
} from "../services/productSales";
import type {
  CategoryMock,
  ProductMock,
  ProductPackConversionSummary,
  SupplierProductMock,
} from "@/shared/mocks/erp-data";

export type { CategoryInput };
export type { ProductPriceHistoryEntry, ProductPriceReview };
export type { ProductSaleHistoryResult, ProductSaleHistoryRow };

export type CategoriesFilters = PaginationParams & {
  isActive?: boolean | string;
  search?: string;
};

export type ProductWithCategory = ProductMock & {
  category?: CategoryMock;
  packConversion?: ProductPackConversionSummary;
  /** Solo si el producto está en la cola "Por revisar": su costo subió y la ganancia bajó de banda. */
  priceReview?: ProductPriceReview;
};

export type ProductsFilters = PaginationParams & {
  barcode?: string;
  categoryId?: string;
  isActive?: boolean | string;
  /** Banda de ganancia (`low` / `mid` / `high`) o `none` = productos sin costo. */
  margin?: ProductMarginFilter;
  /** `1` = solo productos en la cola "Por revisar". */
  review?: "1";
  search?: string;
  sortBy?: string;
  sortOrder?: SortOrder;
};

/** Filtros del catálogo completo: la paginación la resuelve el hook. */
export type ProductsCatalogFilters = Omit<ProductsFilters, "limit" | "skip">;

export type ProductInput = {
  barcode?: string | null;
  categoryId?: string;
  currentCostRef?: number;
  currentStock?: number;
  imageUrl?: string | null;
  minStock?: number;
  name: string;
  packConversion?: {
    /** Solo `mode: "assorted"`: de 2 a 20 productos; sus unidades suman `totalUnits`. */
    components?: { costWeight?: number; unitProductId: string; unitsPerPack: number }[];
    enabled: boolean;
    /** Solo `mode: "assorted"`: nombre opcional de la receta. */
    label?: string | null;
    mode?: "assorted" | "create_unit" | "link_existing";
    /** Solo `mode: "assorted"`: unidades que salen del empaque en total. */
    totalUnits?: number;
    unitProduct?: {
      barcode?: string | null;
      currentCostRef?: number;
      name?: string;
      salePriceRef: number;
      sku?: string;
    };
    unitProductId?: string;
    unitsPerPack?: number;
  };
  salePriceRef: number;
  /** Vacío o ausente: en el alta lo genera el servidor; en la edición se conserva el actual. */
  sku?: string;
};

export type ProductUpdateInput = Partial<ProductInput> & {
  isActive?: boolean;
};

export type ProductPriceUpdateInput = {
  /** Motivo del cambio (máx. 200 caracteres). Ausente o en blanco: se guarda sin motivo. */
  reason?: string;
  salePriceRef: number;
};

export type ProductPriceUpdateResult = {
  history: ProductPriceHistoryEntry;
  product: ProductWithCategory;
};

export const productsQueryKeys = {
  all: ["products"] as const,
  categories: (filters: CategoriesFilters = {}) =>
    [...productsQueryKeys.all, "categories", filters] as const,
  detail: (id: string) => [...productsQueryKeys.all, "detail", id] as const,
  list: (filters: ProductsFilters = {}) =>
    [...productsQueryKeys.all, "list", filters] as const,
  listAll: (filters: ProductsCatalogFilters = {}) =>
    [...productsQueryKeys.all, "list-all", filters] as const,
  priceHistory: (id: string) =>
    [...productsQueryKeys.all, "price-history", id] as const,
  sales: (id: string) => [...productsQueryKeys.all, "sales", id] as const,
  suppliers: (id: string) => [...productsQueryKeys.all, "suppliers", id] as const,
};

type ProductsListQueryOptions = Pick<
  UseQueryOptions<PaginatedList<ProductWithCategory>>,
  "enabled" | "gcTime" | "refetchOnMount" | "staleTime"
>;

type CategoriesListQueryOptions = Pick<
  UseQueryOptions<PaginatedList<CategoryMock>>,
  "enabled" | "gcTime" | "refetchOnMount" | "staleTime"
>;

export function useProducts(
  filters: ProductsFilters = {},
  options: ProductsListQueryOptions = {},
) {
  return useQuery({
    queryKey: productsQueryKeys.list(filters),
    queryFn: () =>
      apiFetch<PaginatedList<ProductWithCategory>>("/api/products", {
        query: filters,
      }),
    ...options,
  });
}

/**
 * Catálogo completo. `/api/products` tope `MAX_PAGE_LIMIT` (100) por página, así que
 * una sola consulta corta el catálogo en seco: usar esto donde la pantalla necesita
 * todos los productos (POS, selectores) y no una lista paginada.
 */
export function useAllProducts(
  filters: ProductsCatalogFilters = {},
  options: ProductsListQueryOptions = {},
) {
  return useQuery({
    queryKey: productsQueryKeys.listAll(filters),
    queryFn: async (): Promise<PaginatedList<ProductWithCategory>> => {
      const items = await fetchAllPaginatedItems<ProductWithCategory>(
        "/api/products",
        filters,
      );

      return { items, limit: items.length, skip: 0, total: items.length };
    },
    ...options,
  });
}

export function useProduct(id: string) {
  return useQuery({
    enabled: Boolean(id),
    queryKey: productsQueryKeys.detail(id),
    queryFn: () => apiFetch<ProductWithCategory>(`/api/products/${id}`),
  });
}

export function useCategories(
  filters: CategoriesFilters = {},
  options: CategoriesListQueryOptions = {},
) {
  return useQuery({
    queryKey: productsQueryKeys.categories(filters),
    queryFn: () =>
      apiFetch<PaginatedList<CategoryMock>>("/api/categories", {
        query: filters,
      }),
    ...options,
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
      apiFetch<PaginatedList<ProductPriceHistoryEntry>>(`/api/products/${id}/price-history`),
  });
}

export function useProductSales(productId: string, pagination: PaginationParams = {}) {
  return useQuery({
    enabled: Boolean(productId),
    queryKey: [...productsQueryKeys.sales(productId), pagination],
    queryFn: () =>
      apiFetch<ProductSaleHistoryResult>(`/api/products/${productId}/sales`, {
        query: pagination,
      }),
  });
}

export function useProductSuppliers(id?: string) {
  return useQuery({
    enabled: Boolean(id),
    queryKey: productsQueryKeys.suppliers(id ?? ""),
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

export function useAddProductBarcode(id: string = "") {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { barcode: string }) =>
      apiFetch<ProductWithCategory>(`/api/products/${id}/barcode`, {
        body: input,
        method: "POST",
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: productsQueryKeys.all });
      if (id) {
        void queryClient.invalidateQueries({
          queryKey: productsQueryKeys.detail(id),
        });
      }
    },
  });
}
