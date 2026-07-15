import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "@/shared/api/apiFetch";

import type {
  SupplierProductPackUnit,
  SupplierProductPackUnitInput,
  SupplierProductPackUnitUpdateInput,
} from "../types/supplierProducts";
import { supplierProductsQueryKeys } from "./useSupplierProducts";

export const supplierProductPackUnitsQueryKeys = {
  list: (supplierProductId: string) =>
    ["supplier-product-pack-units", supplierProductId] as const,
};

export function useSupplierProductPackUnits(supplierProductId: string) {
  return useQuery({
    enabled: Boolean(supplierProductId),
    queryFn: () =>
      apiFetch<SupplierProductPackUnit[]>(
        `/api/supplier-products/${supplierProductId}/pack-units`,
      ),
    queryKey: supplierProductPackUnitsQueryKeys.list(supplierProductId),
  });
}

export function useCreateSupplierProductPackUnit(supplierProductId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: SupplierProductPackUnitInput) =>
      apiFetch<SupplierProductPackUnit>(
        `/api/supplier-products/${supplierProductId}/pack-units`,
        {
          body: JSON.stringify(input),
          method: "POST",
        },
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: supplierProductPackUnitsQueryKeys.list(supplierProductId),
      });
      await queryClient.invalidateQueries({ queryKey: supplierProductsQueryKeys.all });
    },
  });
}

export function useUpdateSupplierProductPackUnit(
  supplierProductId: string,
  packUnitId: string,
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: SupplierProductPackUnitUpdateInput) =>
      apiFetch<SupplierProductPackUnit>(
        `/api/supplier-products/${supplierProductId}/pack-units/${packUnitId}`,
        {
          body: JSON.stringify(input),
          method: "PATCH",
        },
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: supplierProductPackUnitsQueryKeys.list(supplierProductId),
      });
      await queryClient.invalidateQueries({ queryKey: supplierProductsQueryKeys.all });
    },
  });
}

export function useDeactivateSupplierProductPackUnit(supplierProductId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (packUnitId: string) =>
      apiFetch<SupplierProductPackUnit>(
        `/api/supplier-products/${supplierProductId}/pack-units/${packUnitId}`,
        { method: "DELETE" },
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: supplierProductPackUnitsQueryKeys.list(supplierProductId),
      });
      await queryClient.invalidateQueries({ queryKey: supplierProductsQueryKeys.all });
    },
  });
}
