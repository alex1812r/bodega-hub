"use client";

import type { UseQueryResult } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { getPaginatedItems, type PaginatedList, type PaginationParams } from "@/lib/api/pagination";
import { RestockPurchaseButton } from "@/modules/inventory/restock";
import { usePaginationState } from "@/shared/components/Pagination";
import type { DataTableColumn } from "@/shared/components/DataTable";
import { formatDateRangeLabel, isValidIsoDate } from "@/shared/components/DateRangeField";
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
  type StockCardReportRow,
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
import {
  type InventoryReportFilters,
  type MoneyReportFilters,
  toReportDateFilters,
} from "../reportsListParams";
import { getReportQueryError, toFiniteNumber } from "../reportQueryState";
import { DailyCloseReportPanel } from "./DailyCloseReportPanel";
import { FxDepreciationReportPanel } from "./FxDepreciationReportPanel";
import { formatCaracasDay } from "./inventory/inventoryReportText";
import { InventoryReportPanel } from "./inventory/InventoryReportPanel";
import { MoneyReportPanel } from "./money/MoneyReportPanel";
import { PanelErrorBoundary } from "./PanelErrorBoundary";
import { PaymentMethodsReportPanel } from "./PaymentMethodsReportPanel";
import { ReportRankingChart } from "./ReportRankingChart";
import { ReportSeriesChart, type ReportSeriesChartMeasure } from "./ReportSeriesChart";
import {
  formatResultsRange,
  ReportTable,
  type ReportPagination,
  useResetPagePastTheEnd,
} from "./ReportTable";
import { ReportTableSection } from "./ReportTableSection";

export type { ReportPagination } from "./ReportTable";

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

/**
 * Cómo se nombra un producto a la vista: su nombre y, si falta, el SKU. El id
 * interno (un UUID) no se muestra nunca.
 */
function productLabel(name: string | undefined, sku: string | undefined) {
  return name || sku || "—";
}

function formatUnits(value: number) {
  return `${value.toLocaleString("es-VE", { maximumFractionDigits: 2 })} uds`;
}

const NO_VALUE = "—";

// Borde del panel: una celda cuyo dato no llegó como se espera (null, texto,
// NaN) se pinta «—» en vez de romper el render o enseñar «NaN».
function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function ref(value: unknown) {
  return isFiniteNumber(value) ? formatRef(value) : NO_VALUE;
}

function ves(value: unknown) {
  return isFiniteNumber(value) ? formatVes(value) : NO_VALUE;
}

function count(value: unknown) {
  return isFiniteNumber(value) ? value : NO_VALUE;
}

/** Día de Caracas que ya llega como `YYYY-MM-DD`. */
function day(value: unknown) {
  return isValidIsoDate(value) ? formatDate(value) : NO_VALUE;
}

/**
 * Instante (kardex, compras, última compra) → su día operativo de Caracas. Con
 * `formatDate` salía en la zona del navegador: un día después en Asia/Tokyo.
 */
function caracasDay(value: unknown) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value))
    ? formatCaracasDay(value)
    : NO_VALUE;
}

const dailySalesColumns: DataTableColumn<DailySalesReportRow>[] = [
  { header: "Fecha", key: "saleDate", render: (row) => day(row.saleDate) },
  { align: "right", header: "Ventas", key: "salesCount", render: (row) => count(row.salesCount) },
  { align: "right", header: "Total ref", key: "totalRef", render: (row) => ref(row.totalRef) },
  { align: "right", header: "Total VES", key: "totalVes", render: (row) => ves(row.totalVes) },
  { align: "right", header: "Cobrado VES", key: "paidVes", render: (row) => ves(row.paidVes) },
];

const grossProfitColumns: DataTableColumn<GrossProfitReportRow>[] = [
  { header: "Fecha", key: "saleDate", render: (row) => day(row.saleDate) },
  { align: "right", header: "Ingresos", key: "revenueRef", render: (row) => ref(row.revenueRef) },
  { align: "right", header: "Costos", key: "costRef", render: (row) => ref(row.costRef) },
  { align: "right", header: "Ganancia", key: "grossProfitRef", render: (row) => ref(row.grossProfitRef) },
];

const productProfitabilityColumns: DataTableColumn<ProductProfitabilityReportRow>[] = [
  { header: "Producto", key: "name", render: (row) => productLabel(row.name, row.sku) },
  { header: "SKU", key: "sku", render: (row) => row.sku },
  { align: "right", header: "Unidades", key: "unitsSold", render: (row) => count(row.unitsSold) },
  { align: "right", header: "Costo", key: "costRef", render: (row) => ref(row.costRef) },
  { align: "right", header: "Ganancia", key: "grossProfitRef", render: (row) => ref(row.grossProfitRef) },
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
  { align: "right", header: "Total ref", key: "totalRef", render: (row) => ref(row.totalRef) },
  { align: "right", header: "Pendiente VES", key: "pendingVes", render: (row) => ves(row.pendingVes) },
  {
    header: "Última compra",
    key: "lastPurchaseAt",
    render: (row) => (row.lastPurchaseAt ? caracasDay(row.lastPurchaseAt) : "Sin compras"),
  },
];

const supplierPurchasesColumns: DataTableColumn<SupplierPurchasesReportRow>[] = [
  { header: "Proveedor", key: "name", render: (row) => row.name },
  { align: "right", header: "Compras", key: "purchasesCount", render: (row) => row.purchasesCount },
  { align: "right", header: "Total ref", key: "totalRef", render: (row) => ref(row.totalRef) },
  { align: "right", header: "Pendiente VES", key: "pendingVes", render: (row) => ves(row.pendingVes) },
  {
    header: "Última compra",
    key: "lastPurchaseAt",
    render: (row) => (row.lastPurchaseAt ? caracasDay(row.lastPurchaseAt) : "Sin compras"),
  },
];

const stockCardColumns: DataTableColumn<StockCardReportRow>[] = [
  { header: "Fecha", key: "createdAt", render: (row) => caracasDay(row.createdAt) },
  { header: "Producto", key: "productName", render: (row) => productLabel(row.productName, row.sku) },
  { header: "Tipo", key: "type", render: (row) => row.type },
  { align: "right", header: "Movimiento", key: "quantityDelta", render: (row) => row.quantityDelta },
  { align: "right", header: "Stock final", key: "stockAfter", render: (row) => row.stockAfter },
];

const topProductsColumns: DataTableColumn<TopProductsReportRow>[] = [
  { header: "Producto", key: "name", render: (row) => productLabel(row.name, row.sku) },
  { header: "SKU", key: "sku", render: (row) => row.sku },
  { align: "right", header: "Unidades", key: "unitsSold", render: (row) => count(row.unitsSold) },
  { align: "right", header: "Ingreso ref", key: "revenueRef", render: (row) => ref(row.revenueRef) },
];

const topCustomersColumns: DataTableColumn<TopCustomersReportRow>[] = [
  { header: "Cliente", key: "name", render: (row) => row.name },
  { align: "right", header: "Ventas", key: "salesCount", render: (row) => row.salesCount },
  { align: "right", header: "Total ref", key: "totalRef", render: (row) => ref(row.totalRef) },
  { align: "right", header: "Total VES", key: "totalVes", render: (row) => ves(row.totalVes) },
];

/** Bajo el gráfico de compras cuando no se eligió estado: qué deja fuera. */
export const PURCHASES_DEFAULT_STATUS_NOTE = "No incluye compras canceladas ni devueltas.";

const purchasesColumns: DataTableColumn<PurchasesReportRow>[] = [
  { header: "Compra", key: "purchaseNumber", render: (row) => row.purchaseNumber },
  { header: "Proveedor", key: "supplier", render: (row) => row.supplier?.name ?? row.supplierId },
  { header: "Fecha", key: "createdAt", render: (row) => caracasDay(row.createdAt) },
  { align: "right", header: "Items", key: "itemsCount", render: (row) => row.itemsCount },
  {
    align: "right",
    header: "Total REF",
    key: "totalRef",
    // El gráfico totaliza en REF: la tabla lo trae para poder cuadrarlo. Una fila sin el dato, «—».
    render: (row) => ref(row.totalRef),
  },
  { align: "right", header: "Total VES", key: "totalVes", render: (row) => ves(row.totalVes) },
];

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
  const { data } = query;

  useResetPagePastTheEnd(query, pagination);

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
        summary={
          getReportQueryError(query)
            ? undefined
            : formatResultsRange(data?.skip ?? skip, pagination.limit, toFiniteNumber(data?.total))
        }
      >
        {table}
      </ReportTableSection>
    </div>
  );
}

type ReportsResultPanelProps = {
  /** Rango global (`from` / `to`) y, para los reportes que los admiten, `groupBy` y `compare`. */
  dateFilters: ReportDateRangeFilters;
  /** Filtros propios de los reportes de inventario (`days`, `categoryId`, `turnoverBy` de la URL). */
  inventoryFilters?: InventoryReportFilters;
  /**
   * URL actual de la lista (`useUrlListState().href`): los enlaces a un
   * documento, a un contacto o a un producto la llevan en `returnTo` para
   * poder volver.
   */
  listHref?: string;
  /** Filtros propios de los reportes de dinero (`bucket`, `contactId`, `currency` de la URL). */
  moneyFilters?: MoneyReportFilters;
  onInventoryFiltersChange?: (patch: Partial<InventoryReportFilters>) => void;
  onMoneyFiltersChange?: (patch: Partial<MoneyReportFilters>) => void;
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
 * depreciación FX, bajo stock y kardex son solo tabla o panel. Los de dinero de
 * REP-06 y los de inventario de REP-07 son de la tienda activa: con `scope`
 * (plataforma) no pintan nada.
 *
 * Va dentro de un límite de error: si el render del reporte lanza (una respuesta
 * 200 con campos nulos o de otro tipo), se muestra su estado de error con
 * «Reintentar» y el catálogo y los filtros siguen vivos. El límite se reinicia
 * al cambiar de reporte, de filtros o de página.
 */
export function ReportsResultPanel(props: ReportsResultPanelProps) {
  const { dateFilters, inventoryFilters, moneyFilters, pagination, purchasesFilters, report, scope } =
    props;
  const resetKey = JSON.stringify([
    report.id,
    dateFilters,
    purchasesFilters,
    props.stockCardFilters,
    moneyFilters,
    inventoryFilters,
    pagination?.limit,
    pagination?.skip,
    scope,
  ]);

  return (
    <PanelErrorBoundary resetKey={resetKey}>
      <ReportsResultPanelContent {...props} />
    </PanelErrorBoundary>
  );
}

function ReportsResultPanelContent({
  dateFilters,
  inventoryFilters,
  listHref,
  moneyFilters,
  onInventoryFiltersChange,
  onMoneyFiltersChange,
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
              error={getReportQueryError(query)}
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
              error={getReportQueryError(query)}
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
              error={getReportQueryError(query)}
              isLoading={query.isLoading}
              items={getPaginatedItems(query.data).map((row) => ({
                id: row.productId,
                label: productLabel(row.name, row.sku),
                value: toFiniteNumber(row.grossProfitRef),
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
              error={getReportQueryError(query)}
              isLoading={query.isLoading}
              items={getPaginatedItems(query.data).map((row) => ({
                id: row.customerId,
                label: row.name,
                value: toFiniteNumber(row.totalRef),
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
              error={getReportQueryError(query)}
              isLoading={query.isLoading}
              items={getPaginatedItems(query.data).map((row) => ({
                id: row.supplierId,
                label: row.name,
                value: toFiniteNumber(row.totalRef),
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
              error={getReportQueryError(query)}
              formatValue={formatUnits}
              isLoading={query.isLoading}
              items={getPaginatedItems(query.data).map((row) => ({
                id: row.productId,
                label: productLabel(row.name, row.sku),
                value: toFiniteNumber(row.unitsSold),
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
              error={getReportQueryError(query)}
              isLoading={query.isLoading}
              items={getPaginatedItems(query.data).map((row) => ({
                id: row.customerId,
                label: row.name,
                value: toFiniteNumber(row.totalRef),
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
      // Sin `status` el servicio deja fuera canceladas y devueltas, en la tabla y en la serie.
      const reportPurchasesFilters: PurchasesReportFilters = {
        ...purchasesDateFilters,
        ...(purchasesFilters.status ? { status: purchasesFilters.status } : {}),
        supplierId: purchasesFilters.supplierId,
      };

      return (
        <PaginatedReportTable
          chart={(query) => (
            <ReportSeriesChart
              error={getReportQueryError(query)}
              filters={purchasesDateFilters}
              footnote={purchasesFilters.status ? null : PURCHASES_DEFAULT_STATUS_NOTE}
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
            purchasesFilters.status,
          ]}
          scope={scope}
          useReport={usePurchasesReport}
        />
      );
    }
    case "sales-by-hour":
    case "sales-by-category":
    case "receivables-aging":
    case "payables-aging":
    case "cash-close-differences":
      return scope ? null : (
        <MoneyReportPanel
          dateFilters={reportDateFilters}
          filters={moneyFilters}
          key={report.id}
          listHref={listHref}
          onFiltersChange={onMoneyFiltersChange}
          pagination={pagination}
          report={report}
        />
      );
    case "dead-stock":
    case "stock-turnover":
    case "stock-adjustments":
      return scope ? null : (
        <InventoryReportPanel
          dateFilters={reportDateFilters}
          filters={inventoryFilters}
          key={report.id}
          listHref={listHref}
          onFiltersChange={onInventoryFiltersChange}
          pagination={pagination}
          report={report}
        />
      );
    default:
      return null;
  }
}
