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

export type DailySalesReportRow = {
  paidVes: number;
  saleDate: string;
  salesCount: number;
  totalRef: number;
  totalVes: number;
};

export type GrossProfitReportRow = {
  costRef: number;
  grossProfitRef: number;
  revenueRef: number;
  saleDate: string;
};

export type ProductProfitabilityReportRow = {
  costRef: number;
  grossProfitRef: number;
  productId: string;
  sku: string;
  unitsSold: number;
};

export type LowStockReportRow = Pick<
  ProductMock,
  "currentStock" | "id" | "minStock" | "name" | "sku"
>;

export type CustomerPurchasesReportRow = {
  customerId: string;
  lastPurchaseAt?: string;
  name: string;
  pendingVes: number;
  salesCount: number;
  totalRef: number;
  totalVes: number;
};

export type SupplierPurchasesReportRow = {
  lastPurchaseAt?: string;
  name: string;
  pendingVes: number;
  purchasesCount: number;
  supplierId: string;
  totalRef: number;
  totalVes: number;
};

export type TopProductsReportRow = {
  productId: string;
  revenueRef: number;
  sku: string;
  unitsSold: number;
};

export type TopCustomersReportRow = {
  customerId: string;
  name: string;
  salesCount: number;
  totalRef: number;
  totalVes: number;
};

export type PurchasesReportRow = PurchaseMock & {
  itemsCount: number;
  supplier?: ContactMock;
};

export const reportsQueryKeys = {
  all: ["reports"] as const,
  customerPurchases: () =>
    [...reportsQueryKeys.all, "customer-purchases"] as const,
  dailySales: () => [...reportsQueryKeys.all, "daily-sales"] as const,
  grossProfit: () => [...reportsQueryKeys.all, "gross-profit"] as const,
  lowStock: () => [...reportsQueryKeys.all, "low-stock"] as const,
  productProfitability: () =>
    [...reportsQueryKeys.all, "product-profitability"] as const,
  purchases: (filters: PurchasesReportFilters = {}) =>
    [...reportsQueryKeys.all, "purchases", filters] as const,
  stockCard: (filters: StockCardReportFilters = {}) =>
    [...reportsQueryKeys.all, "stock-card", filters] as const,
  supplierPurchases: () =>
    [...reportsQueryKeys.all, "supplier-purchases"] as const,
  topCustomers: (filters: ReportDateRangeFilters = {}) =>
    [...reportsQueryKeys.all, "top-customers", filters] as const,
  topProducts: (filters: ReportDateRangeFilters = {}) =>
    [...reportsQueryKeys.all, "top-products", filters] as const,
};

export function useDailySalesReport(filters: PaginationParams = {}) {
  return useQuery({
    queryKey: [...reportsQueryKeys.dailySales(), filters] as const,
    queryFn: () =>
      apiFetch<PaginatedList<DailySalesReportRow>>("/api/reports/daily-sales", {
        query: filters,
      }),
  });
}

export function useGrossProfitReport(filters: PaginationParams = {}) {
  return useQuery({
    queryKey: [...reportsQueryKeys.grossProfit(), filters] as const,
    queryFn: () =>
      apiFetch<PaginatedList<GrossProfitReportRow>>("/api/reports/gross-profit", {
        query: filters,
      }),
  });
}

export function useProductProfitabilityReport(filters: PaginationParams = {}) {
  return useQuery({
    queryKey: [...reportsQueryKeys.productProfitability(), filters] as const,
    queryFn: () =>
      apiFetch<PaginatedList<ProductProfitabilityReportRow>>(
        "/api/reports/product-profitability",
        { query: filters },
      ),
  });
}

export function useLowStockReport(filters: PaginationParams = {}) {
  return useQuery({
    queryKey: [...reportsQueryKeys.lowStock(), filters] as const,
    queryFn: () =>
      apiFetch<PaginatedList<LowStockReportRow>>("/api/reports/low-stock", {
        query: filters,
      }),
  });
}

export function useCustomerPurchasesReport(filters: PaginationParams = {}) {
  return useQuery({
    queryKey: [...reportsQueryKeys.customerPurchases(), filters] as const,
    queryFn: () =>
      apiFetch<PaginatedList<CustomerPurchasesReportRow>>(
        "/api/reports/customer-purchases",
        { query: filters },
      ),
  });
}

export function useSupplierPurchasesReport(filters: PaginationParams = {}) {
  return useQuery({
    queryKey: [...reportsQueryKeys.supplierPurchases(), filters] as const,
    queryFn: () =>
      apiFetch<PaginatedList<SupplierPurchasesReportRow>>(
        "/api/reports/supplier-purchases",
        { query: filters },
      ),
  });
}

export function useStockCardReport(filters: StockCardReportFilters = {}) {
  return useQuery({
    queryKey: reportsQueryKeys.stockCard(filters),
    queryFn: () =>
      apiFetch<PaginatedList<StockMovementMock>>("/api/reports/stock-card", {
        query: filters,
      }),
  });
}

export function useTopProductsReport(filters: ReportDateRangeFilters = {}) {
  return useQuery({
    queryKey: reportsQueryKeys.topProducts(filters),
    queryFn: () =>
      apiFetch<PaginatedList<TopProductsReportRow>>("/api/reports/top-products", {
        query: filters,
      }),
  });
}

export function useTopCustomersReport(filters: ReportDateRangeFilters = {}) {
  return useQuery({
    queryKey: reportsQueryKeys.topCustomers(filters),
    queryFn: () =>
      apiFetch<PaginatedList<TopCustomersReportRow>>("/api/reports/top-customers", {
        query: filters,
      }),
  });
}

export function usePurchasesReport(filters: PurchasesReportFilters = {}) {
  return useQuery({
    queryKey: reportsQueryKeys.purchases(filters),
    queryFn: () =>
      apiFetch<PaginatedList<PurchasesReportRow>>("/api/reports/purchases", {
        query: filters,
      }),
  });
}
