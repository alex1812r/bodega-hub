import { fetchAllPaginatedItems } from "@/lib/api/fetchAllPaginatedItems";
import type { StockMovementMock } from "@/shared/mocks/erp-data";

import type {
  CustomerPurchasesReportRow,
  DailySalesReportRow,
  GrossProfitReportRow,
  LowStockReportRow,
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

export type ReportsExportFilters = {
  dateFilters: Pick<ReportDateRangeFilters, "from" | "to">;
  purchasesFilters: Pick<PurchasesReportFilters, "from" | "supplierId" | "to">;
  scope?: ReportRequestScope;
  stockCardFilters: Pick<StockCardReportFilters, "productId">;
};

export type ReportsExportDataset = {
  customerPurchases: CustomerPurchasesReportRow[];
  dailySales: DailySalesReportRow[];
  grossProfit: GrossProfitReportRow[];
  lowStock: LowStockReportRow[];
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
    dailySales,
    grossProfit,
    productProfitability,
    lowStock,
    customerPurchases,
    supplierPurchases,
    stockCard,
    topProducts,
    topCustomers,
    purchases,
  ] = await Promise.all([
    fetchAllPaginatedItems<DailySalesReportRow>(
      reportExportPath("daily-sales", scope),
      dateQuery,
    ),
    fetchAllPaginatedItems<GrossProfitReportRow>(
      reportExportPath("gross-profit", scope),
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
    dailySales,
    grossProfit,
    lowStock,
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
