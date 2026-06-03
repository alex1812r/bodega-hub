"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { PaginatedList, PaginationParams } from "@/lib/api/pagination";
import { apiFetch } from "@/shared/api/apiFetch";
import type {
  ContactMock,
  ContactType,
  PaymentMock,
  PurchaseMock,
  SaleMock,
} from "@/shared/mocks/erp-data";

export type ContactsFilters = PaginationParams & {
  isActive?: boolean | string;
  search?: string;
  type?: ContactType | string;
};

export type ContactInput = {
  address?: string;
  email?: string;
  name: string;
  phone?: string;
  taxId?: string;
  type: ContactType;
};

export type ContactUpdateInput = Partial<ContactInput> & {
  isActive?: boolean;
};

export type ContactActivityApiRow = {
  amountVes: number;
  createdAt: string;
  id: string;
  type: "payment" | "purchase" | "sale";
};

export const contactsQueryKeys = {
  all: ["contacts"] as const,
  activity: (id: string) => [...contactsQueryKeys.detail(id), "activity"] as const,
  detail: (id: string) => [...contactsQueryKeys.all, "detail", id] as const,
  list: (filters: ContactsFilters = {}) =>
    [...contactsQueryKeys.all, "list", filters] as const,
  payments: (id: string) => [...contactsQueryKeys.detail(id), "payments"] as const,
  purchases: (id: string) => [...contactsQueryKeys.detail(id), "purchases"] as const,
  sales: (id: string) => [...contactsQueryKeys.detail(id), "sales"] as const,
};

export function useContacts(filters: ContactsFilters = {}) {
  return useQuery({
    queryKey: contactsQueryKeys.list(filters),
    queryFn: () =>
      apiFetch<PaginatedList<ContactMock>>("/api/contacts", {
        query: filters,
      }),
  });
}

export function useContact(id?: string) {
  return useQuery({
    enabled: Boolean(id),
    queryKey: contactsQueryKeys.detail(id ?? ""),
    queryFn: () => apiFetch<ContactMock>(`/api/contacts/${id}`),
  });
}

export function useContactActivity(id?: string) {
  return useQuery({
    enabled: Boolean(id),
    queryKey: contactsQueryKeys.activity(id ?? ""),
    queryFn: () =>
      apiFetch<PaginatedList<ContactActivityApiRow>>(`/api/contacts/${id}/activity`),
  });
}

export function useContactSales(id?: string) {
  return useQuery({
    enabled: Boolean(id),
    queryKey: contactsQueryKeys.sales(id ?? ""),
    queryFn: () => apiFetch<PaginatedList<SaleMock>>(`/api/contacts/${id}/sales`),
  });
}

export function useContactPurchases(id?: string) {
  return useQuery({
    enabled: Boolean(id),
    queryKey: contactsQueryKeys.purchases(id ?? ""),
    queryFn: () =>
      apiFetch<PaginatedList<PurchaseMock>>(`/api/contacts/${id}/purchases`),
  });
}

export function useContactPayments(id?: string) {
  return useQuery({
    enabled: Boolean(id),
    queryKey: contactsQueryKeys.payments(id ?? ""),
    queryFn: () => apiFetch<PaginatedList<PaymentMock>>(`/api/contacts/${id}/payments`),
  });
}

export function useCreateContact() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: ContactInput) =>
      apiFetch<ContactMock>("/api/contacts", {
        body: input,
        method: "POST",
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: contactsQueryKeys.all });
    },
  });
}

export function useUpdateContact(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: ContactUpdateInput) =>
      apiFetch<ContactMock>(`/api/contacts/${id}`, {
        body: input,
        method: "PATCH",
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: contactsQueryKeys.all });
      void queryClient.invalidateQueries({
        queryKey: contactsQueryKeys.detail(id),
      });
    },
  });
}
