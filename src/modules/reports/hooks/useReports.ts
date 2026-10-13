"use client";

import { useQuery } from "@tanstack/react-query";

import type { PaginatedList, PaginationParams } from "@/lib/api/pagination";
import type { DailyCloseSummary } from "../services/dailyCloseSummary";
import type { PaymentMethodsReportComparison } from "../services/paymentMethodsReport";
import type {
  DailySalesSeries,
  GrossProfitSeries,
  PurchasesReportStatusFilter,
  PurchasesSeries,
  ReportGroupBy,
} from "../services/reportSeries";
import { apiFetch } from "@/shared/api/apiFetch";
import type {
  ContactMock,
  PaymentMethod,
  ProductMock,
  PurchaseMock,
  StockMovementMock,
} from "@/shared/mocks/erp-data";

export type ReportDateRangeFilters = PaginationParams & {
  /**
   * Pide el periodo anterior (mismo nº de días justo antes de `from`). Viaja
   * como `compare=1`. Necesita `from` y `to`.
   */
  compare?: boolean;
  from?: string;
  fromStart?: boolean;
  /**
   * Agrupación de la serie; `"auto"` deja que el servidor elija según el nº de
   * días. Con `groupBy` o `compare` (y `from` + `to`) la respuesta trae `series`.
   */
  groupBy?: ReportGroupBy | "auto";
  to?: string;
};

export type StockCardReportFilters = PaginationParams & {
  productId?: string;
};

export type PurchasesReportFilters = ReportDateRangeFilters & {
  /**
   * Estados que entran en la tabla Y en la serie. Sin valor: todas menos
   * canceladas y devueltas; `"all"`: todas; o un estado concreto.
   */
  status?: PurchasesReportStatusFilter;
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
  /** Nombre del producto: es lo que se muestra; `productId` es solo la clave. */
  name?: string;
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
  /** Nombre del producto: es lo que se muestra; `productId` es solo la clave. */
  name?: string;
  productId: string;
  revenueRef: number;
  sku: string;
  storeId?: string | null;
  unitsSold: number;
};

/** Movimiento del kardex con el nombre y el SKU del producto (vista `stock_card`). */
export type StockCardReportRow = StockMovementMock & {
  productName?: string;
  sku?: string;
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

export type FxDepreciationReportRow = {
  invoiceNumber: string;
  lossRef: number;
  rateAtSale: number;
  saleDate: string;
  saleId: string;
  storeId?: string | null;
  totalRef: number;
  usdRef: number;
  vesCollected: number;
  vesRefAtCollection: number;
  vesRefToday: number;
};

export type FxDepreciationMethodBreakdown = {
  amountRef: number;
  amountVes: number;
  exposedToFx: boolean;
  lossRef: number;
  method: string;
  paymentCount: number;
  refToday: number;
};

export type FxDepreciationReportSummary = {
  byMethod: FxDepreciationMethodBreakdown[];
  capitalLossRef: number;
  capitalRefAtCollection: number;
  capitalRefToday: number;
  depreciationPctOnVes: number;
  generatedAt: string;
  usdHeldRef: number;
  valuationRateAt: string | null;
  valuationRateVes: number;
  vesExposed: number;
  vesLossRef: number;
  vesRefAtCollection: number;
  vesRefToday: number;
};

export type FxDepreciationReportResult = PaginatedList<FxDepreciationReportRow> & {
  summary: FxDepreciationReportSummary;
};

export type PaymentMethodReportRow = {
  amountRef: number;
  amountVes: number;
  method: PaymentMethod;
  paymentCount: number;
};

export type PaymentMethodsReportSummary = {
  paymentCount: number;
  totalRef: number;
  totalVes: number;
};

export type PaymentMethodsReportResult = PaginatedList<PaymentMethodReportRow> & {
  /** Solo con `compare`. */
  comparison?: PaymentMethodsReportComparison;
  summary: PaymentMethodsReportSummary;
};

/** `series` solo llega con `from` + `to` y (`groupBy` o `compare`). */
export type DailySalesReportResult = PaginatedList<DailySalesReportRow> & {
  series?: DailySalesSeries;
};

export type GrossProfitReportResult = PaginatedList<GrossProfitReportRow> & {
  series?: GrossProfitSeries;
};

export type PurchasesReportResult = PaginatedList<PurchasesReportRow> & {
  series?: PurchasesSeries;
};

/** Filtros de fecha como query: `compare` → `1`, y "desde el inicio" sin `from`. */
function toDateRangeQuery<T extends ReportDateRangeFilters>(filters: T) {
  return {
    ...filters,
    compare: filters.compare ? 1 : undefined,
    from: filters.fromStart ? undefined : filters.from,
    fromStart: filters.fromStart ? 1 : undefined,
  };
}

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
  dailyClose: (filters: ReportDateRangeFilters = {}, scope?: ReportRequestScope) =>
    [...reportsQueryKeys.all, "daily-close", scopeKey(scope), filters] as const,
  dailySales: (scope?: ReportRequestScope) =>
    [...reportsQueryKeys.all, "daily-sales", scopeKey(scope)] as const,
  fxDepreciation: (filters: ReportDateRangeFilters = {}, scope?: ReportRequestScope) =>
    [...reportsQueryKeys.all, "fx-depreciation", scopeKey(scope), filters] as const,
  grossProfit: (scope?: ReportRequestScope) =>
    [...reportsQueryKeys.all, "gross-profit", scopeKey(scope)] as const,
  paymentMethods: (filters: ReportDateRangeFilters = {}, scope?: ReportRequestScope) =>
    [...reportsQueryKeys.all, "payment-methods", scopeKey(scope), filters] as const,
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
  filters: ReportDateRangeFilters = {},
  scope?: ReportRequestScope,
) {
  return useQuery({
    enabled: scope?.enabled ?? true,
    queryKey: [...reportsQueryKeys.dailySales(scope), filters] as const,
    queryFn: () =>
      apiFetch<DailySalesReportResult>(reportPath("daily-sales", scope), {
        query: withScopeQuery(toDateRangeQuery(filters), scope),
      }),
  });
}

export function useGrossProfitReport(
  filters: ReportDateRangeFilters = {},
  scope?: ReportRequestScope,
) {
  return useQuery({
    enabled: scope?.enabled ?? true,
    queryKey: [...reportsQueryKeys.grossProfit(scope), filters] as const,
    queryFn: () =>
      apiFetch<GrossProfitReportResult>(reportPath("gross-profit", scope), {
        query: withScopeQuery(toDateRangeQuery(filters), scope),
      }),
  });
}

export function useFxDepreciationReport(
  filters: ReportDateRangeFilters = {},
  scope?: ReportRequestScope,
) {
  return useQuery({
    enabled: scope?.enabled ?? true,
    queryKey: reportsQueryKeys.fxDepreciation(filters, scope),
    queryFn: () =>
      apiFetch<FxDepreciationReportResult>(reportPath("fx-depreciation", scope), {
        query: withScopeQuery(filters, scope),
      }),
  });
}

export function useDailyCloseReport(
  filters: ReportDateRangeFilters = {},
  scope?: ReportRequestScope,
) {
  return useQuery({
    enabled: scope?.enabled ?? true,
    queryKey: reportsQueryKeys.dailyClose(filters, scope),
    queryFn: () =>
      apiFetch<DailyCloseSummary>(reportPath("daily-close", scope), {
        query: withScopeQuery(
          {
            ...filters,
            from: filters.fromStart ? undefined : filters.from,
            fromStart: filters.fromStart ? 1 : undefined,
          },
          scope,
        ),
      }),
  });
}

export function usePaymentMethodsReport(
  filters: ReportDateRangeFilters = {},
  scope?: ReportRequestScope,
) {
  return useQuery({
    enabled: scope?.enabled ?? true,
    queryKey: reportsQueryKeys.paymentMethods(filters, scope),
    queryFn: () =>
      apiFetch<PaymentMethodsReportResult>(reportPath("payment-methods", scope), {
        query: withScopeQuery(toDateRangeQuery(filters), scope),
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
      apiFetch<PaginatedList<StockCardReportRow>>(reportPath("stock-card", scope), {
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
      apiFetch<PurchasesReportResult>(reportPath("purchases", scope), {
        query: withScopeQuery(toDateRangeQuery(filters), scope),
      }),
  });
}
