"use client";

import { getPageDataSourceSuffix } from "@/lib/api/dataSourceUi";
import { DashboardContentGrid } from "@/modules/dashboard/components/DashboardContentGrid";
import { DashboardKpiCardsGrid } from "@/modules/dashboard/components/DashboardKpiCardsGrid";
import { DashboardDailyCloseCard } from "@/modules/dashboard/components/DashboardDailyCloseCard";
import { DashboardLowStockCard } from "@/modules/dashboard/components/DashboardLowStockCard";
import { DashboardPaymentMethodsCard } from "@/modules/dashboard/components/DashboardPaymentMethodsCard";
import { DashboardPeriodField } from "@/modules/dashboard/components/DashboardPeriodField";
import { DashboardRecentSalesCard } from "@/modules/dashboard/components/DashboardRecentSalesCard";
import { DashboardSalesChartCard } from "@/modules/dashboard/components/DashboardSalesChartCard";
import { useDashboardUrlPeriod } from "@/modules/dashboard/hooks/useDashboardKpiPeriod";
import {
  useDashboardMetrics,
  useDashboardSummary,
} from "@/modules/dashboard/hooks/useDashboard";
import { PriceReviewDashboardCard } from "@/modules/products/components/price-review/PriceReviewDashboardCard";
import { ErrorState } from "@/shared/components/ErrorState";
import { LoadingState } from "@/shared/components/LoadingState";
import { Typography } from "@/shared/components/Typography";
import { withUrlListBoundary } from "@/shared/hooks/useUrlListState";

function DashboardScreen() {
  const period = useDashboardUrlPeriod();
  const summary = useDashboardSummary();
  const metrics = useDashboardMetrics(period.currentFilters);
  const previousMetrics = useDashboardMetrics(period.previousFilters ?? {}, {
    enabled: Boolean(period.previousFilters),
  });

  const isInitialLoading = summary.isLoading;
  const criticalError = summary.error;

  function refetchDashboard() {
    void summary.refetch();
    void metrics.refetch();
    if (period.previousFilters) {
      void previousMetrics.refetch();
    }
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <div className="min-w-0">
        <Typography as="h1" variant="h1">
          Resumen del día
        </Typography>
        <Typography className="mt-2" variant="muted">
          Monitoreo general de operaciones y estado de inventario. Día operativo Caracas
          (America/Caracas)
          {period.preset === "hoy"
            ? getPageDataSourceSuffix()
            : `. Periodo: ${period.kpiPeriodLabel}.`}
        </Typography>
      </div>

      {/* Un solo periodo para indicadores, mix de pagos, cierre y gráfico. */}
      <DashboardPeriodField period={period} />

      {isInitialLoading ? (
        <LoadingState
          description="Estamos consultando indicadores del día."
          title="Cargando dashboard"
          variant="page"
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
          <DashboardKpiCardsGrid
            comparisonLabel={period.comparisonLabel}
            isMetricsLoading={metrics.isLoading || metrics.isFetching}
            isPreviousLoading={previousMetrics.isLoading || previousMetrics.isFetching}
            metrics={metrics.data}
            previousMetrics={previousMetrics.data}
            preset={period.preset}
            summary={summary.data}
          />

          <DashboardPaymentMethodsCard
            from={period.range.from}
            periodLabel={period.kpiPeriodLabel}
            to={period.range.to}
          />

          <DashboardDailyCloseCard
            from={period.range.from}
            periodLabel={period.kpiPeriodLabel}
            to={period.range.to}
          />

          <DashboardContentGrid
            aside={
              // Columna de atención: avisos (precios por revisar) encima de "Bajo
              // stock". Un aviso que no pinta nada no deja hueco: el `gap` solo
              // separa hijos presentes y "Bajo stock" ocupa el resto de la altura.
              <div className="flex h-full flex-col gap-6">
                <PriceReviewDashboardCard />
                <div className="min-h-0 flex-1">
                  <DashboardLowStockCard totalCount={summary.data?.lowStockCount ?? 0} />
                </div>
              </div>
            }
          >
            <DashboardSalesChartCard range={period.range} />
            <DashboardRecentSalesCard />
          </DashboardContentGrid>
        </>
      )}
    </div>
  );
}

/** El periodo vive en la URL (`useUrlListState`): la pantalla lleva su límite de Suspense. */
const DashboardPage = withUrlListBoundary(DashboardScreen);

export default DashboardPage;
