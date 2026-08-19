"use client";

import { Filter } from "lucide-react";

import { getPageDataSourceSuffix } from "@/lib/api/dataSourceUi";
import { DashboardContentGrid } from "@/modules/dashboard/components/DashboardContentGrid";
import { DashboardKpiCardsGrid } from "@/modules/dashboard/components/DashboardKpiCardsGrid";
import { DashboardDailyCloseCard } from "@/modules/dashboard/components/DashboardDailyCloseCard";
import { DashboardLowStockCard } from "@/modules/dashboard/components/DashboardLowStockCard";
import { DashboardPaymentMethodsCard } from "@/modules/dashboard/components/DashboardPaymentMethodsCard";
import { DashboardPeriodFilterModal } from "@/modules/dashboard/components/DashboardPeriodFilterModal";
import { DashboardRecentSalesCard } from "@/modules/dashboard/components/DashboardRecentSalesCard";
import { DashboardSalesChartCard } from "@/modules/dashboard/components/DashboardSalesChartCard";
import { useDashboardKpiPeriod } from "@/modules/dashboard/hooks/useDashboardKpiPeriod";
import {
  useDashboardMetrics,
  useDashboardSummary,
} from "@/modules/dashboard/hooks/useDashboard";
import { ErrorState } from "@/shared/components/ErrorState";
import { IconButton } from "@/shared/components/IconButton";
import { LoadingState } from "@/shared/components/LoadingState";
import { Typography } from "@/shared/components/Typography";

export default function DashboardPage() {
  const kpiPeriod = useDashboardKpiPeriod();
  const summary = useDashboardSummary();
  const metrics = useDashboardMetrics(kpiPeriod.currentFilters);
  const previousMetrics = useDashboardMetrics(kpiPeriod.previousFilters ?? {}, {
    enabled: Boolean(kpiPeriod.previousFilters),
  });

  const isInitialLoading = summary.isLoading;
  const criticalError = summary.error;

  function refetchDashboard() {
    void summary.refetch();
    void metrics.refetch();
    if (kpiPeriod.previousFilters) {
      void previousMetrics.refetch();
    }
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Typography as="h1" variant="h1">
            Resumen del dia
          </Typography>
          <Typography className="mt-2" variant="muted">
            Monitoreo general de operaciones y estado de inventario. Dia operativo Caracas
            (America/Caracas)
            {kpiPeriod.preset === "hoy"
              ? getPageDataSourceSuffix()
              : ` Indicadores de ventas: ${kpiPeriod.kpiPeriodLabel.toLowerCase()}.`}
          </Typography>
        </div>
        <IconButton
          aria-label="Filtrar periodo de indicadores"
          className="shrink-0 text-muted-foreground hover:bg-surface-container hover:text-primary"
          icon={<Filter className="h-5 w-5" />}
          onClick={kpiPeriod.openModal}
          variant="ghost"
        />
      </div>

      <DashboardPeriodFilterModal
        applyDisabled={kpiPeriod.applyDisabled}
        customRange={{
          from: kpiPeriod.draftFrom,
          max: kpiPeriod.today,
          onFromChange: kpiPeriod.setDraftFrom,
          onToChange: kpiPeriod.setDraftTo,
          to: kpiPeriod.draftTo,
        }}
        description="Selecciona Hoy, Ayer, un rango o desde el inicio para ventas REF, total VES y cantidad de ventas."
        draftPeriodKey={kpiPeriod.draftPreset}
        onApply={kpiPeriod.apply}
        onDraftPeriodKeyChange={kpiPeriod.changeDraftPreset}
        onOpenChange={kpiPeriod.setModalOpen}
        open={kpiPeriod.modalOpen}
        periods={kpiPeriod.periods}
        title="Periodo de indicadores"
      />

      {isInitialLoading ? (
        <LoadingState
          description="Estamos consultando indicadores del dia."
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
            comparisonLabel={kpiPeriod.comparisonLabel}
            isMetricsLoading={metrics.isLoading || metrics.isFetching}
            isPreviousLoading={previousMetrics.isLoading || previousMetrics.isFetching}
            metrics={metrics.data}
            previousMetrics={previousMetrics.data}
            preset={kpiPeriod.preset}
            summary={summary.data}
          />

          <DashboardPaymentMethodsCard
            from={kpiPeriod.currentFilters.from}
            fromStart={kpiPeriod.currentFilters.fromStart}
            periodLabel={kpiPeriod.kpiPeriodLabel}
            to={kpiPeriod.currentFilters.to}
          />

          <DashboardDailyCloseCard
            from={kpiPeriod.currentFilters.from}
            fromStart={kpiPeriod.currentFilters.fromStart}
            periodLabel={kpiPeriod.kpiPeriodLabel}
            to={kpiPeriod.currentFilters.to}
          />

          <DashboardContentGrid
            aside={
              <DashboardLowStockCard totalCount={summary.data?.lowStockCount ?? 0} />
            }
          >
            <DashboardSalesChartCard />
            <DashboardRecentSalesCard />
          </DashboardContentGrid>
        </>
      )}
    </div>
  );
}
