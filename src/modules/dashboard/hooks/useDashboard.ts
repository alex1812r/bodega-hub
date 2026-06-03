"use client";

import { useQuery } from "@tanstack/react-query";

import type { PaginatedList, PaginationParams } from "@/lib/api/pagination";
import { apiFetch } from "@/shared/api/apiFetch";
import type { ProductMock, SaleMock } from "@/shared/mocks/erp-data";

export type DashboardSummary = {
  lowStockCount: number;
  pendingSalesCount: number;
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
>;

export const dashboardQueryKeys = {
  all: ["dashboard"] as const,
  lowStock: () => [...dashboardQueryKeys.all, "low-stock"] as const,
  metrics: (filters: DashboardMetricsFilters = {}) =>
    [...dashboardQueryKeys.all, "metrics", filters] as const,
  recentSales: () => [...dashboardQueryKeys.all, "recent-sales"] as const,
  summary: () => [...dashboardQueryKeys.all, "summary"] as const,
};

export function useDashboardSummary() {
  return useQuery({
    queryKey: dashboardQueryKeys.summary(),
    queryFn: () => apiFetch<DashboardSummary>("/api/dashboard/summary"),
  });
}

export function useDashboardMetrics(filters: DashboardMetricsFilters = {}) {
  return useQuery({
    queryKey: dashboardQueryKeys.metrics(filters),
    queryFn: () =>
      apiFetch<DashboardMetrics>("/api/dashboard/metrics", {
        query: filters,
      }),
  });
}

export function useDashboardRecentSales(filters: PaginationParams = {}) {
  return useQuery({
    queryKey: [...dashboardQueryKeys.recentSales(), filters] as const,
    queryFn: () =>
      apiFetch<PaginatedList<SaleMock>>("/api/dashboard/recent-sales", {
        query: filters,
      }),
  });
}

export function useDashboardLowStock(filters: PaginationParams = {}) {
  return useQuery({
    queryKey: [...dashboardQueryKeys.lowStock(), filters] as const,
    queryFn: () =>
      apiFetch<PaginatedList<DashboardLowStockProduct>>("/api/dashboard/low-stock", {
        query: filters,
      }),
  });
}
