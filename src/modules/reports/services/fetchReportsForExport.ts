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
  StockCardReportFilters,
  SupplierPurchasesReportRow,
  TopCustomersReportRow,
  TopProductsReportRow,
} from "../hooks/useReports";

export type ReportsExportFilters = {
  dateFilters: Pick<ReportDateRangeFilters, "from" | "to">;
  purchasesFilters: Pick<PurchasesReportFilters, "from" | "supplierId" | "to">;
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

/** Consulta la API en el momento de exportar (sin cache de UI). */
export async function fetchReportsForExport(
  filters: ReportsExportFilters,
): Promise<ReportsExportDataset> {
  const dateQuery = pickDateQuery(filters.dateFilters);
  const purchasesQuery = pickPurchasesQuery(filters.purchasesFilters);
  const productId = filters.stockCardFilters.productId?.trim();

  const stockCardPromise = productId
    ? fetchAllPaginatedItems<StockMovementMock>("/api/reports/stock-card", {
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
    fetchAllPaginatedItems<DailySalesReportRow>("/api/reports/daily-sales", dateQuery),
    fetchAllPaginatedItems<GrossProfitReportRow>("/api/reports/gross-profit", dateQuery),
    fetchAllPaginatedItems<ProductProfitabilityReportRow>(
      "/api/reports/product-profitability",
    ),
    fetchAllPaginatedItems<LowStockReportRow>("/api/reports/low-stock"),
    fetchAllPaginatedItems<CustomerPurchasesReportRow>(
      "/api/reports/customer-purchases",
    ),
    fetchAllPaginatedItems<SupplierPurchasesReportRow>(
      "/api/reports/supplier-purchases",
    ),
    stockCardPromise,
    fetchAllPaginatedItems<TopProductsReportRow>("/api/reports/top-products", dateQuery),
    fetchAllPaginatedItems<TopCustomersReportRow>("/api/reports/top-customers", dateQuery),
    fetchAllPaginatedItems<PurchasesReportRow>("/api/reports/purchases", purchasesQuery),
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
