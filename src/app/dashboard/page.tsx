"use client";

import {
  getApiLayerName,
  getConnectedToLayerPhrase,
} from "@/lib/api/dataSourceUi";
import { getPaginatedItems } from "@/lib/api/pagination";
import { ResponsivePagination, usePaginationState } from "@/shared/components/Pagination";
import { Badge } from "@/shared/components/Badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/components/Card";
import { DataTable, type DataTableColumn } from "@/shared/components/DataTable";
import { ErrorState } from "@/shared/components/ErrorState";
import { LoadingState } from "@/shared/components/LoadingState";
import { Typography } from "@/shared/components/Typography";
import {
  type DashboardLowStockProduct,
  useDashboardLowStock,
  useDashboardMetrics,
  useDashboardRecentSales,
  useDashboardSummary,
} from "@/modules/dashboard/hooks/useDashboard";
import { useCurrentExchangeRate } from "@/modules/settings/hooks/useCurrentExchangeRate";
import type { SaleMock } from "@/shared/mocks/erp-data";
import { formatRef, formatVes } from "@/shared/utils/currency";
import { formatDate } from "@/shared/utils/date";

const todayFilters = {
  from: "2026-05-18",
  to: "2026-05-18",
};

const recentSalesColumns: DataTableColumn<SaleMock>[] = [
  { header: "Factura", key: "invoiceNumber", render: (row) => row.invoiceNumber },
  {
    header: "Fecha",
    key: "createdAt",
    render: (row) => formatDate(row.createdAt),
  },
  {
    header: "Estado",
    key: "status",
    render: (row) => <Badge variant="info">{row.status}</Badge>,
  },
  {
    align: "right",
    header: "Total",
    key: "totalRef",
    render: (row) => formatRef(row.totalRef),
  },
];

const lowStockColumns: DataTableColumn<DashboardLowStockProduct>[] = [
  { header: "SKU", key: "sku", render: (row) => row.sku },
  { header: "Producto", key: "name", render: (row) => row.name },
  {
    align: "right",
    header: "Stock",
    key: "currentStock",
    render: (row) => row.currentStock,
  },
  {
    align: "right",
    header: "Minimo",
    key: "minStock",
    render: (row) => row.minStock,
  },
];

export default function DashboardPage() {
  const summary = useDashboardSummary();
  const metrics = useDashboardMetrics(todayFilters);
  const recentPagination = usePaginationState([]);
  const lowStockPagination = usePaginationState([]);
  const recentSales = useDashboardRecentSales({
    limit: recentPagination.limit,
    skip: recentPagination.skip,
  });
  const lowStock = useDashboardLowStock({
    limit: lowStockPagination.limit,
    skip: lowStockPagination.skip,
  });
  const exchangeRate = useCurrentExchangeRate();

  const isInitialLoading = summary.isLoading || metrics.isLoading || exchangeRate.isLoading;
  const criticalError = summary.error ?? metrics.error ?? exchangeRate.error;

  function refetchDashboard() {
    void summary.refetch();
    void metrics.refetch();
    void recentSales.refetch();
    void lowStock.refetch();
    void exchangeRate.refetch();
  }

  const metricCards = [
    {
      label: "Ventas del dia",
      value: String(summary.data?.salesCount ?? 0),
      description: `${formatRef(summary.data?.totalRef ?? 0)} en ventas confirmadas`,
    },
    {
      label: "Total VES",
      value: formatVes(summary.data?.totalVes ?? 0),
      description: "Calculado desde ventas del dia",
    },
    {
      label: "Pendientes",
      value: String(summary.data?.pendingSalesCount ?? 0),
      description: "Ventas con saldo por cobrar",
    },
    {
      label: "Tasa ref/VES",
      value: formatVes(exchangeRate.data?.rateVes ?? 0),
      description: exchangeRate.data
        ? `${exchangeRate.data.source} - ${formatDate(exchangeRate.data.createdAt)}`
        : "Tasa vigente no disponible",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <Typography as="h1" variant="h1">
          Inicio
        </Typography>
        <Typography className="mt-2" variant="muted">
          Resumen inicial del ERP {getConnectedToLayerPhrase()}.
        </Typography>
      </div>

      {isInitialLoading ? (
        <LoadingState
          description="Estamos consultando resumen, metricas y tasa vigente."
          title="Cargando dashboard"
        />
      ) : criticalError ? (
        <ErrorState
          description={
            criticalError instanceof Error
              ? criticalError.message
              : "No pudimos cargar el resumen principal."
          }
          onRetry={refetchDashboard}
          title="No pudimos cargar el dashboard"
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {metricCards.map((metric) => (
              <Card key={metric.label}>
                <CardHeader>
                  <CardDescription>{metric.label}</CardDescription>
                  <CardTitle>{metric.value}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    {metric.description}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardDescription>Metricas del rango</CardDescription>
              <CardTitle>{formatRef(metrics.data?.totalRef ?? 0)}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 text-sm text-slate-600 dark:text-slate-300 sm:grid-cols-2 lg:grid-cols-4">
                <p>
                  <span className="font-medium text-slate-950 dark:text-slate-100">
                    Unidades:
                  </span>{" "}
                  {metrics.data?.unitsSold ?? 0}
                </p>
                <p>
                  <span className="font-medium text-slate-950 dark:text-slate-100">
                    Pagado:
                  </span>{" "}
                  {formatVes(metrics.data?.paidVes ?? 0)}
                </p>
                <p>
                  <span className="font-medium text-slate-950 dark:text-slate-100">
                    Pendiente:
                  </span>{" "}
                  {formatVes(metrics.data?.pendingVes ?? 0)}
                </p>
                <p>
                  <span className="font-medium text-slate-950 dark:text-slate-100">
                    Stock bajo:
                  </span>{" "}
                  {summary.data?.lowStockCount ?? 0}
                </p>
              </div>
            </CardContent>
          </Card>

          <div className="grid min-w-0 gap-6 xl:grid-cols-2">
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>Ventas recientes</CardTitle>
                <CardDescription>
                  Ultimas operaciones registradas en {getApiLayerName()}.
                </CardDescription>
              </CardHeader>
              <CardContent className="min-w-0">
                <DataTable
                  cardTitle={(row) => row.invoiceNumber}
                  columns={recentSalesColumns}
                  data={getPaginatedItems(recentSales.data)}
                  error={recentSales.error}
                  getRowId={(row) => row.id}
                  isFetching={recentSales.isFetching}
                  isLoading={recentSales.isLoading}
                  loadingRows={3}
                  onRetry={() => void recentSales.refetch()}
                />
                <ResponsivePagination
                  className="mt-4"
                  isDisabled={recentSales.isFetching}
                  limit={recentPagination.limit}
                  onLimitChange={recentPagination.setLimit}
                  onSkipChange={recentPagination.setSkip}
                  skip={recentSales.data?.skip ?? recentPagination.skip}
                  total={recentSales.data?.total ?? 0}
                />
              </CardContent>
            </Card>

            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>Stock bajo</CardTitle>
                <CardDescription>
                  Productos por debajo del minimo configurado.
                </CardDescription>
              </CardHeader>
              <CardContent className="min-w-0">
                <DataTable
                  cardSubtitle={(row) => row.sku}
                  cardTitle={(row) => row.name}
                  columns={lowStockColumns}
                  data={getPaginatedItems(lowStock.data)}
                  error={lowStock.error}
                  getRowId={(row) => row.id}
                  isFetching={lowStock.isFetching}
                  isLoading={lowStock.isLoading}
                  loadingRows={3}
                  onRetry={() => void lowStock.refetch()}
                />
                <ResponsivePagination
                  className="mt-4"
                  isDisabled={lowStock.isFetching}
                  limit={lowStockPagination.limit}
                  onLimitChange={lowStockPagination.setLimit}
                  onSkipChange={lowStockPagination.setSkip}
                  skip={lowStock.data?.skip ?? lowStockPagination.skip}
                  total={lowStock.data?.total ?? 0}
                />
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
