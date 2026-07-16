"use client";

import { Filter } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { getPageDataSourceSuffix } from "@/lib/api/dataSourceUi";
import { DashboardContentGrid } from "@/modules/dashboard/components/DashboardContentGrid";
import { DashboardKpiCardsGrid } from "@/modules/dashboard/components/DashboardKpiCardsGrid";
import { DashboardLowStockCard } from "@/modules/dashboard/components/DashboardLowStockCard";
import { DashboardPeriodFilterModal } from "@/modules/dashboard/components/DashboardPeriodFilterModal";
import { DashboardRecentSalesCard } from "@/modules/dashboard/components/DashboardRecentSalesCard";
import { DashboardSalesChartCard } from "@/modules/dashboard/components/DashboardSalesChartCard";
import {
  type DashboardRequestScope,
  useDashboardMetrics,
  useDashboardSummary,
} from "@/modules/dashboard/hooks/useDashboard";
import {
  DASHBOARD_KPI_PERIODS,
  type DashboardKpiPeriodDays,
  getDashboardDateRange,
  getKpiPeriodLabel,
} from "@/modules/dashboard/utils/chartPeriod";
import { Button } from "@/shared/components/Button";
import { ErrorState } from "@/shared/components/ErrorState";
import { IconButton } from "@/shared/components/IconButton";
import { LoadingState } from "@/shared/components/LoadingState";
import { Typography } from "@/shared/components/Typography";

import { PlatformStoreScopeFilter } from "../components/PlatformStoreScopeFilter";
import type { PlatformStoreScope } from "../types/reports";

function scopeSubtitle(scope: PlatformStoreScope, selectedCount: number) {
  if (scope === "all") return "Todas las tiendas";
  if (scope === "one") return selectedCount === 1 ? "Una tienda" : "Selecciona una tienda";
  return selectedCount > 0
    ? `${selectedCount} tienda${selectedCount === 1 ? "" : "s"} seleccionada${selectedCount === 1 ? "" : "s"}`
    : "Selecciona tiendas";
}

export function PlatformDashboardPage() {
  const [kpiPeriodDays, setKpiPeriodDays] = useState<DashboardKpiPeriodDays>(1);
  const [kpiPeriodModalOpen, setKpiPeriodModalOpen] = useState(false);
  const [draftKpiPeriodDays, setDraftKpiPeriodDays] = useState<DashboardKpiPeriodDays>(1);
  const [storeScope, setStoreScope] = useState<PlatformStoreScope>("all");
  const [selectedStoreIds, setSelectedStoreIds] = useState<string[]>([]);

  const scopeReady =
    storeScope === "all" ||
    (storeScope === "one" && selectedStoreIds.length === 1) ||
    (storeScope === "selected" && selectedStoreIds.length > 0);

  const dashboardScope: DashboardRequestScope = useMemo(
    () => ({
      enabled: scopeReady,
      pathPrefix: "/api/platform/home",
      storeIds: selectedStoreIds.join(","),
      storeScope,
    }),
    [scopeReady, selectedStoreIds, storeScope],
  );

  const kpiRange = useMemo(() => getDashboardDateRange(kpiPeriodDays), [kpiPeriodDays]);
  const summary = useDashboardSummary(dashboardScope);
  const metrics = useDashboardMetrics(kpiRange, dashboardScope);

  const isInitialLoading = scopeReady && summary.isLoading;
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
            Resumen de plataforma
          </Typography>
          <Typography className="mt-2" variant="muted">
            {scopeSubtitle(storeScope, selectedStoreIds.length)}
            {kpiPeriodDays === 1
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

      <PlatformStoreScopeFilter
        description="Agrega indicadores de una tienda, varias o todas."
        onScopeChange={setStoreScope}
        onSelectedStoreIdsChange={setSelectedStoreIds}
        scope={storeScope}
        selectedStoreIds={selectedStoreIds}
      />

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

      {!scopeReady ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          Selecciona al menos una tienda para ver el resumen.
        </p>
      ) : isInitialLoading ? (
        <LoadingState
          description="Estamos consultando indicadores de plataforma."
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
              <DashboardLowStockCard
                footer={
                  <Button asChild className="w-full" variant="secondary">
                    <Link href="/platform/stores">Ver tiendas</Link>
                  </Button>
                }
                scope={dashboardScope}
                showStore
                totalCount={summary.data?.lowStockCount ?? 0}
              />
            }
          >
            <DashboardSalesChartCard scope={dashboardScope} />
            <DashboardRecentSalesCard
              scope={dashboardScope}
              showStore
              viewAllHref="/platform/stores"
              viewAllLabel="Ver tiendas"
            />
          </DashboardContentGrid>
        </>
      )}
    </div>
  );
}
