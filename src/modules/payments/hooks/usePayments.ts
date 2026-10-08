"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { PaginatedList, PaginationParams } from "@/lib/api/pagination";
import { cashKeys } from "@/modules/cash/hooks/useCash";
import { vaultKeys } from "@/modules/vault/hooks/useVault";
import { apiFetch } from "@/shared/api/apiFetch";
import type {
  ContactMock,
  PaymentDirection,
  PaymentMethod,
  PaymentMock,
} from "@/shared/mocks/erp-data";
import { isUtcTimestampInCaracasDateRange } from "@/shared/utils/caracasBusinessDay";

export type PaymentsFilters = PaginationParams & {
  contactId?: string;
  direction?: PaymentDirection | string;
  /** Dia operativo Caracas `YYYY-MM-DD` del pago, inclusive. */
  from?: string;
  method?: PaymentMethod;
  purchaseId?: string;
  saleId?: string;
  /** Dia operativo Caracas `YYYY-MM-DD` del pago, inclusive. */
  to?: string;
};

import type { PaymentDocumentBalance } from "../payment-details/types";
import type { PaymentRelatedDocument } from "../utils/resolvePaymentRelatedDocument";
import { openDocumentsQueryKeys } from "./useOpenDocuments";

export type { PaymentDocumentBalance, PaymentRelatedDocument };

export type PaymentListItem = PaymentMock & {
  contact?: ContactMock;
  relatedDocument?: PaymentRelatedDocument;
};

export type PaymentDetail = PaymentMock & {
  contact?: ContactMock;
  createdBy?: {
    id: string;
    name: string;
  };
  documentBalance?: PaymentDocumentBalance;
  relatedDocument?: PaymentRelatedDocument;
};

/** Desglose de billetes por moneda: `{"USD":{"1":3}}`. */
export type PaymentDenominations = Partial<Record<"USD" | "VES", Record<string, number>>>;

/** Vuelto entregado por el excedente de un cobro (spec cobro-pos-billetes §2). */
export type PaymentChangeInput = {
  /** Monto en la moneda de `method`. */
  amount: number;
  bankName?: string;
  method: PaymentMethod;
  phone?: string;
  referenceCode?: string;
};

export type PaymentCreateInput = {
  amount: number;
  bankName?: string;
  change?: PaymentChangeInput | null;
  changeDenominations?: PaymentDenominations | null;
  /**
   * Clave de idempotencia del intento (PAG-06): el reintento tras un error de
   * resultado incierto viaja con la misma y el servidor no registra el pago dos veces.
   */
  clientRequestId?: string;
  currency?: "USD" | "VES";
  method: PaymentMethod;
  notes?: string;
  phone?: string;
  purchaseId?: string;
  receivedDenominations?: PaymentDenominations | null;
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
    (!filters.saleId || payment.saleId === filters.saleId) &&
    (!filters.method || payment.method === filters.method) &&
    isUtcTimestampInCaracasDateRange(payment.createdAt, filters.from, filters.to)
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
      // Un pago mueve efectivo: la sesion de caja y el baul muestran saldos que cambian.
      void queryClient.invalidateQueries({ queryKey: cashKeys.all });
      void queryClient.invalidateQueries({ queryKey: vaultKeys.all });
      // El documento abonado cambia de saldo o deja de tenerlo.
      void queryClient.invalidateQueries({ queryKey: openDocumentsQueryKeys.all });
    },
  });
}

export function useCancelPayment(id?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (paymentId?: string) =>
      apiFetch<PaymentDetail>(`/api/payments/${paymentId ?? id}/cancel`, {
        method: "PATCH",
      }),
    onSuccess: (payment, paymentId) => {
      const affectedPaymentId = paymentId ?? id ?? payment.id;
      queryClient.setQueryData(paymentsQueryKeys.detail(affectedPaymentId), payment);
      void queryClient.invalidateQueries({ queryKey: paymentsQueryKeys.all });
      void queryClient.invalidateQueries({ queryKey: ["sales"] });
      void queryClient.invalidateQueries({ queryKey: ["purchases"] });
      void queryClient.invalidateQueries({ queryKey: ["contacts"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["reports"] });
      // Un pago mueve efectivo: la sesion de caja y el baul muestran saldos que cambian.
      void queryClient.invalidateQueries({ queryKey: cashKeys.all });
      void queryClient.invalidateQueries({ queryKey: vaultKeys.all });
    },
  });
}
