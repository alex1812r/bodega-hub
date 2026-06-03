"use client";

import type { UseQueryResult } from "@tanstack/react-query";
import { useState } from "react";

import { getConnectedToApiPhrase } from "@/lib/api/dataSourceUi";
import { getPaginatedItems, type PaginatedList, type PaginationParams } from "@/lib/api/pagination";
import { ResponsivePagination, usePaginationState } from "@/shared/components/Pagination";
import { Badge } from "@/shared/components/Badge";
import { Button } from "@/shared/components/Button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/Card";
import { DataTable, type DataTableColumn } from "@/shared/components/DataTable";
import { EntityListPage } from "@/shared/components/EntityListPage";
import { FilterPanel } from "@/shared/components/FilterPanel";
import { Input } from "@/shared/components/Input";
import { SelectField } from "@/shared/components/SelectField";
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
} from "../hooks/useReports";

type ReportId =
  | "customer-purchases"
  | "daily-sales"
  | "gross-profit"
  | "low-stock"
  | "product-profitability"
  | "purchases"
  | "stock-card"
  | "supplier-purchases"
  | "top-customers"
  | "top-products";

type ReportDefinition = {
  description: string;
  filterHint: string;
  id: ReportId;
  name: string;
  period: string;
  status: "conectado" | "placeholder";
};

const reports: ReportDefinition[] = [
  {
    id: "daily-sales",
    name: "Ventas diarias",
    period: "Diario",
    status: "conectado",
    description: "Totales de ventas, cobros y conteo por dia.",
    filterHint: "Sin filtros en el endpoint actual.",
  },
  {
    id: "gross-profit",
    name: "Ganancia bruta",
    period: "Diario",
    status: "conectado",
    description: "Ingresos, costos y utilidad bruta por venta.",
    filterHint: "Sin filtros en el endpoint actual.",
  },
  {
    id: "product-profitability",
    name: "Rentabilidad por producto",
    period: "Mensual",
    status: "conectado",
    description: "Unidades vendidas, costo y utilidad por SKU.",
    filterHint: "Sin filtros en el endpoint actual.",
  },
  {
    id: "low-stock",
    name: "Bajo stock",
    period: "Actual",
    status: "conectado",
    description: "Productos con stock actual por debajo del minimo.",
    filterHint: "Sin filtros en el endpoint actual.",
  },
  {
    id: "customer-purchases",
    name: "Compras de clientes",
    period: "Historico",
    status: "conectado",
    description: "Ventas acumuladas, deuda y ultima compra por cliente.",
    filterHint: "Sin filtros en el endpoint actual.",
  },
  {
    id: "supplier-purchases",
    name: "Compras a proveedores",
    period: "Historico",
    status: "conectado",
    description: "Compras acumuladas, deuda y ultimo movimiento por proveedor.",
    filterHint: "Sin filtros en el endpoint actual.",
  },
  {
    id: "stock-card",
    name: "Kardex de producto",
    period: "Actual",
    status: "conectado",
    description: "Movimientos de inventario por producto.",
    filterHint: "Filtra por productId.",
  },
  {
    id: "top-products",
    name: "Top productos",
    period: "Rango",
    status: "conectado",
    description: "Productos mas vendidos dentro del rango seleccionado.",
    filterHint: "Filtra por desde/hasta.",
  },
  {
    id: "top-customers",
    name: "Top clientes",
    period: "Rango",
    status: "conectado",
    description: "Clientes con mayor compra dentro del rango seleccionado.",
    filterHint: "Filtra por desde/hasta.",
  },
  {
    id: "purchases",
    name: "Compras",
    period: "Rango",
    status: "conectado",
    description: "Compras por rango y proveedor.",
    filterHint: "Filtra por desde/hasta y supplierId.",
  },
];

const columns: DataTableColumn<ReportDefinition>[] = [
  {
    header: "Reporte",
    hideInCard: true,
    key: "name",
    render: (report) => report.name,
  },
  { header: "Periodo", key: "period", render: (report) => report.period, visibility: "md" },
  {
    header: "Descripcion",
    key: "description",
    render: (report) => report.description,
    visibility: "lg",
  },
  { header: "Filtros", key: "filterHint", render: (report) => report.filterHint, visibility: "lg" },
  {
    header: "Estado",
    key: "status",
    render: (report) => (
      <Badge variant={report.status === "conectado" ? "success" : "warning"}>
        {report.status}
      </Badge>
    ),
  },
];

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
    render: (row) => row.lastPurchaseAt ? formatDate(row.lastPurchaseAt) : "Sin compras",
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
    render: (row) => row.lastPurchaseAt ? formatDate(row.lastPurchaseAt) : "Sin compras",
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

type ReportTableProps<TData> = {
  columns: DataTableColumn<TData>[];
  getRowId: (row: TData) => string;
  limit: number;
  onLimitChange: (limit: number) => void;
  onSkipChange: (skip: number) => void;
  query: UseQueryResult<PaginatedList<TData>, Error>;
  skip: number;
};

function ReportTable<TData>({
  columns,
  getRowId,
  limit,
  onLimitChange,
  onSkipChange,
  query,
  skip,
}: ReportTableProps<TData>) {
  return (
    <div className="space-y-4">
      <DataTable
        columns={columns}
        data={getPaginatedItems(query.data)}
        error={query.error}
        getRowId={getRowId}
        isFetching={query.isFetching}
        isLoading={query.isLoading}
        loadingRows={4}
        onRetry={() => void query.refetch()}
      />
      <ResponsivePagination
        isDisabled={query.isFetching}
        limit={limit}
        onLimitChange={onLimitChange}
        onSkipChange={onSkipChange}
        skip={query.data?.skip ?? skip}
        total={query.data?.total ?? 0}
      />
    </div>
  );
}

function useReportPagination(resetDeps: readonly unknown[] = []) {
  return usePaginationState(resetDeps);
}

function PaginatedReportTable<TData>({
  columns,
  filters = {},
  getRowId,
  resetDeps = [],
  useReport,
}: {
  columns: DataTableColumn<TData>[];
  filters?: PaginationParams;
  getRowId: (row: TData) => string;
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
      skip={pagination.skip}
    />
  );
}

type ActiveReportPanelProps = {
  dateFilters: ReportDateRangeFilters;
  report: ReportDefinition;
  stockCardFilters: StockCardReportFilters;
  purchasesFilters: PurchasesReportFilters;
};

function DailySalesPanel() {
  return (
    <PaginatedReportTable
      columns={dailySalesColumns}
      getRowId={(row) => `${row.saleDate}-${row.totalVes}-${row.paidVes}`}
      useReport={useDailySalesReport}
    />
  );
}

function GrossProfitPanel() {
  return (
    <PaginatedReportTable
      columns={grossProfitColumns}
      getRowId={(row) => `${row.saleDate}-${row.revenueRef}-${row.costRef}`}
      useReport={useGrossProfitReport}
    />
  );
}

function ProductProfitabilityPanel() {
  return (
    <PaginatedReportTable
      columns={productProfitabilityColumns}
      getRowId={(row) => row.productId}
      useReport={useProductProfitabilityReport}
    />
  );
}

function LowStockPanel() {
  return (
    <PaginatedReportTable
      columns={lowStockColumns}
      getRowId={(row) => row.id}
      useReport={useLowStockReport}
    />
  );
}

function CustomerPurchasesPanel() {
  return (
    <PaginatedReportTable
      columns={customerPurchasesColumns}
      getRowId={(row) => row.customerId}
      useReport={useCustomerPurchasesReport}
    />
  );
}

function SupplierPurchasesPanel() {
  return (
    <PaginatedReportTable
      columns={supplierPurchasesColumns}
      getRowId={(row) => row.supplierId}
      useReport={useSupplierPurchasesReport}
    />
  );
}

function StockCardPanel({ filters }: { filters: StockCardReportFilters }) {
  return (
    <PaginatedReportTable
      columns={stockCardColumns}
      filters={filters}
      getRowId={(row) => row.id}
      resetDeps={[filters.productId]}
      useReport={useStockCardReport}
    />
  );
}

function TopProductsPanel({ filters }: { filters: ReportDateRangeFilters }) {
  return (
    <PaginatedReportTable
      columns={topProductsColumns}
      filters={filters}
      getRowId={(row) => row.productId}
      resetDeps={[filters.from, filters.to]}
      useReport={useTopProductsReport}
    />
  );
}

function TopCustomersPanel({ filters }: { filters: ReportDateRangeFilters }) {
  return (
    <PaginatedReportTable
      columns={topCustomersColumns}
      filters={filters}
      getRowId={(row) => row.customerId}
      resetDeps={[filters.from, filters.to]}
      useReport={useTopCustomersReport}
    />
  );
}

function PurchasesPanel({ filters }: { filters: PurchasesReportFilters }) {
  return (
    <PaginatedReportTable
      columns={purchasesColumns}
      filters={filters}
      getRowId={(row) => row.id}
      resetDeps={[filters.from, filters.to, filters.supplierId]}
      useReport={usePurchasesReport}
    />
  );
}

function ActiveReportPanel({
  dateFilters,
  purchasesFilters,
  report,
  stockCardFilters,
}: ActiveReportPanelProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
          <div>
            <CardTitle>{report.name}</CardTitle>
            <CardDescription>{report.description}</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button disabled size="sm" variant="outline">
              Exportar PDF pendiente
            </Button>
            <Button disabled size="sm" variant="outline">
              Exportar Excel pendiente
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Exportacion formalmente pendiente hasta definir el contrato de descarga.
        </p>
        {report.id === "daily-sales" ? <DailySalesPanel /> : null}
        {report.id === "gross-profit" ? <GrossProfitPanel /> : null}
        {report.id === "product-profitability" ? <ProductProfitabilityPanel /> : null}
        {report.id === "low-stock" ? <LowStockPanel /> : null}
        {report.id === "customer-purchases" ? <CustomerPurchasesPanel /> : null}
        {report.id === "supplier-purchases" ? <SupplierPurchasesPanel /> : null}
        {report.id === "stock-card" ? <StockCardPanel filters={stockCardFilters} /> : null}
        {report.id === "top-products" ? <TopProductsPanel filters={dateFilters} /> : null}
        {report.id === "top-customers" ? <TopCustomersPanel filters={dateFilters} /> : null}
        {report.id === "purchases" ? <PurchasesPanel filters={purchasesFilters} /> : null}
      </CardContent>
    </Card>
  );
}

export function ReportsListPage() {
  const [activeReportId, setActiveReportId] = useState<ReportId>("daily-sales");
  const [dateFilters, setDateFilters] = useState<ReportDateRangeFilters>({});
  const [stockCardFilters, setStockCardFilters] = useState<StockCardReportFilters>({});
  const [purchasesFilters, setPurchasesFilters] = useState<PurchasesReportFilters>({});
  const activeReport = reports.find((report) => report.id === activeReportId) ?? reports[0];

  return (
    <EntityListPage
      description={`Reportes disponibles ${getConnectedToApiPhrase()}.`}
      title="Reportes"
    >
      <FilterPanel defaultOpen title="Filtros de reportes">
        <Input
          label="Desde"
          onChange={(event) => {
            const from = event.target.value || undefined;
            setDateFilters((current) => ({ ...current, from }));
            setPurchasesFilters((current) => ({ ...current, from }));
          }}
          type="date"
          value={dateFilters.from ?? ""}
        />
        <Input
          label="Hasta"
          onChange={(event) => {
            const to = event.target.value || undefined;
            setDateFilters((current) => ({ ...current, to }));
            setPurchasesFilters((current) => ({ ...current, to }));
          }}
          type="date"
          value={dateFilters.to ?? ""}
        />
        <Input
          helperText="Usado por kardex."
          label="Producto ID"
          onChange={(event) =>
            setStockCardFilters({
              productId: event.target.value || undefined,
            })
          }
          placeholder="prod-cable"
          value={stockCardFilters.productId ?? ""}
        />
        <Input
          helperText="Usado por compras."
          label="Proveedor ID"
          onChange={(event) =>
            setPurchasesFilters((current) => ({
              ...current,
              supplierId: event.target.value || undefined,
            }))
          }
          placeholder="cont-supplier"
          value={purchasesFilters.supplierId ?? ""}
        />
      </FilterPanel>

      <div className="lg:hidden">
        <SelectField
          label="Reporte activo"
          onChange={(event) => setActiveReportId(event.target.value as ReportId)}
          options={reports.map((report) => ({
            label: report.name,
            value: report.id,
          }))}
          value={activeReportId}
        />
      </div>

      <div className="hidden min-w-0 lg:block">
        <DataTable
          actions={(report) => [
            {
              label: "Abrir",
              onSelect: () => setActiveReportId(report.id),
            },
            {
              disabled: true,
              label: "Exportar PDF pendiente",
            },
            {
              disabled: true,
              label: "Exportar Excel pendiente",
            },
          ]}
          cardSubtitle={(report) => report.period}
          cardTitle={(report) => report.name}
          columns={columns}
          data={reports}
          getRowId={(report) => report.id}
        />
      </div>

      <ActiveReportPanel
        dateFilters={dateFilters}
        purchasesFilters={purchasesFilters}
        report={activeReport}
        stockCardFilters={stockCardFilters}
      />
    </EntityListPage>
  );
}
