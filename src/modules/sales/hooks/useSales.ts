"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { PaginatedList, PaginationParams } from "@/lib/api/pagination";
import { apiFetch } from "@/shared/api/apiFetch";
import type {
  ContactMock,
  PaymentMock,
  ProductMock,
  SaleItemMock,
  SaleMock,
  SaleStatus,
  StockMovementType,
} from "@/shared/mocks/erp-data";

export type SalesFilters = PaginationParams & {
  customerId?: string;
  from?: string;
  search?: string;
  status?: SaleStatus | string;
  to?: string;
};

export type SaleCreateInput = {
  customerId: string;
  discountRef?: number;
  items: Array<{
    productId: string;
    quantity: number;
  }>;
  notes?: string;
  refRateVes?: number;
  taxRef?: number;
};

export type SaleListItem = SaleMock & {
  customer?: ContactMock;
  itemsCount: number;
};

export type SaleItemWithProduct = SaleItemMock & {
  product?: ProductMock;
};

export type SaleDetail = SaleMock & {
  customer?: ContactMock;
  items: SaleItemWithProduct[];
  payments: PaymentMock[];
};

export type SaleReturnResult = {
  sale: SaleDetail;
  stockMovements: Array<{
    createdAt: string;
    id: string;
    productId: string;
    quantityDelta: number;
    reason?: string;
    saleId: string;
    stockAfter?: number;
    type: StockMovementType;
  }>;
};

export type SaleReceipt = {
  customer?: ContactMock;
  invoiceNumber: string;
  items: SaleItemWithProduct[];
  paidVes: number;
  pendingVes: number;
  saleId: string;
  totalRef: number;
  totalVes: number;
};

export const salesQueryKeys = {
  all: ["sales"] as const,
  detail: (id: string) => [...salesQueryKeys.all, "detail", id] as const,
  list: (filters: SalesFilters = {}) =>
    [...salesQueryKeys.all, "list", filters] as const,
  receipt: (id: string) => [...salesQueryKeys.detail(id), "receipt"] as const,
};

export function useSales(filters: SalesFilters = {}) {
  return useQuery({
    queryKey: salesQueryKeys.list(filters),
    queryFn: () =>
      apiFetch<PaginatedList<SaleListItem>>("/api/sales", {
        query: filters,
      }),
  });
}

export function useSale(id?: string) {
  return useQuery({
    enabled: Boolean(id),
    queryKey: salesQueryKeys.detail(id ?? ""),
    queryFn: () => apiFetch<SaleDetail>(`/api/sales/${id}`),
  });
}

export function useSaleReceipt(id?: string) {
  return useQuery({
    enabled: Boolean(id),
    queryKey: salesQueryKeys.receipt(id ?? ""),
    queryFn: () => apiFetch<SaleReceipt>(`/api/sales/${id}/receipt`),
  });
}

export function useCreateSale() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: SaleCreateInput) =>
      apiFetch<SaleMock>("/api/sales", {
        body: input,
        method: "POST",
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: salesQueryKeys.all });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["inventory"] });
      void queryClient.invalidateQueries({ queryKey: ["contacts"] });
      void queryClient.invalidateQueries({ queryKey: ["reports"] });
    },
  });
}

export function useCancelSale(id?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (saleId?: string) =>
      apiFetch<SaleDetail>(`/api/sales/${saleId ?? id}/cancel`, {
        method: "PATCH",
      }),
    onSuccess: (sale, saleId) => {
      const affectedSaleId = saleId ?? id ?? sale.id;
      queryClient.setQueryData(salesQueryKeys.detail(affectedSaleId), sale);
      void queryClient.invalidateQueries({ queryKey: salesQueryKeys.all });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["contacts"] });
      void queryClient.invalidateQueries({ queryKey: ["reports"] });
    },
  });
}

export function useReturnSale(id?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (saleId?: string) =>
      apiFetch<SaleReturnResult>(`/api/sales/${saleId ?? id}/return`, {
        method: "POST",
      }),
    onSuccess: (result, saleId) => {
      const affectedSaleId = saleId ?? id ?? result.sale.id;
      queryClient.setQueryData(salesQueryKeys.detail(affectedSaleId), result.sale);
      void queryClient.invalidateQueries({ queryKey: salesQueryKeys.all });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["inventory"] });
      void queryClient.invalidateQueries({ queryKey: ["contacts"] });
      void queryClient.invalidateQueries({ queryKey: ["reports"] });
    },
  });
}
