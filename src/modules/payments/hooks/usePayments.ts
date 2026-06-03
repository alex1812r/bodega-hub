"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { PaginatedList, PaginationParams } from "@/lib/api/pagination";
import { apiFetch } from "@/shared/api/apiFetch";
import type {
  ContactMock,
  PaymentDirection,
  PaymentMethod,
  PaymentMock,
} from "@/shared/mocks/erp-data";

export type PaymentsFilters = PaginationParams & {
  contactId?: string;
  direction?: PaymentDirection | string;
  purchaseId?: string;
  saleId?: string;
};

export type PaymentListItem = PaymentMock & {
  contact?: ContactMock;
};

export type PaymentDetail = PaymentMock & {
  contact?: ContactMock;
};

export type PaymentCreateInput = {
  amount: number;
  bankName?: string;
  currency?: "USD" | "VES";
  method: PaymentMethod;
  notes?: string;
  phone?: string;
  purchaseId?: string;
  referenceCode?: string;
  saleId?: string;
};

export const paymentsQueryKeys = {
  all: ["payments"] as const,
  detail: (id: string) => [...paymentsQueryKeys.all, "detail", id] as const,
  list: (filters: PaymentsFilters = {}) =>
    [...paymentsQueryKeys.all, "list", filters] as const,
};

function paymentMatchesFilters(payment: PaymentDetail, filters: PaymentsFilters) {
  return (
    (!filters.contactId || payment.contactId === filters.contactId) &&
    (!filters.direction || payment.direction === filters.direction) &&
    (!filters.purchaseId || payment.purchaseId === filters.purchaseId) &&
    (!filters.saleId || payment.saleId === filters.saleId)
  );
}

export function usePayments(filters: PaymentsFilters = {}) {
  return useQuery({
    queryKey: paymentsQueryKeys.list(filters),
    queryFn: () =>
      apiFetch<PaginatedList<PaymentListItem>>("/api/payments", {
        query: filters,
      }),
  });
}

export function usePayment(id?: string) {
  return useQuery({
    enabled: Boolean(id),
    queryKey: paymentsQueryKeys.detail(id ?? ""),
    queryFn: () => apiFetch<PaymentDetail>(`/api/payments/${id}`),
  });
}

export function useCreatePayment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: PaymentCreateInput) =>
      apiFetch<PaymentDetail>("/api/payments", {
        body: input,
        method: "POST",
      }),
    onSuccess: (payment) => {
      queryClient.setQueryData(paymentsQueryKeys.detail(payment.id), payment);
      queryClient
        .getQueryCache()
        .findAll({
          predicate: (query) =>
            query.queryKey[0] === paymentsQueryKeys.all[0] &&
            query.queryKey[1] === "list",
        })
        .forEach((query) => {
          const filters = (query.queryKey[2] ?? {}) as PaymentsFilters;
          queryClient.setQueryData<PaginatedList<PaymentListItem>>(query.queryKey, (current) => {
            if (!current || !paymentMatchesFilters(payment, filters)) {
              return current;
            }

            if (current.items.some((item) => item.id === payment.id)) {
              return current;
            }

            return {
              ...current,
              items: [payment, ...current.items],
              total: current.total + 1,
            };
          });
        });
      void queryClient.invalidateQueries({ queryKey: ["sales"] });
      void queryClient.invalidateQueries({ queryKey: ["purchases"] });
      void queryClient.invalidateQueries({ queryKey: ["contacts"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["reports"] });
    },
  });
}
