"use client";

import { useQuery } from "@tanstack/react-query";

import type { PaginatedList, PaginationParams } from "@/lib/api/pagination";
import { apiFetch } from "@/shared/api/apiFetch";
import type { ProductMock } from "@/shared/mocks/erp-data";

export type DashboardSalesTrendPoint = {
  paidVes: number;
  saleDate: string;
  salesCount: number;
  totalRef: number;
  totalVes: number;
};

export type DashboardRecentSale = {
  createdAt: string;
  customerName: string;
  id: string;
  invoiceNumber: string;
  status: string;
  storeId?: string | null;
  storeName?: string;
  totalRef: number;
};

export type DashboardSummary = {
  activeCustomers: number;
  dayOverDayChangePercent: number | null;
  lowStockCount: number;
  pendingSalesCount: number;
  previousDayTotalRef: number;
  salesCount: number;
  totalRef: number;
  totalVes: number;
};

export type DashboardMetricsFilters = {
  from?: string;
  to?: string;
};

export type DashboardMetrics = {
  from: null | string;
  paidVes: number;
  pendingVes: number;
  salesCount: number;
  to: null | string;
  totalRef: number;
  totalVes: number;
  unitsSold: number;
};

export type DashboardLowStockProduct = Pick<
  ProductMock,
  "currentStock" | "id" | "minStock" | "name" | "sku"
> & {
  storeId?: string | null;
  storeName?: string;
};

export type DashboardSalesTrendFilters = {
  from?: string;
  to?: string;
};

/** Alcance opcional para dashboard de plataforma (multi-tienda). */
export type DashboardRequestScope = {
  enabled?: boolean;
  pathPrefix?: "/api/dashboard" | "/api/platform/home";
  storeIds?: string;
  storeScope?: "all" | "one" | "selected";
};

function dashboardPath(slug: string, scope?: DashboardRequestScope) {
  const prefix = scope?.pathPrefix ?? "/api/dashboard";
  return `${prefix}/${slug}`;
}

function withScopeQuery<T extends Record<string, unknown>>(
  filters: T,
  scope?: DashboardRequestScope,
) {
  if (scope?.pathPrefix !== "/api/platform/home") {
    return filters;
  }

  return {
    ...filters,
    storeIds: scope.storeIds,
    storeScope: scope.storeScope ?? "all",
  };
}

function scopeKey(scope?: DashboardRequestScope) {
  if (!scope || scope.pathPrefix !== "/api/platform/home") {
    return "store";
  }

  return {
    pathPrefix: scope.pathPrefix,
    storeIds: scope.storeIds ?? "",
    storeScope: scope.storeScope ?? "all",
  } as const;
}

export const dashboardQueryKeys = {
  all: ["dashboard"] as const,
  lowStock: (scope?: DashboardRequestScope) =>
    [...dashboardQueryKeys.all, "low-stock", scopeKey(scope)] as const,
  metrics: (filters: DashboardMetricsFilters = {}, scope?: DashboardRequestScope) =>
    [...dashboardQueryKeys.all, "metrics", scopeKey(scope), filters] as const,
  recentSales: (scope?: DashboardRequestScope) =>
    [...dashboardQueryKeys.all, "recent-sales", scopeKey(scope)] as const,
  salesTrend: (filters: DashboardSalesTrendFilters = {}, scope?: DashboardRequestScope) =>
    [...dashboardQueryKeys.all, "sales-trend", scopeKey(scope), filters] as const,
  summary: (scope?: DashboardRequestScope) =>
    [...dashboardQueryKeys.all, "summary", scopeKey(scope)] as const,
};

export function useDashboardSummary(scope?: DashboardRequestScope) {
  return useQuery({
    enabled: scope?.enabled ?? true,
    queryKey: dashboardQueryKeys.summary(scope),
    queryFn: () =>
      apiFetch<DashboardSummary>(dashboardPath("summary", scope), {
        query: withScopeQuery({}, scope),
      }),
  });
}

export function useDashboardMetrics(
  filters: DashboardMetricsFilters = {},
  scope?: DashboardRequestScope,
) {
  return useQuery({
    enabled: scope?.enabled ?? true,
    queryKey: dashboardQueryKeys.metrics(filters, scope),
    queryFn: () =>
      apiFetch<DashboardMetrics>(dashboardPath("metrics", scope), {
        query: withScopeQuery(filters, scope),
      }),
  });
}

export function useDashboardSalesTrend(
  filters: DashboardSalesTrendFilters = {},
  scope?: DashboardRequestScope,
) {
  return useQuery({
    enabled: scope?.enabled ?? true,
    queryKey: dashboardQueryKeys.salesTrend(filters, scope),
    queryFn: () =>
      apiFetch<{ items: DashboardSalesTrendPoint[] }>(dashboardPath("sales-trend", scope), {
        query: withScopeQuery(filters, scope),
      }),
  });
}

export function useDashboardRecentSales(
  filters: PaginationParams = {},
  scope?: DashboardRequestScope,
) {
  return useQuery({
    enabled: scope?.enabled ?? true,
    queryKey: [...dashboardQueryKeys.recentSales(scope), filters] as const,
    queryFn: () =>
      apiFetch<PaginatedList<DashboardRecentSale>>(dashboardPath("recent-sales", scope), {
        query: withScopeQuery(filters, scope),
      }),
  });
}

export function useDashboardLowStock(
  filters: PaginationParams = {},
  scope?: DashboardRequestScope,
) {
  return useQuery({
    enabled: scope?.enabled ?? true,
    queryKey: [...dashboardQueryKeys.lowStock(scope), filters] as const,
    queryFn: () =>
      apiFetch<PaginatedList<DashboardLowStockProduct>>(dashboardPath("low-stock", scope), {
        query: withScopeQuery(filters, scope),
      }),
  });
}
