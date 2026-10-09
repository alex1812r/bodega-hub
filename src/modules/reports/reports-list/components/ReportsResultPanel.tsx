"use client";

import type { UseQueryResult } from "@tanstack/react-query";
import { useEffect, type ReactNode } from "react";

import { getPaginatedItems, type PaginatedList, type PaginationParams } from "@/lib/api/pagination";
import { RestockPurchaseButton } from "@/modules/inventory/restock";
import { ResponsivePagination, usePaginationState } from "@/shared/components/Pagination";
import { DataTable, type DataTableColumn } from "@/shared/components/DataTable";
import { formatDateRangeLabel } from "@/shared/components/DateRangeField";
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
import type {
  DailySalesSeriesMeasures,
  GrossProfitSeriesMeasures,
  PurchasesSeriesMeasures,
} from "../../services/reportSeries";
import { type ReportDefinition } from "../config/reportCatalog";
import { toReportDateFilters } from "../reportsListParams";
import { DailyCloseReportPanel } from "./DailyCloseReportPanel";
import { FxDepreciationReportPanel } from "./FxDepreciationReportPanel";
import { PaymentMethodsReportPanel } from "./PaymentMethodsReportPanel";
import { ReportRankingChart } from "./ReportRankingChart";
import { ReportSeriesChart, type ReportSeriesChartMeasure } from "./ReportSeriesChart";
import { ReportTableSection } from "./ReportTableSection";

// Una sola medida por gráfico de línea: la misma sobre la que el servicio calcula
// la variación. Así el periodo anterior y las etiquetas de pico se leen sin ruido.
const dailySalesMeasure: ReportSeriesChartMeasure<DailySalesSeriesMeasures> = {
  count: "count",
  countLabel: "ventas",
  name: "Ventas",
  totalLabel: "Total vendido",
  valueRef: "totalRef",
  valueVes: "totalVes",
};

const grossProfitMeasure: ReportSeriesChartMeasure<GrossProfitSeriesMeasures> = {
  name: "Ganancia bruta",
  totalLabel: "Ganancia bruta",
  valueRef: "grossProfitRef",
};

const purchasesMeasure: ReportSeriesChartMeasure<PurchasesSeriesMeasures> = {
  count: "count",
  countLabel: "compras",
  deltaTone: "neutral",
  name: "Compras",
  totalLabel: "Total comprado",
  valueRef: "totalRef",
  valueVes: "totalVes",
};

/** El servicio de rentabilidad ya devuelve el nombre del producto. */
type ProductProfitabilityChartRow = ProductProfitabilityReportRow & { name?: string };

function formatUnits(value: number) {
  return `${value.toLocaleString("es-VE", { maximumFractionDigits: 2 })} uds`;
}

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
  { align: "right", header: "Mínimo", key: "minStock", render: (row) => row.minStock },
];

const customerPurchasesColumns: DataTableColumn<CustomerPurchasesReportRow>[] = [
  { header: "Cliente", key: "name", render: (row) => row.name },
  { align: "right", header: "Ventas", key: "salesCount", render: (row) => row.salesCount },
  { align: "right", header: "Total ref", key: "totalRef", render: (row) => formatRef(row.totalRef) },
  { align: "right", header: "Pendiente VES", key: "pendingVes", render: (row) => formatVes(row.pendingVes) },
  {
    header: "Última compra",
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
    header: "Última compra",
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
  /** Acciones de la cabecera del reporte, junto al resumen de resultados. */
  actions?: ReactNode;
  columns: DataTableColumn<TData>[];
  getRowId: (row: TData) => string;
  limit: number;
  onLimitChange: (limit: number) => void;
  onSkipChange: (skip: number) => void;
  query: Pick<
    UseQueryResult<PaginatedList<TData>, Error>,
    "data" | "error" | "isFetching" | "isLoading" | "refetch"
  >;
  report: ReportDefinition;
  skip: number;
};

function ReportTable<TData>({
  actions,
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
        <h3 className="text-base font-semibold text-on-surface">Resultados: {report.name}</h3>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-on-surface-variant">
            {formatResultsRange(currentSkip, limit, total)}
          </span>
          {actions}
        </div>
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

/** Página y tamaño de la tabla del reporte (misma forma que `usePaginationState`). */
export type ReportPagination = {
  limit: number;
  setLimit: (limit: number) => void;
  setSkip: (skip: number) => void;
  skip: number;
};

function PaginatedReportTable<TData, TResult extends PaginatedList<TData> = PaginatedList<TData>>({
  columns,
  actions,
  chart,
  filters = {},
  getRowId,
  pagination: externalPagination,
  report,
  resetDeps = [],
  scope,
  useReport,
}: {
  actions?: ReactNode;
  /**
   * Gráfico del reporte, a partir de la misma consulta que la tabla. Con él la
   * tabla va debajo, en una sección plegable.
   */
  chart?: (query: UseQueryResult<TResult, Error>) => ReactNode;
  columns: DataTableColumn<TData>[];
  filters?: PaginationParams;
  getRowId: (row: TData) => string;
  /** Paginación guardada fuera (URL). Sin ella la tabla lleva la suya. */
  pagination?: ReportPagination;
  report: ReportDefinition;
  resetDeps?: readonly unknown[];
  scope?: ReportRequestScope;
  // Hook del reporte: se llama siempre, en el nivel superior de este componente.
  useReport: (
    filters: PaginationParams,
    scope?: ReportRequestScope,
  ) => UseQueryResult<TResult, Error>;
}) {
  // La paginación propia vuelve a la primera página al cambiar de reporte o de filtros.
  const localPagination = usePaginationState([report.id, ...resetDeps]);
  const pagination = externalPagination ?? localPagination;
  const { setSkip, skip } = pagination;
  const query = useReport(
    {
      ...filters,
      limit: pagination.limit,
      skip,
    },
    scope,
  );
  const { data, isFetching } = query;
  // La página pedida ya no existe (el total bajó, o la URL trae una página de más):
  // se vuelve a la primera en vez de mostrar "No hay registros" con datos disponibles.
  const isPagePastTheEnd =
    !isFetching && data !== undefined && data.items.length === 0 && data.total > 0 && skip > 0;

  useEffect(() => {
    if (isPagePastTheEnd) {
      setSkip(0);
    }
  }, [isPagePastTheEnd, setSkip]);

  const table = (
    <ReportTable
      actions={actions}
      columns={columns}
      getRowId={getRowId}
      limit={pagination.limit}
      onLimitChange={pagination.setLimit}
      onSkipChange={setSkip}
      query={query}
      report={report}
      skip={skip}
    />
  );

  if (!chart) {
    return table;
  }

  return (
    <div className="min-w-0 space-y-4">
      {chart(query)}
      <ReportTableSection
        summary={formatResultsRange(data?.skip ?? skip, pagination.limit, data?.total ?? 0)}
      >
        {table}
      </ReportTableSection>
    </div>
  );
}

type ReportsResultPanelProps = {
  /** Rango global (`from` / `to`) y, para los reportes que los admiten, `groupBy` y `compare`. */
  dateFilters: ReportDateRangeFilters;
  /**
   * Página y tamaño de la tabla del reporte activo guardados fuera (en la URL):
   * quien los guarda los reinicia al cambiar de reporte o de filtros. Sin esta
   * prop cada reporte lleva su propia paginación.
   */
  pagination?: ReportPagination;
  purchasesFilters: PurchasesReportFilters;
  report: ReportDefinition;
  scope?: ReportRequestScope;
  stockCardFilters: StockCardReportFilters;
};

/**
 * Resultado del reporte activo. Los reportes de serie (línea) y de ranking
 * (barras) llevan su gráfico encima y la tabla debajo, plegable; cierre del día,
 * depreciación FX, bajo stock y kardex son solo tabla o panel.
 */
export function ReportsResultPanel({
  dateFilters,
  pagination,
  purchasesFilters,
  report,
  scope,
  stockCardFilters,
}: ReportsResultPanelProps) {
  const scopeResetDeps = [scope?.pathPrefix, scope?.storeScope, scope?.storeIds, scope?.enabled];
  // Solo lo que este reporte admite: rango, y `groupBy` / `compare` en los de serie.
  // Con `groupBy` o `compare` la respuesta trae `series` (la consume el gráfico).
  const reportDateFilters = toReportDateFilters(report, dateFilters);
  const dateResetDeps = [
    ...scopeResetDeps,
    reportDateFilters.from,
    reportDateFilters.to,
    reportDateFilters.groupBy,
    reportDateFilters.compare,
  ];

  const rangeLabel = formatDateRangeLabel(reportDateFilters.from, reportDateFilters.to);

  // `key` por reporte: cada tabla monta su propio estado y nada se arrastra de un reporte a otro.
  switch (report.id) {
    case "daily-sales":
      return (
        <PaginatedReportTable
          chart={(query) => (
            <ReportSeriesChart
              error={query.error}
              filters={reportDateFilters}
              isLoading={query.isLoading}
              measure={dailySalesMeasure}
              onRetry={() => void query.refetch()}
              report={report}
              series={query.data?.series}
            />
          )}
          columns={dailySalesColumns}
          filters={reportDateFilters}
          getRowId={(row) => `${row.saleDate}-${row.totalVes}-${row.paidVes}-${row.storeId ?? ""}`}
          key={report.id}
          pagination={pagination}
          report={report}
          resetDeps={dateResetDeps}
          scope={scope}
          useReport={useDailySalesReport}
        />
      );
    case "gross-profit":
      return (
        <PaginatedReportTable
          chart={(query) => (
            <ReportSeriesChart
              error={query.error}
              filters={reportDateFilters}
              isLoading={query.isLoading}
              measure={grossProfitMeasure}
              onRetry={() => void query.refetch()}
              report={report}
              series={query.data?.series}
            />
          )}
          columns={grossProfitColumns}
          filters={reportDateFilters}
          getRowId={(row) => `${row.saleDate}-${row.revenueRef}-${row.costRef}-${row.storeId ?? ""}`}
          key={report.id}
          pagination={pagination}
          report={report}
          resetDeps={dateResetDeps}
          scope={scope}
          useReport={useGrossProfitReport}
        />
      );
    case "fx-depreciation":
      return (
        <FxDepreciationReportPanel
          dateFilters={reportDateFilters}
          pagination={pagination}
          scope={scope}
        />
      );
    case "daily-close":
      return <DailyCloseReportPanel dateFilters={reportDateFilters} scope={scope} />;
    case "payment-methods":
      return <PaymentMethodsReportPanel dateFilters={reportDateFilters} scope={scope} />;
    case "product-profitability":
      return (
        <PaginatedReportTable
          chart={(query) => (
            <ReportRankingChart
              error={query.error}
              isLoading={query.isLoading}
              items={getPaginatedItems(query.data).map((row: ProductProfitabilityChartRow) => ({
                id: row.productId,
                label: row.name || row.sku || row.productId,
                value: row.grossProfitRef,
              }))}
              measureLabel="Ganancia bruta en REF"
              onRetry={() => void query.refetch()}
              report={report}
            />
          )}
          columns={productProfitabilityColumns}
          getRowId={(row) => row.productId}
          key={report.id}
          pagination={pagination}
          report={report}
          resetDeps={scopeResetDeps}
          scope={scope}
          useReport={useProductProfitabilityReport}
        />
      );
    case "low-stock":
      return (
        <PaginatedReportTable
          // INV-05: la reposición es una compra de ESTA tienda; en plataforma (varias tiendas) no se ofrece.
          actions={scope ? undefined : <RestockPurchaseButton size="sm" />}
          columns={lowStockColumns}
          getRowId={(row) => row.id}
          key={report.id}
          pagination={pagination}
          report={report}
          resetDeps={scopeResetDeps}
          scope={scope}
          useReport={useLowStockReport}
        />
      );
    case "customer-purchases":
      return (
        <PaginatedReportTable
          chart={(query) => (
            <ReportRankingChart
              error={query.error}
              isLoading={query.isLoading}
              items={getPaginatedItems(query.data).map((row) => ({
                id: row.customerId,
                label: row.name,
                value: row.totalRef,
              }))}
              measureLabel="Total comprado en REF"
              onRetry={() => void query.refetch()}
              report={report}
            />
          )}
          columns={customerPurchasesColumns}
          getRowId={(row) => row.customerId}
          key={report.id}
          pagination={pagination}
          report={report}
          resetDeps={scopeResetDeps}
          scope={scope}
          useReport={useCustomerPurchasesReport}
        />
      );
    case "supplier-purchases":
      return (
        <PaginatedReportTable
          chart={(query) => (
            <ReportRankingChart
              error={query.error}
              isLoading={query.isLoading}
              items={getPaginatedItems(query.data).map((row) => ({
                id: row.supplierId,
                label: row.name,
                value: row.totalRef,
              }))}
              measureLabel="Total comprado en REF"
              onRetry={() => void query.refetch()}
              report={report}
            />
          )}
          columns={supplierPurchasesColumns}
          getRowId={(row) => row.supplierId}
          key={report.id}
          pagination={pagination}
          report={report}
          resetDeps={scopeResetDeps}
          scope={scope}
          useReport={useSupplierPurchasesReport}
        />
      );
    case "stock-card":
      return (
        <PaginatedReportTable
          columns={stockCardColumns}
          filters={stockCardFilters}
          getRowId={(row) => row.id}
          key={report.id}
          pagination={pagination}
          report={report}
          resetDeps={[...scopeResetDeps, stockCardFilters.productId]}
          scope={scope}
          useReport={useStockCardReport}
        />
      );
    case "top-products":
      return (
        <PaginatedReportTable
          chart={(query) => (
            <ReportRankingChart
              error={query.error}
              formatValue={formatUnits}
              isLoading={query.isLoading}
              items={getPaginatedItems(query.data).map((row) => ({
                id: row.productId,
                label: row.sku || row.productId,
                value: row.unitsSold,
              }))}
              measureLabel="Unidades vendidas"
              onRetry={() => void query.refetch()}
              rangeLabel={rangeLabel}
              report={report}
            />
          )}
          columns={topProductsColumns}
          filters={reportDateFilters}
          getRowId={(row) => row.productId}
          key={report.id}
          pagination={pagination}
          report={report}
          resetDeps={dateResetDeps}
          scope={scope}
          useReport={useTopProductsReport}
        />
      );
    case "top-customers":
      return (
        <PaginatedReportTable
          chart={(query) => (
            <ReportRankingChart
              error={query.error}
              isLoading={query.isLoading}
              items={getPaginatedItems(query.data).map((row) => ({
                id: row.customerId,
                label: row.name,
                value: row.totalRef,
              }))}
              measureLabel="Total comprado en REF"
              onRetry={() => void query.refetch()}
              rangeLabel={rangeLabel}
              report={report}
            />
          )}
          columns={topCustomersColumns}
          filters={reportDateFilters}
          getRowId={(row) => row.customerId}
          key={report.id}
          pagination={pagination}
          report={report}
          resetDeps={dateResetDeps}
          scope={scope}
          useReport={useTopCustomersReport}
        />
      );
    case "purchases": {
      // El rango de compras llega en `purchasesFilters`; `groupBy` y `compare`, en los globales.
      const purchasesDateFilters = toReportDateFilters(report, {
        ...dateFilters,
        from: purchasesFilters.from,
        to: purchasesFilters.to,
      });
      const reportPurchasesFilters: PurchasesReportFilters = {
        ...purchasesDateFilters,
        supplierId: purchasesFilters.supplierId,
      };

      return (
        <PaginatedReportTable
          chart={(query) => (
            <ReportSeriesChart
              error={query.error}
              filters={purchasesDateFilters}
              isLoading={query.isLoading}
              measure={purchasesMeasure}
              onRetry={() => void query.refetch()}
              report={report}
              series={query.data?.series}
            />
          )}
          columns={purchasesColumns}
          filters={reportPurchasesFilters}
          getRowId={(row) => row.id}
          key={report.id}
          pagination={pagination}
          report={report}
          resetDeps={[
            ...scopeResetDeps,
            purchasesDateFilters.from,
            purchasesDateFilters.to,
            purchasesDateFilters.groupBy,
            purchasesDateFilters.compare,
            purchasesFilters.supplierId,
          ]}
          scope={scope}
          useReport={usePurchasesReport}
        />
      );
    }
    default:
      return null;
  }
}
