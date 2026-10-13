"use client";

import { useQuery } from "@tanstack/react-query";

import type { PaginationParams } from "@/lib/api/pagination";
import { apiFetch } from "@/shared/api/apiFetch";

import type {
  AgingBucket,
  AgingReport,
  CashCloseCurrency,
  CashCloseDifferencesReport,
  MoneyReportRange,
  SalesByCategoryReport,
  SalesByHourReport,
} from "../services/moneyReports";

/** Reportes de dinero (REP-06). Los cinco son de solo lectura y por tienda. */

export type MoneyReportHookOptions = { enabled?: boolean };

export type AgingReportFilters = PaginationParams & {
  bucket?: AgingBucket;
  contactId?: string;
};

export type CashCloseDifferencesFilters = PaginationParams & {
  currency?: CashCloseCurrency;
  from?: string;
  to?: string;
};

export const moneyReportsQueryKeys = {
  all: ["reports", "money"] as const,
  cashCloseDifferences: (filters: CashCloseDifferencesFilters) =>
    ["reports", "money", "cash-close-differences", filters] as const,
  payablesAging: (filters: AgingReportFilters) =>
    ["reports", "money", "payables-aging", filters] as const,
  receivablesAging: (filters: AgingReportFilters) =>
    ["reports", "money", "receivables-aging", filters] as const,
  salesByCategory: (range: Partial<MoneyReportRange>) =>
    ["reports", "money", "sales-by-category", range] as const,
  salesByHour: (range: Partial<MoneyReportRange>) =>
    ["reports", "money", "sales-by-hour", range] as const,
};

function hasRange(range: Partial<MoneyReportRange>) {
  return Boolean(range.from && range.to);
}

/** Matriz 7×24 de ventas por día de la semana y hora. No consulta sin `from` y `to`. */
export function useSalesByHourReport(
  range: Partial<MoneyReportRange>,
  options: MoneyReportHookOptions = {},
) {
  return useQuery({
    enabled: (options.enabled ?? true) && hasRange(range),
    queryKey: moneyReportsQueryKeys.salesByHour(range),
    queryFn: () =>
      apiFetch<SalesByHourReport>("/api/reports/sales-by-hour", {
        query: { from: range.from, to: range.to },
      }),
  });
}

/** Ventas, costo y margen por categoría. No consulta sin `from` y `to`. */
export function useSalesByCategoryReport(
  range: Partial<MoneyReportRange>,
  options: MoneyReportHookOptions = {},
) {
  return useQuery({
    enabled: (options.enabled ?? true) && hasRange(range),
    queryKey: moneyReportsQueryKeys.salesByCategory(range),
    queryFn: () =>
      apiFetch<SalesByCategoryReport>("/api/reports/sales-by-category", {
        query: { from: range.from, to: range.to },
      }),
  });
}

/** Cuentas por cobrar con antigüedad, paginadas en servidor. */
export function useReceivablesAgingReport(
  filters: AgingReportFilters = {},
  options: MoneyReportHookOptions = {},
) {
  return useQuery({
    enabled: options.enabled ?? true,
    queryKey: moneyReportsQueryKeys.receivablesAging(filters),
    queryFn: () => apiFetch<AgingReport>("/api/reports/receivables-aging", { query: filters }),
  });
}

/** Cuentas por pagar con antigüedad, paginadas en servidor. */
export function usePayablesAgingReport(
  filters: AgingReportFilters = {},
  options: MoneyReportHookOptions = {},
) {
  return useQuery({
    enabled: options.enabled ?? true,
    queryKey: moneyReportsQueryKeys.payablesAging(filters),
    queryFn: () => apiFetch<AgingReport>("/api/reports/payables-aging", { query: filters }),
  });
}

/** Diferencias de cierre de caja (contado − teórico) por sesión y moneda. */
export function useCashCloseDifferencesReport(
  filters: CashCloseDifferencesFilters = {},
  options: MoneyReportHookOptions = {},
) {
  return useQuery({
    enabled: options.enabled ?? true,
    queryKey: moneyReportsQueryKeys.cashCloseDifferences(filters),
    queryFn: () =>
      apiFetch<CashCloseDifferencesReport>("/api/reports/cash-close-differences", { query: filters }),
  });
}
