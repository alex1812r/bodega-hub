"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "@/shared/api/apiFetch";

import { productsQueryKeys } from "@/modules/products/hooks/useProducts";

import { supplierProductsQueryKeys } from "./useSupplierProducts";

import type {
  SupplierProduct,
  SupplierProductCreateInput,
  SupplierProductMetadataUpdateInput,
  SupplierProductRegisterPriceInput,
  SupplierProductRegisterPriceResult,
} from "../types/supplierProducts";

function invalidateSupplierProductQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  supplierProduct: Pick<SupplierProduct, "id" | "productId" | "supplierId">,
) {
  void queryClient.invalidateQueries({ queryKey: supplierProductsQueryKeys.all });
  void queryClient.invalidateQueries({
    queryKey: supplierProductsQueryKeys.bySupplier(supplierProduct.supplierId),
  });
  void queryClient.invalidateQueries({
    queryKey: supplierProductsQueryKeys.byProduct(supplierProduct.productId),
  });
  void queryClient.invalidateQueries({
    queryKey: productsQueryKeys.suppliers(supplierProduct.productId),
  });
  void queryClient.invalidateQueries({
    queryKey: supplierProductsQueryKeys.priceHistory(supplierProduct.id),
  });
}

export function useCreateSupplierProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: SupplierProductCreateInput) =>
      apiFetch<SupplierProduct>("/api/supplier-products", {
        body: input,
        method: "POST",
      }),
    onSuccess: (supplierProduct) => {
      invalidateSupplierProductQueries(queryClient, supplierProduct);
    },
  });
}

export function useUpdateSupplierProductMetadata(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: SupplierProductMetadataUpdateInput) =>
      apiFetch<SupplierProduct>(`/api/supplier-products/${id}`, {
        body: input,
        method: "PATCH",
      }),
    onSuccess: (supplierProduct) => {
      invalidateSupplierProductQueries(queryClient, supplierProduct);
    },
  });
}

export function useRegisterSupplierPrice(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: SupplierProductRegisterPriceInput) =>
      apiFetch<SupplierProductRegisterPriceResult>(`/api/supplier-products/${id}/prices`, {
        body: input,
        method: "POST",
      }),
    onSuccess: (result) => {
      invalidateSupplierProductQueries(queryClient, result.supplierProduct);
    },
  });
}

export function useDeactivateSupplierProduct(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () =>
      apiFetch<SupplierProduct>(`/api/supplier-products/${id}/deactivate`, {
        method: "PATCH",
      }),
    onSuccess: (supplierProduct) => {
      invalidateSupplierProductQueries(queryClient, supplierProduct);
    },
  });
}
