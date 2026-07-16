"use client";

import type { UseQueryResult } from "@tanstack/react-query";

import { getPaginatedItems, type PaginatedList, type PaginationParams } from "@/lib/api/pagination";
import { ResponsivePagination, usePaginationState } from "@/shared/components/Pagination";
import { DataTable, type DataTableColumn } from "@/shared/components/DataTable";
import type { StockMovementMock } from "@/shared/mocks/erp-data";
import { formatRef, formatVes } from "@/shared/utils/currency";
import { formatDate } from "@/shared/utils/date";

import {
  type CustomerPurchasesReportRow,
  type DailySalesReportRow,
  type GrossProfitReportRow,
  type LowStockReportRow,
  type ProductProfitabilityReportRow,
  type PurchasesReportFilters,
  type PurchasesReportRow,
  type ReportDateRangeFilters,
  type ReportRequestScope,
  type StockCardReportFilters,
  type SupplierPurchasesReportRow,
  type TopCustomersReportRow,
  type TopProductsReportRow,
  useCustomerPurchasesReport,
  useDailySalesReport,
  useGrossProfitReport,
  useLowStockReport,
  useProductProfitabilityReport,
  usePurchasesReport,
  useStockCardReport,
  useSupplierPurchasesReport,
  useTopCustomersReport,
  useTopProductsReport,
} from "../../hooks/useReports";
import { type ReportDefinition } from "../config/reportCatalog";

const dailySalesColumns: DataTableColumn<DailySalesReportRow>[] = [
  { header: "Fecha", key: "saleDate", render: (row) => formatDate(row.saleDate) },
  { align: "right", header: "Ventas", key: "salesCount", render: (row) => row.salesCount },
  { align: "right", header: "Total ref", key: "totalRef", render: (row) => formatRef(row.totalRef) },
  { align: "right", header: "Total VES", key: "totalVes", render: (row) => formatVes(row.totalVes) },
  { align: "right", header: "Cobrado VES", key: "paidVes", render: (row) => formatVes(row.paidVes) },
];

const grossProfitColumns: DataTableColumn<GrossProfitReportRow>[] = [
  { header: "Fecha", key: "saleDate", render: (row) => formatDate(row.saleDate) },
  { align: "right", header: "Ingresos", key: "revenueRef", render: (row) => formatRef(row.revenueRef) },
  { align: "right", header: "Costos", key: "costRef", render: (row) => formatRef(row.costRef) },
  { align: "right", header: "Ganancia", key: "grossProfitRef", render: (row) => formatRef(row.grossProfitRef) },
];

const productProfitabilityColumns: DataTableColumn<ProductProfitabilityReportRow>[] = [
  { header: "Producto", key: "productId", render: (row) => row.productId },
  { header: "SKU", key: "sku", render: (row) => row.sku },
  { align: "right", header: "Unidades", key: "unitsSold", render: (row) => row.unitsSold },
  { align: "right", header: "Costo", key: "costRef", render: (row) => formatRef(row.costRef) },
  { align: "right", header: "Ganancia", key: "grossProfitRef", render: (row) => formatRef(row.grossProfitRef) },
];

const lowStockColumns: DataTableColumn<LowStockReportRow>[] = [
  { header: "Producto", key: "name", render: (row) => row.name },
  { header: "SKU", key: "sku", render: (row) => row.sku },
  { align: "right", header: "Stock", key: "currentStock", render: (row) => row.currentStock },
  { align: "right", header: "Minimo", key: "minStock", render: (row) => row.minStock },
];

const customerPurchasesColumns: DataTableColumn<CustomerPurchasesReportRow>[] = [
  { header: "Cliente", key: "name", render: (row) => row.name },
  { align: "right", header: "Ventas", key: "salesCount", render: (row) => row.salesCount },
  { align: "right", header: "Total ref", key: "totalRef", render: (row) => formatRef(row.totalRef) },
  { align: "right", header: "Pendiente VES", key: "pendingVes", render: (row) => formatVes(row.pendingVes) },
  {
    header: "Ultima compra",
    key: "lastPurchaseAt",
    render: (row) => (row.lastPurchaseAt ? formatDate(row.lastPurchaseAt) : "Sin compras"),
  },
];

const supplierPurchasesColumns: DataTableColumn<SupplierPurchasesReportRow>[] = [
  { header: "Proveedor", key: "name", render: (row) => row.name },
  { align: "right", header: "Compras", key: "purchasesCount", render: (row) => row.purchasesCount },
  { align: "right", header: "Total ref", key: "totalRef", render: (row) => formatRef(row.totalRef) },
  { align: "right", header: "Pendiente VES", key: "pendingVes", render: (row) => formatVes(row.pendingVes) },
  {
    header: "Ultima compra",
    key: "lastPurchaseAt",
    render: (row) => (row.lastPurchaseAt ? formatDate(row.lastPurchaseAt) : "Sin compras"),
  },
];

const stockCardColumns: DataTableColumn<StockMovementMock>[] = [
  { header: "Fecha", key: "createdAt", render: (row) => formatDate(row.createdAt) },
  { header: "Producto", key: "productId", render: (row) => row.productId },
  { header: "Tipo", key: "type", render: (row) => row.type },
  { align: "right", header: "Movimiento", key: "quantityDelta", render: (row) => row.quantityDelta },
  { align: "right", header: "Stock final", key: "stockAfter", render: (row) => row.stockAfter },
];

const topProductsColumns: DataTableColumn<TopProductsReportRow>[] = [
  { header: "Producto", key: "productId", render: (row) => row.productId },
  { header: "SKU", key: "sku", render: (row) => row.sku },
  { align: "right", header: "Unidades", key: "unitsSold", render: (row) => row.unitsSold },
  { align: "right", header: "Ingreso ref", key: "revenueRef", render: (row) => formatRef(row.revenueRef) },
];

const topCustomersColumns: DataTableColumn<TopCustomersReportRow>[] = [
  { header: "Cliente", key: "name", render: (row) => row.name },
  { align: "right", header: "Ventas", key: "salesCount", render: (row) => row.salesCount },
  { align: "right", header: "Total ref", key: "totalRef", render: (row) => formatRef(row.totalRef) },
  { align: "right", header: "Total VES", key: "totalVes", render: (row) => formatVes(row.totalVes) },
];

const purchasesColumns: DataTableColumn<PurchasesReportRow>[] = [
  { header: "Compra", key: "purchaseNumber", render: (row) => row.purchaseNumber },
  { header: "Proveedor", key: "supplier", render: (row) => row.supplier?.name ?? row.supplierId },
  { header: "Fecha", key: "createdAt", render: (row) => formatDate(row.createdAt) },
  { align: "right", header: "Items", key: "itemsCount", render: (row) => row.itemsCount },
  { align: "right", header: "Total VES", key: "totalVes", render: (row) => formatVes(row.totalVes) },
];

function formatResultsRange(skip: number, limit: number, total: number) {
  if (total === 0) {
    return "Sin registros";
  }

  const start = skip + 1;
  const end = Math.min(skip + limit, total);
  return `Mostrando ${start}-${end} de ${total} registros`;
}

type ReportTableProps<TData> = {
  columns: DataTableColumn<TData>[];
  getRowId: (row: TData) => string;
  limit: number;
  onLimitChange: (limit: number) => void;
  onSkipChange: (skip: number) => void;
  query: UseQueryResult<PaginatedList<TData>, Error>;
  report: ReportDefinition;
  skip: number;
};

function ReportTable<TData>({
  columns,
  getRowId,
  limit,
  onLimitChange,
  onSkipChange,
  query,
  report,
  skip,
}: ReportTableProps<TData>) {
  const total = query.data?.total ?? 0;
  const currentSkip = query.data?.skip ?? skip;

  return (
    <section className="overflow-hidden rounded-lg border border-outline-variant bg-surface-container-lowest shadow-sm">
      <div className="flex flex-col gap-2 border-b border-outline-variant bg-surface-container-low px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-base font-semibold text-on-surface">
            Resultados: {report.name}
          </h3>
          {report.ignoresGlobalFilters ? (
            <p className="mt-0.5 text-xs text-on-surface-variant">
              Los filtros globales no aplican a este reporte.
            </p>
          ) : null}
        </div>
        <span className="text-xs text-on-surface-variant">
          {formatResultsRange(currentSkip, limit, total)}
        </span>
      </div>

      <DataTable
        columns={columns}
        data={getPaginatedItems(query.data)}
        embedded
        error={query.error}
        getRowId={getRowId}
        isFetching={query.isFetching}
        isLoading={query.isLoading}
        layout="table"
        loadingRows={5}
        onRetry={() => void query.refetch()}
        variant="stitch"
      />

      <div className="flex justify-center border-t border-outline-variant px-4 py-3">
        <ResponsivePagination
          className="w-full justify-end"
          isDisabled={query.isFetching}
          limit={limit}
          onLimitChange={onLimitChange}
          onSkipChange={onSkipChange}
          showSummary={false}
          skip={currentSkip}
          total={total}
          variant="stitch"
        />
      </div>
    </section>
  );
}

function useReportPagination(resetDeps: readonly unknown[] = []) {
  return usePaginationState(resetDeps);
}

function PaginatedReportTable<TData>({
  columns,
  filters = {},
  getRowId,
  report,
  resetDeps = [],
  useReport,
}: {
  columns: DataTableColumn<TData>[];
  filters?: PaginationParams;
  getRowId: (row: TData) => string;
  report: ReportDefinition;
  resetDeps?: readonly unknown[];
  useReport: (filters: PaginationParams) => UseQueryResult<PaginatedList<TData>, Error>;
}) {
  const pagination = useReportPagination(resetDeps);
  const query = useReport({
    ...filters,
    limit: pagination.limit,
    skip: pagination.skip,
  });

  return (
    <ReportTable
      columns={columns}
      getRowId={getRowId}
      limit={pagination.limit}
      onLimitChange={pagination.setLimit}
      onSkipChange={pagination.setSkip}
      query={query}
      report={report}
      skip={pagination.skip}
    />
  );
}

type ReportsResultPanelProps = {
  dateFilters: ReportDateRangeFilters;
  purchasesFilters: PurchasesReportFilters;
  report: ReportDefinition;
  scope?: ReportRequestScope;
  stockCardFilters: StockCardReportFilters;
};

export function ReportsResultPanel({
  dateFilters,
  purchasesFilters,
  report,
  scope,
  stockCardFilters,
}: ReportsResultPanelProps) {
  const scopeResetDeps = [scope?.pathPrefix, scope?.storeScope, scope?.storeIds, scope?.enabled];

  switch (report.id) {
    case "daily-sales":
      return (
        <PaginatedReportTable
          columns={dailySalesColumns}
          getRowId={(row) => `${row.saleDate}-${row.totalVes}-${row.paidVes}-${row.storeId ?? ""}`}
          report={report}
          resetDeps={scopeResetDeps}
          useReport={(filters) => useDailySalesReport(filters, scope)}
        />
      );
    case "gross-profit":
      return (
        <PaginatedReportTable
          columns={grossProfitColumns}
          getRowId={(row) => `${row.saleDate}-${row.revenueRef}-${row.costRef}-${row.storeId ?? ""}`}
          report={report}
          resetDeps={scopeResetDeps}
          useReport={(filters) => useGrossProfitReport(filters, scope)}
        />
      );
    case "product-profitability":
      return (
        <PaginatedReportTable
          columns={productProfitabilityColumns}
          getRowId={(row) => row.productId}
          report={report}
          resetDeps={scopeResetDeps}
          useReport={(filters) => useProductProfitabilityReport(filters, scope)}
        />
      );
    case "low-stock":
      return (
        <PaginatedReportTable
          columns={lowStockColumns}
          getRowId={(row) => row.id}
          report={report}
          resetDeps={scopeResetDeps}
          useReport={(filters) => useLowStockReport(filters, scope)}
        />
      );
    case "customer-purchases":
      return (
        <PaginatedReportTable
          columns={customerPurchasesColumns}
          getRowId={(row) => row.customerId}
          report={report}
          resetDeps={scopeResetDeps}
          useReport={(filters) => useCustomerPurchasesReport(filters, scope)}
        />
      );
    case "supplier-purchases":
      return (
        <PaginatedReportTable
          columns={supplierPurchasesColumns}
          getRowId={(row) => row.supplierId}
          report={report}
          resetDeps={scopeResetDeps}
          useReport={(filters) => useSupplierPurchasesReport(filters, scope)}
        />
      );
    case "stock-card":
      return (
        <PaginatedReportTable
          columns={stockCardColumns}
          filters={stockCardFilters}
          getRowId={(row) => row.id}
          report={report}
          resetDeps={[...scopeResetDeps, stockCardFilters.productId]}
          useReport={(filters) => useStockCardReport(filters, scope)}
        />
      );
    case "top-products":
      return (
        <PaginatedReportTable
          columns={topProductsColumns}
          filters={dateFilters}
          getRowId={(row) => row.productId}
          report={report}
          resetDeps={[...scopeResetDeps, dateFilters.from, dateFilters.to]}
          useReport={(filters) => useTopProductsReport(filters, scope)}
        />
      );
    case "top-customers":
      return (
        <PaginatedReportTable
          columns={topCustomersColumns}
          filters={dateFilters}
          getRowId={(row) => row.customerId}
          report={report}
          resetDeps={[...scopeResetDeps, dateFilters.from, dateFilters.to]}
          useReport={(filters) => useTopCustomersReport(filters, scope)}
        />
      );
    case "purchases":
      return (
        <PaginatedReportTable
          columns={purchasesColumns}
          filters={purchasesFilters}
          getRowId={(row) => row.id}
          report={report}
          resetDeps={[
            ...scopeResetDeps,
            purchasesFilters.from,
            purchasesFilters.to,
            purchasesFilters.supplierId,
          ]}
          useReport={(filters) => usePurchasesReport(filters, scope)}
        />
      );
    default:
      return null;
  }
}
