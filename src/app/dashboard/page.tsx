"use client";

import { Filter } from "lucide-react";
import { useMemo, useState } from "react";

import { getPageDataSourceSuffix } from "@/lib/api/dataSourceUi";
import { DashboardContentGrid } from "@/modules/dashboard/components/DashboardContentGrid";
import { DashboardKpiCardsGrid } from "@/modules/dashboard/components/DashboardKpiCardsGrid";
import { DashboardLowStockCard } from "@/modules/dashboard/components/DashboardLowStockCard";
import { DashboardPeriodFilterModal } from "@/modules/dashboard/components/DashboardPeriodFilterModal";
import { DashboardRecentSalesCard } from "@/modules/dashboard/components/DashboardRecentSalesCard";
import { DashboardSalesChartCard } from "@/modules/dashboard/components/DashboardSalesChartCard";
import {
  useDashboardMetrics,
  useDashboardSummary,
} from "@/modules/dashboard/hooks/useDashboard";
import {
  DASHBOARD_KPI_PERIODS,
  type DashboardKpiPeriodDays,
  getDashboardDateRange,
  getKpiPeriodLabel,
} from "@/modules/dashboard/utils/chartPeriod";
import { ErrorState } from "@/shared/components/ErrorState";
import { IconButton } from "@/shared/components/IconButton";
import { LoadingState } from "@/shared/components/LoadingState";
import { Typography } from "@/shared/components/Typography";

export default function DashboardPage() {
  const [kpiPeriodDays, setKpiPeriodDays] = useState<DashboardKpiPeriodDays>(1);
  const [kpiPeriodModalOpen, setKpiPeriodModalOpen] = useState(false);
  const [draftKpiPeriodDays, setDraftKpiPeriodDays] = useState<DashboardKpiPeriodDays>(1);

  const kpiRange = useMemo(() => getDashboardDateRange(kpiPeriodDays), [kpiPeriodDays]);
  const summary = useDashboardSummary();
  const metrics = useDashboardMetrics(kpiRange);

  const isInitialLoading = summary.isLoading;
  const criticalError = summary.error;
  const kpiPeriodLabel = getKpiPeriodLabel(kpiPeriodDays);

  function refetchDashboard() {
    void summary.refetch();
    void metrics.refetch();
  }

  function openKpiPeriodModal() {
    setDraftKpiPeriodDays(kpiPeriodDays);
    setKpiPeriodModalOpen(true);
  }

  function applyKpiPeriod() {
    setKpiPeriodDays(draftKpiPeriodDays);
    setKpiPeriodModalOpen(false);
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Typography as="h1" variant="h1">
            Resumen del dia
          </Typography>
          <Typography className="mt-2" variant="muted">
            Monitoreo general de operaciones y estado de inventario{kpiPeriodDays === 1
              ? getPageDataSourceSuffix()
              : `. Indicadores de ventas: ${kpiPeriodLabel.toLowerCase()}.`}
          </Typography>
        </div>
        <IconButton
          aria-label="Filtrar periodo de indicadores"
          className="shrink-0 text-muted-foreground hover:bg-surface-container hover:text-primary"
          icon={<Filter className="h-5 w-5" />}
          onClick={openKpiPeriodModal}
          variant="ghost"
        />
      </div>

      <DashboardPeriodFilterModal
        description="Selecciona el rango para ventas REF, total VES y cobros del periodo."
        draftPeriodDays={draftKpiPeriodDays}
        onApply={applyKpiPeriod}
        onDraftPeriodChange={(days) => setDraftKpiPeriodDays(days as DashboardKpiPeriodDays)}
        onOpenChange={setKpiPeriodModalOpen}
        open={kpiPeriodModalOpen}
        periods={DASHBOARD_KPI_PERIODS}
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
            isMetricsLoading={metrics.isLoading || metrics.isFetching}
            metrics={metrics.data}
            periodDays={kpiPeriodDays}
            summary={summary.data}
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
