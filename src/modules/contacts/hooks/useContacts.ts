"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UseQueryOptions } from "@tanstack/react-query";

import type { PaginatedList, PaginationParams } from "@/lib/api/pagination";
import type { PaymentRelatedDocument } from "@/modules/payments/utils/resolvePaymentRelatedDocument";
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
  activity: (id: string, pagination: PaginationParams = {}) =>
    [...contactsQueryKeys.detail(id), "activity", pagination] as const,
  detail: (id: string) => [...contactsQueryKeys.all, "detail", id] as const,
  list: (filters: ContactsFilters = {}) =>
    [...contactsQueryKeys.all, "list", filters] as const,
  payments: (id: string, pagination: PaginationParams = {}) =>
    [...contactsQueryKeys.detail(id), "payments", pagination] as const,
  purchases: (id: string, pagination: PaginationParams = {}) =>
    [...contactsQueryKeys.detail(id), "purchases", pagination] as const,
  sales: (id: string, pagination: PaginationParams = {}) =>
    [...contactsQueryKeys.detail(id), "sales", pagination] as const,
};

type ContactsListQueryOptions = Pick<
  UseQueryOptions<PaginatedList<ContactMock>>,
  "enabled" | "gcTime" | "refetchOnMount" | "staleTime"
>;

export function useContacts(
  filters: ContactsFilters = {},
  options: ContactsListQueryOptions = {},
) {
  return useQuery({
    queryKey: contactsQueryKeys.list(filters),
    queryFn: () =>
      apiFetch<PaginatedList<ContactMock>>("/api/contacts", {
        query: filters,
      }),
    ...options,
  });
}

export function useContact(id?: string) {
  return useQuery({
    enabled: Boolean(id),
    queryKey: contactsQueryKeys.detail(id ?? ""),
    queryFn: () => apiFetch<ContactMock>(`/api/contacts/${id}`),
  });
}

/**
 * Sublistas del detalle de un contacto, paginadas en servidor (`skip`/`limit`).
 * Sin `pagination` el BFF entrega la primera página de 10. Al cambiar de página
 * se conserva la anterior a la vista hasta que llega la nueva.
 */
export function useContactActivity(id?: string, pagination: PaginationParams = {}) {
  return useQuery({
    enabled: Boolean(id),
    placeholderData: keepPreviousData,
    queryKey: contactsQueryKeys.activity(id ?? "", pagination),
    queryFn: () =>
      apiFetch<PaginatedList<ContactActivityApiRow>>(`/api/contacts/${id}/activity`, {
        query: pagination,
      }),
  });
}

export function useContactSales(id?: string, pagination: PaginationParams = {}) {
  return useQuery({
    enabled: Boolean(id),
    placeholderData: keepPreviousData,
    queryKey: contactsQueryKeys.sales(id ?? "", pagination),
    queryFn: () =>
      apiFetch<PaginatedList<SaleMock>>(`/api/contacts/${id}/sales`, { query: pagination }),
  });
}

export function useContactPurchases(id?: string, pagination: PaginationParams = {}) {
  return useQuery({
    enabled: Boolean(id),
    placeholderData: keepPreviousData,
    queryKey: contactsQueryKeys.purchases(id ?? "", pagination),
    queryFn: () =>
      apiFetch<PaginatedList<PurchaseMock>>(`/api/contacts/${id}/purchases`, {
        query: pagination,
      }),
  });
}

/** Pago del contacto con el número y el enlace de su venta o compra. */
export type ContactPaymentItem = PaymentMock & { relatedDocument?: PaymentRelatedDocument };

export function useContactPayments(id?: string, pagination: PaginationParams = {}) {
  return useQuery({
    enabled: Boolean(id),
    placeholderData: keepPreviousData,
    queryKey: contactsQueryKeys.payments(id ?? "", pagination),
    queryFn: () =>
      apiFetch<PaginatedList<ContactPaymentItem>>(`/api/contacts/${id}/payments`, {
        query: pagination,
      }),
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
