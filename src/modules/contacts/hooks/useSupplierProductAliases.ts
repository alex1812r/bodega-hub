"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "@/shared/api/apiFetch";

import type {
  RemovedSupplierProductAlias,
  SupplierProductAliasList,
} from "../types/supplierProductAliases";

export const supplierProductAliasesQueryKeys = {
  all: ["supplier-product-aliases"] as const,
  bySupplier: (supplierId: string) => [...supplierProductAliasesQueryKeys.all, supplierId] as const,
};

/** SCN-09b · Alias aprendidos de facturas del proveedor. */
export function useSupplierProductAliases(supplierId?: string, options: { enabled?: boolean } = {}) {
  return useQuery({
    enabled: Boolean(supplierId) && (options.enabled ?? true),
    queryKey: supplierProductAliasesQueryKeys.bySupplier(supplierId ?? ""),
    queryFn: () =>
      apiFetch<SupplierProductAliasList>(
        `/api/contacts/${encodeURIComponent(supplierId ?? "")}/product-aliases`,
      ),
  });
}

/** Quita un alias y vuelve a pedir la lista del proveedor. */
export function useRemoveSupplierProductAlias(supplierId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (aliasId: string) =>
      apiFetch<RemovedSupplierProductAlias>(
        `/api/contacts/${encodeURIComponent(supplierId)}/product-aliases/${encodeURIComponent(aliasId)}`,
        { method: "DELETE" },
      ),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: supplierProductAliasesQueryKeys.bySupplier(supplierId) }),
  });
}
