"use client";

import { useQuery } from "@tanstack/react-query";

import type { PaginatedList, PaginationParams } from "@/lib/api/pagination";
import { apiFetch } from "@/shared/api/apiFetch";
import type {
  ContactMock,
  ProductMock,
  PurchaseMock,
  StockMovementMock,
} from "@/shared/mocks/erp-data";

export type ReportDateRangeFilters = PaginationParams & {
  from?: string;
  to?: string;
};

export type StockCardReportFilters = PaginationParams & {
  productId?: string;
};

export type PurchasesReportFilters = ReportDateRangeFilters & {
  supplierId?: string;
};

/** Alcance opcional para reportes de plataforma (multi-tienda). */
export type ReportRequestScope = {
  enabled?: boolean;
  pathPrefix?: "/api/reports" | "/api/platform/reports";
  storeIds?: string;
  storeScope?: "all" | "one" | "selected";
};

export type DailySalesReportRow = {
  paidVes: number;
  saleDate: string;
  salesCount: number;
  storeId?: string | null;
  totalRef: number;
  totalVes: number;
};

export type GrossProfitReportRow = {
  costRef: number;
  grossProfitRef: number;
  revenueRef: number;
  saleDate: string;
  storeId?: string | null;
};

export type ProductProfitabilityReportRow = {
  costRef: number;
  grossProfitRef: number;
  productId: string;
  sku: string;
  storeId?: string | null;
  unitsSold: number;
};

export type LowStockReportRow = Pick<
  ProductMock,
  "currentStock" | "id" | "minStock" | "name" | "sku"
> & {
  storeId?: string | null;
};

export type CustomerPurchasesReportRow = {
  customerId: string;
  lastPurchaseAt?: string;
  name: string;
  pendingVes: number;
  salesCount: number;
  storeId?: string | null;
  totalRef: number;
  totalVes: number;
};

export type SupplierPurchasesReportRow = {
  lastPurchaseAt?: string;
  name: string;
  pendingVes: number;
  purchasesCount: number;
  storeId?: string | null;
  supplierId: string;
  totalRef: number;
  totalVes: number;
};

export type TopProductsReportRow = {
  productId: string;
  revenueRef: number;
  sku: string;
  storeId?: string | null;
  unitsSold: number;
};

export type TopCustomersReportRow = {
  customerId: string;
  name: string;
  salesCount: number;
  storeId?: string | null;
  totalRef: number;
  totalVes: number;
};

export type PurchasesReportRow = PurchaseMock & {
  itemsCount: number;
  supplier?: ContactMock;
};

function reportPath(slug: string, scope?: ReportRequestScope) {
  const prefix = scope?.pathPrefix ?? "/api/reports";
  return `${prefix}/${slug}`;
}

function withScopeQuery<T extends Record<string, unknown>>(
  filters: T,
  scope?: ReportRequestScope,
) {
  if (scope?.pathPrefix !== "/api/platform/reports") {
    return filters;
  }

  return {
    ...filters,
    storeIds: scope.storeIds,
    storeScope: scope.storeScope ?? "all",
  };
}

function scopeKey(scope?: ReportRequestScope) {
  if (!scope || scope.pathPrefix !== "/api/platform/reports") {
    return "store";
  }

  return {
    pathPrefix: scope.pathPrefix,
    storeIds: scope.storeIds ?? "",
    storeScope: scope.storeScope ?? "all",
  } as const;
}

export const reportsQueryKeys = {
  all: ["reports"] as const,
  customerPurchases: (scope?: ReportRequestScope) =>
    [...reportsQueryKeys.all, "customer-purchases", scopeKey(scope)] as const,
  dailySales: (scope?: ReportRequestScope) =>
    [...reportsQueryKeys.all, "daily-sales", scopeKey(scope)] as const,
  grossProfit: (scope?: ReportRequestScope) =>
    [...reportsQueryKeys.all, "gross-profit", scopeKey(scope)] as const,
  lowStock: (scope?: ReportRequestScope) =>
    [...reportsQueryKeys.all, "low-stock", scopeKey(scope)] as const,
  productProfitability: (scope?: ReportRequestScope) =>
    [...reportsQueryKeys.all, "product-profitability", scopeKey(scope)] as const,
  purchases: (filters: PurchasesReportFilters = {}, scope?: ReportRequestScope) =>
    [...reportsQueryKeys.all, "purchases", scopeKey(scope), filters] as const,
  stockCard: (filters: StockCardReportFilters = {}, scope?: ReportRequestScope) =>
    [...reportsQueryKeys.all, "stock-card", scopeKey(scope), filters] as const,
  supplierPurchases: (scope?: ReportRequestScope) =>
    [...reportsQueryKeys.all, "supplier-purchases", scopeKey(scope)] as const,
  topCustomers: (filters: ReportDateRangeFilters = {}, scope?: ReportRequestScope) =>
    [...reportsQueryKeys.all, "top-customers", scopeKey(scope), filters] as const,
  topProducts: (filters: ReportDateRangeFilters = {}, scope?: ReportRequestScope) =>
    [...reportsQueryKeys.all, "top-products", scopeKey(scope), filters] as const,
};

export function useDailySalesReport(
  filters: PaginationParams = {},
  scope?: ReportRequestScope,
) {
  return useQuery({
    enabled: scope?.enabled ?? true,
    queryKey: [...reportsQueryKeys.dailySales(scope), filters] as const,
    queryFn: () =>
      apiFetch<PaginatedList<DailySalesReportRow>>(reportPath("daily-sales", scope), {
        query: withScopeQuery(filters, scope),
      }),
  });
}

export function useGrossProfitReport(
  filters: PaginationParams = {},
  scope?: ReportRequestScope,
) {
  return useQuery({
    enabled: scope?.enabled ?? true,
    queryKey: [...reportsQueryKeys.grossProfit(scope), filters] as const,
    queryFn: () =>
      apiFetch<PaginatedList<GrossProfitReportRow>>(reportPath("gross-profit", scope), {
        query: withScopeQuery(filters, scope),
      }),
  });
}

export function useProductProfitabilityReport(
  filters: PaginationParams = {},
  scope?: ReportRequestScope,
) {
  return useQuery({
    enabled: scope?.enabled ?? true,
    queryKey: [...reportsQueryKeys.productProfitability(scope), filters] as const,
    queryFn: () =>
      apiFetch<PaginatedList<ProductProfitabilityReportRow>>(
        reportPath("product-profitability", scope),
        { query: withScopeQuery(filters, scope) },
      ),
  });
}

export function useLowStockReport(
  filters: PaginationParams = {},
  scope?: ReportRequestScope,
) {
  return useQuery({
    enabled: scope?.enabled ?? true,
    queryKey: [...reportsQueryKeys.lowStock(scope), filters] as const,
    queryFn: () =>
      apiFetch<PaginatedList<LowStockReportRow>>(reportPath("low-stock", scope), {
        query: withScopeQuery(filters, scope),
      }),
  });
}

export function useCustomerPurchasesReport(
  filters: PaginationParams = {},
  scope?: ReportRequestScope,
) {
  return useQuery({
    enabled: scope?.enabled ?? true,
    queryKey: [...reportsQueryKeys.customerPurchases(scope), filters] as const,
    queryFn: () =>
      apiFetch<PaginatedList<CustomerPurchasesReportRow>>(
        reportPath("customer-purchases", scope),
        { query: withScopeQuery(filters, scope) },
      ),
  });
}

export function useSupplierPurchasesReport(
  filters: PaginationParams = {},
  scope?: ReportRequestScope,
) {
  return useQuery({
    enabled: scope?.enabled ?? true,
    queryKey: [...reportsQueryKeys.supplierPurchases(scope), filters] as const,
    queryFn: () =>
      apiFetch<PaginatedList<SupplierPurchasesReportRow>>(
        reportPath("supplier-purchases", scope),
        { query: withScopeQuery(filters, scope) },
      ),
  });
}

export function useStockCardReport(
  filters: StockCardReportFilters = {},
  scope?: ReportRequestScope,
) {
  return useQuery({
    enabled: scope?.enabled ?? true,
    queryKey: reportsQueryKeys.stockCard(filters, scope),
    queryFn: () =>
      apiFetch<PaginatedList<StockMovementMock>>(reportPath("stock-card", scope), {
        query: withScopeQuery(filters, scope),
      }),
  });
}

export function useTopProductsReport(
  filters: ReportDateRangeFilters = {},
  scope?: ReportRequestScope,
) {
  return useQuery({
    enabled: scope?.enabled ?? true,
    queryKey: reportsQueryKeys.topProducts(filters, scope),
    queryFn: () =>
      apiFetch<PaginatedList<TopProductsReportRow>>(reportPath("top-products", scope), {
        query: withScopeQuery(filters, scope),
      }),
  });
}

export function useTopCustomersReport(
  filters: ReportDateRangeFilters = {},
  scope?: ReportRequestScope,
) {
  return useQuery({
    enabled: scope?.enabled ?? true,
    queryKey: reportsQueryKeys.topCustomers(filters, scope),
    queryFn: () =>
      apiFetch<PaginatedList<TopCustomersReportRow>>(reportPath("top-customers", scope), {
        query: withScopeQuery(filters, scope),
      }),
  });
}

export function usePurchasesReport(
  filters: PurchasesReportFilters = {},
  scope?: ReportRequestScope,
) {
  return useQuery({
    enabled: scope?.enabled ?? true,
    queryKey: reportsQueryKeys.purchases(filters, scope),
    queryFn: () =>
      apiFetch<PaginatedList<PurchasesReportRow>>(reportPath("purchases", scope), {
        query: withScopeQuery(filters, scope),
      }),
  });
}
