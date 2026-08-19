import { fetchAllPaginatedItems } from "@/lib/api/fetchAllPaginatedItems";
import type { StockMovementMock } from "@/shared/mocks/erp-data";

import type {
  CustomerPurchasesReportRow,
  DailySalesReportRow,
  FxDepreciationReportRow,
  GrossProfitReportRow,
  LowStockReportRow,
  PaymentMethodReportRow,
  ProductProfitabilityReportRow,
  PurchasesReportFilters,
  PurchasesReportRow,
  ReportDateRangeFilters,
  ReportRequestScope,
  StockCardReportFilters,
  SupplierPurchasesReportRow,
  TopCustomersReportRow,
  TopProductsReportRow,
} from "../hooks/useReports";
import type { DailyCloseSummary } from "./dailyCloseSummary";
import type { DailyCloseExportRow } from "../utils/reportExportSheetColumns";

export type ReportsExportFilters = {
  dateFilters: Pick<ReportDateRangeFilters, "from" | "to">;
  purchasesFilters: Pick<PurchasesReportFilters, "from" | "supplierId" | "to">;
  scope?: ReportRequestScope;
  stockCardFilters: Pick<StockCardReportFilters, "productId">;
};

export type ReportsExportDataset = {
  customerPurchases: CustomerPurchasesReportRow[];
  dailyClose: DailyCloseExportRow[];
  dailySales: DailySalesReportRow[];
  fxDepreciation: FxDepreciationReportRow[];
  fxDepreciationNote?: string;
  grossProfit: GrossProfitReportRow[];
  lowStock: LowStockReportRow[];
  paymentMethods: PaymentMethodReportRow[];
  productProfitability: ProductProfitabilityReportRow[];
  purchases: PurchasesReportRow[];
  stockCard: StockMovementMock[];
  stockCardNote?: string;
  supplierPurchases: SupplierPurchasesReportRow[];
  topCustomers: TopCustomersReportRow[];
  topProducts: TopProductsReportRow[];
};

function pickDateQuery(filters: Pick<ReportDateRangeFilters, "from" | "to">) {
  return {
    from: filters.from,
    to: filters.to,
  };
}

function pickPurchasesQuery(filters: ReportsExportFilters["purchasesFilters"]) {
  return {
    from: filters.from,
    supplierId: filters.supplierId,
    to: filters.to,
  };
}

function reportExportPath(slug: string, scope?: ReportRequestScope) {
  const prefix = scope?.pathPrefix ?? "/api/reports";
  return `${prefix}/${slug}`;
}

function withExportScopeQuery(
  query: Record<string, string | undefined>,
  scope?: ReportRequestScope,
) {
  if (scope?.pathPrefix !== "/api/platform/reports") {
    return query;
  }

  return {
    ...query,
    storeIds: scope.storeIds,
    storeScope: scope.storeScope ?? "all",
  };
}

/** Consulta la API en el momento de exportar (sin cache de UI). */
export async function fetchReportsForExport(
  filters: ReportsExportFilters,
): Promise<ReportsExportDataset> {
  const scope = filters.scope;
  const dateQuery = withExportScopeQuery(pickDateQuery(filters.dateFilters), scope);
  const purchasesQuery = withExportScopeQuery(
    pickPurchasesQuery(filters.purchasesFilters),
    scope,
  );
  const productId = filters.stockCardFilters.productId?.trim();

  const stockCardPromise = productId
    ? fetchAllPaginatedItems<StockMovementMock>(reportExportPath("stock-card", scope), {
        ...withExportScopeQuery({}, scope),
        productId,
      })
    : Promise.resolve([] as StockMovementMock[]);

  const [
    dailyClose,
    dailySales,
    grossProfit,
    fxDepreciationResult,
    paymentMethods,
    productProfitability,
    lowStock,
    customerPurchases,
    supplierPurchases,
    stockCard,
    topProducts,
    topCustomers,
    purchases,
  ] = await Promise.all([
    fetchDailyCloseForExport(scope, dateQuery),
    fetchAllPaginatedItems<DailySalesReportRow>(
      reportExportPath("daily-sales", scope),
      dateQuery,
    ),
    fetchAllPaginatedItems<GrossProfitReportRow>(
      reportExportPath("gross-profit", scope),
      dateQuery,
    ),
    fetchFxDepreciationForExport(scope, dateQuery),
    fetchAllPaginatedItems<PaymentMethodReportRow>(
      reportExportPath("payment-methods", scope),
      dateQuery,
    ),
    fetchAllPaginatedItems<ProductProfitabilityReportRow>(
      reportExportPath("product-profitability", scope),
      withExportScopeQuery({}, scope),
    ),
    fetchAllPaginatedItems<LowStockReportRow>(
      reportExportPath("low-stock", scope),
      withExportScopeQuery({}, scope),
    ),
    fetchAllPaginatedItems<CustomerPurchasesReportRow>(
      reportExportPath("customer-purchases", scope),
      withExportScopeQuery({}, scope),
    ),
    fetchAllPaginatedItems<SupplierPurchasesReportRow>(
      reportExportPath("supplier-purchases", scope),
      withExportScopeQuery({}, scope),
    ),
    stockCardPromise,
    fetchAllPaginatedItems<TopProductsReportRow>(
      reportExportPath("top-products", scope),
      dateQuery,
    ),
    fetchAllPaginatedItems<TopCustomersReportRow>(
      reportExportPath("top-customers", scope),
      dateQuery,
    ),
    fetchAllPaginatedItems<PurchasesReportRow>(
      reportExportPath("purchases", scope),
      purchasesQuery,
    ),
  ]);

  return {
    customerPurchases,
    dailyClose,
    dailySales,
    fxDepreciation: fxDepreciationResult.rows,
    fxDepreciationNote: fxDepreciationResult.note,
    grossProfit,
    lowStock,
    paymentMethods,
    productProfitability,
    purchases,
    stockCard,
    stockCardNote: productId
      ? undefined
      : "Indique productId en filtros globales para exportar el kardex.",
    supplierPurchases,
    topCustomers,
    topProducts,
  };
}

async function fetchFxDepreciationForExport(
  scope: ReportRequestScope | undefined,
  dateQuery: Record<string, string | undefined>,
) {
  const { apiFetch } = await import("@/shared/api/apiFetch");
  type FxResult = {
    items: FxDepreciationReportRow[];
    summary?: {
      capitalRefToday: number;
      depreciationPctOnVes: number;
      valuationRateVes: number;
      vesLossRef: number;
    };
    total: number;
  };

  // Export all pages via fetchAllPaginatedItems; summary from first page.
  const first = await apiFetch<FxResult>(reportExportPath("fx-depreciation", scope), {
    query: { ...dateQuery, limit: 100, skip: 0 },
  });
  const rows = await fetchAllPaginatedItems<FxDepreciationReportRow>(
    reportExportPath("fx-depreciation", scope),
    dateQuery,
  );
  const summary = first.summary;
  const note = summary
    ? `Tasa valorizacion ${summary.valuationRateVes}; capital hoy REF ${summary.capitalRefToday}; perdida VES REF ${summary.vesLossRef} (${summary.depreciationPctOnVes}%).`
    : undefined;

  return { note, rows };
}

function flattenDailyClose(summary: DailyCloseSummary): DailyCloseExportRow[] {
  return [
    { metric: "Ventas", value: summary.sales.salesCount },
    { metric: "Total REF", value: summary.sales.totalRef },
    { metric: "Total VES", value: summary.sales.totalVes },
    { metric: "Pagos activos", value: summary.paymentsSummary.paymentCount },
    { metric: "Cobros REF", value: summary.paymentsSummary.totalRef },
    { metric: "Perdida FX REF", value: summary.fx.vesLossRef },
    { metric: "Capital REF hoy", value: summary.fx.capitalRefToday },
    {
      metric: "Baul REF",
      value: summary.vault ? summary.vault.balanceRef : "N/D",
    },
    {
      metric: "Caja teorica REF",
      value: summary.cash ? summary.cash.theoreticalOpenRef : "N/D",
    },
  ];
}

async function fetchDailyCloseForExport(
  scope: ReportRequestScope | undefined,
  dateQuery: Record<string, string | undefined>,
): Promise<DailyCloseExportRow[]> {
  const { apiFetch } = await import("@/shared/api/apiFetch");
  const summary = await apiFetch<DailyCloseSummary>(reportExportPath("daily-close", scope), {
    query: dateQuery,
  });
  return flattenDailyClose(summary);
}
