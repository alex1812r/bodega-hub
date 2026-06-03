"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { PaginatedList, PaginationParams } from "@/lib/api/pagination";
import { apiFetch } from "@/shared/api/apiFetch";
import type {
  ContactMock,
  PaymentMock,
  ProductMock,
  PurchaseItemMock,
  PurchaseMock,
  PurchaseStatus,
  SupplierProductMock,
} from "@/shared/mocks/erp-data";

export type PurchasesFilters = PaginationParams & {
  from?: string;
  status?: PurchaseStatus | string;
  supplierId?: string;
  to?: string;
};

export type PurchaseInput = {
  discountRef?: number;
  items: Array<{
    productId: string;
    quantity: number;
    unitCostRef: number;
  }>;
  refRateVes?: number;
  status?: PurchaseStatus;
  supplierId: string;
  taxRef?: number;
};

export type PurchaseListRow = PurchaseMock & {
  itemsCount: number;
  supplier?: ContactMock;
};

export type PurchaseDetails = PurchaseMock & {
  items: Array<PurchaseItemMock & { product?: ProductMock }>;
  payments: PaymentMock[];
  supplier?: ContactMock;
};

export type SupplierProductWithProduct = SupplierProductMock & {
  product?: ProductMock;
};

export type PurchaseReturnResult = {
  purchase: PurchaseDetails;
  stockMovements: Array<{
    createdAt: string;
    id: string;
    productId: string;
    purchaseId: string;
    quantityDelta: number;
    reason: string;
    type: string;
  }>;
};

export const purchasesQueryKeys = {
  all: ["purchases"] as const,
  detail: (id: string) => [...purchasesQueryKeys.all, "detail", id] as const,
  list: (filters: PurchasesFilters = {}) =>
    [...purchasesQueryKeys.all, "list", filters] as const,
  supplierProducts: (supplierId: string) =>
    [...purchasesQueryKeys.all, "supplier-products", supplierId] as const,
};

export function usePurchases(filters: PurchasesFilters = {}) {
  return useQuery({
    queryKey: purchasesQueryKeys.list(filters),
    queryFn: () =>
      apiFetch<PaginatedList<PurchaseListRow>>("/api/purchases", {
        query: filters,
      }),
  });
}

export function usePurchase(id?: string) {
  return useQuery({
    enabled: Boolean(id),
    queryKey: purchasesQueryKeys.detail(id ?? ""),
    queryFn: () => apiFetch<PurchaseDetails>(`/api/purchases/${id}`),
  });
}

export function useSupplierProducts(supplierId?: string) {
  return useQuery({
    enabled: Boolean(supplierId),
    queryKey: purchasesQueryKeys.supplierProducts(supplierId ?? ""),
    queryFn: () =>
      apiFetch<PaginatedList<SupplierProductWithProduct>>(
        `/api/suppliers/${supplierId}/products`,
      ),
  });
}

export function useCreatePurchase() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: PurchaseInput) =>
      apiFetch<PurchaseMock>("/api/purchases", {
        body: input,
        method: "POST",
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: purchasesQueryKeys.all });
    },
  });
}

export function useCancelPurchase(id?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (purchaseId?: string) => {
      const targetId = purchaseId ?? id;

      if (!targetId) {
        throw new Error("Debes indicar la compra a cancelar.");
      }

      return apiFetch<PurchaseDetails>(`/api/purchases/${targetId}/cancel`, {
        method: "PATCH",
      });
    },
    onSuccess: (purchase) => {
      queryClient.setQueryData(purchasesQueryKeys.detail(purchase.id), purchase);
      void queryClient.invalidateQueries({ queryKey: purchasesQueryKeys.all });
    },
  });
}

export function useReturnPurchase(id?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (purchaseId?: string) => {
      const targetId = purchaseId ?? id;

      if (!targetId) {
        throw new Error("Debes indicar la compra a devolver.");
      }

      return apiFetch<PurchaseReturnResult>(`/api/purchases/${targetId}/return`, {
        method: "POST",
      });
    },
    onSuccess: (result) => {
      queryClient.setQueryData(purchasesQueryKeys.detail(result.purchase.id), result.purchase);
      void queryClient.invalidateQueries({ queryKey: purchasesQueryKeys.all });
    },
  });
}

export function useReceivePurchase(id?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (purchaseId?: string) => {
      const targetId = purchaseId ?? id;

      if (!targetId) {
        throw new Error("Debes indicar la compra a recibir.");
      }

      return apiFetch<PurchaseDetails>(`/api/purchases/${targetId}/receive`, {
        method: "PATCH",
      });
    },
    onSuccess: (purchase) => {
      queryClient.setQueryData(purchasesQueryKeys.detail(purchase.id), purchase);
      void queryClient.invalidateQueries({ queryKey: purchasesQueryKeys.all });
    },
  });
}
