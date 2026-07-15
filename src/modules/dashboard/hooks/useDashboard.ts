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
>;

export type DashboardSalesTrendFilters = {
  from?: string;
  to?: string;
};

export const dashboardQueryKeys = {
  all: ["dashboard"] as const,
  lowStock: () => [...dashboardQueryKeys.all, "low-stock"] as const,
  metrics: (filters: DashboardMetricsFilters = {}) =>
    [...dashboardQueryKeys.all, "metrics", filters] as const,
  recentSales: () => [...dashboardQueryKeys.all, "recent-sales"] as const,
  salesTrend: (filters: DashboardSalesTrendFilters = {}) =>
    [...dashboardQueryKeys.all, "sales-trend", filters] as const,
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

export function useDashboardSalesTrend(filters: DashboardSalesTrendFilters = {}) {
  return useQuery({
    queryKey: dashboardQueryKeys.salesTrend(filters),
    queryFn: () =>
      apiFetch<{ items: DashboardSalesTrendPoint[] }>("/api/dashboard/sales-trend", {
        query: filters,
      }),
  });
}

export function useDashboardRecentSales(filters: PaginationParams = {}) {
  return useQuery({
    queryKey: [...dashboardQueryKeys.recentSales(), filters] as const,
    queryFn: () =>
      apiFetch<PaginatedList<DashboardRecentSale>>("/api/dashboard/recent-sales", {
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
