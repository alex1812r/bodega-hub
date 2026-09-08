"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { PaginatedList, PaginationParams } from "@/lib/api/pagination";
import { vaultKeys } from "@/modules/vault/hooks/useVault";
import { apiFetch } from "@/shared/api/apiFetch";

import type {
  PayrollCancelPaymentInput,
  PayrollCurrentSummary,
  PayrollEmployee,
  PayrollEmployeeInput,
  PayrollItem,
  PayrollMineCurrent,
  PayrollMineItem,
  PayrollPayInput,
  PayrollPeriod,
  PayrollPeriodDetail,
  PayrollSettingsInput,
  PayrollSettingsView,
} from "../types";

export type { PayrollEmployeeInput, PayrollMineCurrent, PayrollSettingsInput, PayrollSettingsView };

export type PayrollPeriodsFilters = PaginationParams;

export const payrollKeys = {
  all: ["payroll"] as const,
  current: () => [...payrollKeys.all, "current"] as const,
  employees: () => [...payrollKeys.all, "employees"] as const,
  mine: () => [...payrollKeys.all, "mine"] as const,
  mineCurrent: () => [...payrollKeys.all, "mine", "current"] as const,
  periodDetail: (periodId: string) => [...payrollKeys.all, "period", periodId] as const,
  periods: (filters: PayrollPeriodsFilters = {}) =>
    [...payrollKeys.all, "periods", filters] as const,
  settings: () => [...payrollKeys.all, "settings"] as const,
};

/**
 * Toda mutación de nómina puede mover el snapshot del periodo, el historial y la
 * estimación viva, así que se invalida el árbol completo. Pagar o anular además
 * mueve el baúl.
 */
function useInvalidatePayrollQueries() {
  const queryClient = useQueryClient();

  return (options: { includeVault?: boolean } = {}) => {
    void queryClient.invalidateQueries({ queryKey: payrollKeys.all });

    if (options.includeVault) {
      void queryClient.invalidateQueries({ queryKey: vaultKeys.all });
      void queryClient.invalidateQueries({ queryKey: vaultKeys.movements });
    }
  };
}

export function usePayrollSettings() {
  return useQuery({
    queryKey: payrollKeys.settings(),
    queryFn: () => apiFetch<PayrollSettingsView>("/api/payroll/settings"),
  });
}

export function useUpdatePayrollSettings() {
  const invalidate = useInvalidatePayrollQueries();

  return useMutation({
    mutationFn: (input: PayrollSettingsInput) =>
      apiFetch<PayrollSettingsView>("/api/payroll/settings", {
        body: input,
        method: "PATCH",
      }),
    onSuccess: () => invalidate(),
  });
}

export function useUpdatePayrollEmployee() {
  const invalidate = useInvalidatePayrollQueries();

  return useMutation({
    mutationFn: ({ profileId, ...input }: PayrollEmployeeInput & { profileId: string }) =>
      apiFetch<PayrollEmployee>(`/api/payroll/employees/${profileId}`, {
        body: input,
        method: "PUT",
      }),
    onSuccess: () => invalidate(),
  });
}

export function usePayrollPeriods(filters: PayrollPeriodsFilters = {}) {
  return useQuery({
    queryKey: payrollKeys.periods(filters),
    queryFn: () =>
      apiFetch<PaginatedList<PayrollPeriod>>("/api/payroll/periods", { query: filters }),
  });
}

export function usePayrollPeriod(periodId: string | undefined) {
  return useQuery({
    enabled: Boolean(periodId),
    queryKey: payrollKeys.periodDetail(periodId ?? ""),
    queryFn: () => apiFetch<PayrollPeriodDetail>(`/api/payroll/periods/${periodId ?? ""}`),
  });
}

/** Calcula (o vuelve a crear) la quincena `periodKey` como borrador. */
export function useComputePayrollPeriod() {
  const invalidate = useInvalidatePayrollQueries();

  return useMutation({
    mutationFn: (body: { periodKey: string }) =>
      apiFetch<PayrollPeriod>("/api/payroll/periods", { body, method: "POST" }),
    onSuccess: () => invalidate(),
  });
}

export function useRecomputePayrollPeriod(periodId: string) {
  const invalidate = useInvalidatePayrollQueries();

  return useMutation({
    mutationFn: () =>
      apiFetch<PayrollPeriodDetail>(`/api/payroll/periods/${periodId}/recompute`, {
        method: "POST",
      }),
    onSuccess: () => invalidate(),
  });
}

export function useApprovePayrollPeriod(periodId: string) {
  const invalidate = useInvalidatePayrollQueries();

  return useMutation({
    mutationFn: () =>
      apiFetch<PayrollPeriodDetail>(`/api/payroll/periods/${periodId}/approve`, {
        method: "POST",
      }),
    onSuccess: () => invalidate(),
  });
}

export function usePayPayrollItem() {
  const invalidate = useInvalidatePayrollQueries();

  return useMutation({
    mutationFn: ({ itemId, ...body }: PayrollPayInput & { itemId: string }) =>
      apiFetch<PayrollItem>(`/api/payroll/items/${itemId}/pay`, { body, method: "POST" }),
    onSuccess: () => invalidate({ includeVault: true }),
  });
}

export function useCancelPayrollPayment() {
  const invalidate = useInvalidatePayrollQueries();

  return useMutation({
    mutationFn: ({ itemId, ...body }: PayrollCancelPaymentInput & { itemId: string }) =>
      apiFetch<PayrollItem>(`/api/payroll/items/${itemId}/cancel-payment`, {
        body,
        method: "POST",
      }),
    onSuccess: () => invalidate({ includeVault: true }),
  });
}

/** Quincena en curso + anterior + estimación viva por empleado (admin). */
export function usePayrollCurrent() {
  return useQuery({
    queryKey: payrollKeys.current(),
    queryFn: () => apiFetch<PayrollCurrentSummary>("/api/payroll/current"),
  });
}

/** Recibos del propio cajero. */
export function useMyPayrollItems() {
  return useQuery({
    queryKey: payrollKeys.mine(),
    queryFn: () => apiFetch<PaginatedList<PayrollMineItem>>("/api/payroll/mine"),
  });
}

/** Estimación viva del propio cajero para la quincena en curso. */
export function useMyPayrollCurrent() {
  return useQuery({
    queryKey: payrollKeys.mineCurrent(),
    queryFn: () => apiFetch<PayrollMineCurrent>("/api/payroll/mine/current"),
  });
}
