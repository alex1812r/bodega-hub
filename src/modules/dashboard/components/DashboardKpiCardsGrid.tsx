"use client";

import { onlineManager, QueryClientContext } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDown,
  Banknote,
  Percent,
  TrendingUp,
  Users,
} from "lucide-react";
import { useContext, useSyncExternalStore } from "react";

import { DashboardCardBoundary } from "@/modules/dashboard/components/DashboardCardBoundary";
import { DashboardKpiCard } from "@/modules/dashboard/components/DashboardKpiCard";
import { DashboardKpiTrend } from "@/modules/dashboard/components/DashboardKpiTrend";
import { DashboardOfflineNote } from "@/modules/dashboard/components/DashboardOfflineNote";
import type {
  DashboardMetrics,
  DashboardSummary,
} from "@/modules/dashboard/hooks/useDashboard";
import type { DashboardKpiPreset } from "@/modules/dashboard/utils/kpiPeriod";
import { kpiChangePercent } from "@/modules/dashboard/utils/kpiPeriod";
import {
  ReportOfflineError,
  toFiniteNumber,
  toReportErrorMessage,
} from "@/modules/reports/reports-list/reportQueryState";
import { ErrorState } from "@/shared/components/ErrorState";
import { formatRef, formatVes } from "@/shared/utils/currency";

type DashboardKpiCardsGridProps = {
  comparisonLabel?: string | null;
  isMetricsLoading?: boolean;
  isPreviousLoading?: boolean;
  /** `null` = la respuesta llegó sin datos (rota). */
  metrics?: DashboardMetrics | null;
  /** Error de la consulta de métricas, ya normalizado con `getReportQueryError`. */
  metricsError?: Error | null;
  onRetryMetrics?: () => void;
  onRetrySummary?: () => void;
  previousMetrics?: DashboardMetrics | null;
  preset: DashboardKpiPreset;
  summary?: DashboardSummary | null;
  /** Error de la consulta del resumen, ya normalizado con `getReportQueryError`. */
  summaryError?: Error | null;
};

/** Falló de verdad: sin red la consulta está en pausa y ya tiene su propio aviso. */
function isQueryFailure(error: Error | null | undefined): error is Error {
  return Boolean(error) && !(error instanceof ReportOfflineError);
}

function salesCardLabel(preset: DashboardKpiPreset) {
  if (preset === "hoy") {
    return "Ventas del día";
  }

  if (preset === "ayer") {
    return "Ventas de ayer";
  }

  if (preset === "desde_inicio") {
    return "Ventas desde el inicio";
  }

  return "Ventas del periodo";
}

function vesCardLabel(preset: DashboardKpiPreset) {
  if (preset === "hoy") {
    return "Total VES";
  }

  if (preset === "desde_inicio") {
    return "Total VES desde el inicio";
  }

  return "Total VES del periodo";
}

function subscribeToOnline(onChange: () => void) {
  return onlineManager.subscribe(onChange);
}

function isOnlineNow() {
  return onlineManager.isOnline();
}

const DASHBOARD_QUERY_KEY = ["dashboard"] as const;

/**
 * Indicadores del dashboard, dentro de su límite de error: si una respuesta
 * malformada rompe el render, solo este bloque muestra el error. Los datos
 * llegan por props, así que el límite se reinicia cuando cambian.
 */
export function DashboardKpiCardsGrid(props: DashboardKpiCardsGridProps) {
  return (
    <DashboardCardBoundary
      resetKey={JSON.stringify([props.metrics, props.previousMetrics, props.summary]) ?? ""}
    >
      <KpiCardsGrid {...props} />
    </DashboardCardBoundary>
  );
}

function KpiCardsGrid({
  comparisonLabel,
  isMetricsLoading = false,
  isPreviousLoading = false,
  metrics,
  metricsError,
  onRetryMetrics,
  onRetrySummary,
  previousMetrics,
  preset,
  summary,
  summaryError,
}: DashboardKpiCardsGridProps) {
  const isToday = preset === "hoy";
  const salesLabel = salesCardLabel(preset);
  const vesLabel = vesCardLabel(preset);
  const hasPreviousPeriod = preset !== "desde_inicio";

  // Sin red la consulta queda en pausa (ni carga ni falla): sin datos de este
  // periodo se pinta «—» y el aviso de conexión, no ceros que parecen reales.
  const queryClient = useContext(QueryClientContext);
  const isOnline = useSyncExternalStore(subscribeToOnline, isOnlineNow, () => true);
  const isMetricsOffline = !isOnline && !isMetricsLoading && metrics == null;
  const isSummaryOffline = !isOnline && summary == null;
  // La consulta falló y no hay datos de este periodo: «—» y el error con
  // «Reintentar», nunca «ref 0.00 · 0 ventas» como si fueran cifras reales.
  const isMetricsFailed =
    !isMetricsLoading && !isMetricsOffline && metrics == null && isQueryFailure(metricsError);
  const isSummaryFailed = !isSummaryOffline && summary == null && isQueryFailure(summaryError);
  const isMetricsPending = isMetricsLoading || isMetricsOffline || isMetricsFailed;
  const isSummaryMissing = isSummaryOffline || isSummaryFailed;

  // Una cifra que no llega como número (null, texto) cuenta como 0, no rompe la tarjeta.
  const totalRef = toFiniteNumber(metrics?.totalRef);
  const salesValue = isMetricsPending ? "—" : formatRef(totalRef);
  const vesValue = isMetricsPending ? "—" : formatVes(toFiniteNumber(metrics?.totalVes));
  const salesCount = toFiniteNumber(metrics?.salesCount);
  const salesCountDelta =
    !isPreviousLoading && !isMetricsPending && previousMetrics
      ? salesCount - toFiniteNumber(previousMetrics.salesCount)
      : null;

  const changePercent =
    isMetricsPending || isPreviousLoading
      ? null
      : kpiChangePercent(
          totalRef,
          previousMetrics ? toFiniteNumber(previousMetrics.totalRef) : undefined,
        );

  const trendNeutralLabel = !hasPreviousPeriod
    ? "Sin periodo anterior comparable"
    : isPreviousLoading
      ? "Comparando..."
      : "Sin datos del periodo anterior";

  return (
    <>
      {isMetricsOffline || isSummaryOffline ? (
        <DashboardOfflineNote
          onRetry={() => void queryClient?.refetchQueries({ queryKey: DASHBOARD_QUERY_KEY, type: "active" })}
        />
      ) : null}
      {isMetricsFailed ? (
        <ErrorState
          description={toReportErrorMessage(metricsError, "No pudimos cargar los indicadores del periodo.")}
          onRetry={onRetryMetrics}
          title="No pudimos cargar los indicadores de ventas"
        />
      ) : null}
      {isSummaryFailed ? (
        <ErrorState
          description={toReportErrorMessage(summaryError, "No pudimos cargar el resumen principal.")}
          onRetry={onRetrySummary}
          title="No pudimos cargar el resumen"
        />
      ) : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <DashboardKpiCard
          accentClassName="bg-primary/15"
          icon={Banknote}
          iconClassName="text-primary"
          label={salesLabel}
          trend={
            <>
              <DashboardKpiTrend
                changePercent={changePercent}
                comparisonLabel={comparisonLabel ?? "vs. periodo anterior"}
                neutralLabel={trendNeutralLabel}
              />
              <p className="mt-1 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">
                  {isMetricsPending ? "—" : salesCount}
                </span>{" "}
                ventas
                {salesCountDelta != null && salesCountDelta !== 0 ? (
                  <span className="text-xs">
                    {" "}
                    ({salesCountDelta > 0 ? "+" : ""}
                    {salesCountDelta})
                  </span>
                ) : null}
              </p>
            </>
          }
          value={salesValue}
        />
        <DashboardKpiCard
          accentClassName="bg-amber-500/15"
          icon={Percent}
          iconClassName="text-amber-600"
          label={vesLabel}
          trend={
            <p className="mt-2 text-sm text-muted-foreground">
              {isMetricsOffline ? (
                "Sin conexión"
              ) : isMetricsFailed ? (
                "Sin datos"
              ) : isMetricsLoading ? (
                "Calculando..."
              ) : (
                <>
                  <span className="font-medium text-foreground">
                    {formatVes(toFiniteNumber(metrics?.paidVes))}
                  </span>{" "}
                  cobrado ·{" "}
                  <span className="font-medium text-foreground">
                    {formatVes(toFiniteNumber(metrics?.pendingVes))}
                  </span>{" "}
                  pendiente
                </>
              )}
            </p>
          }
          value={vesValue}
        />
        <DashboardKpiCard
          accentClassName="bg-emerald-500/20"
          icon={Users}
          iconClassName="text-emerald-600"
          label="Total clientes"
          trend={
            isSummaryMissing ? (
              <p className="mt-2 text-sm text-muted-foreground">Sin datos</p>
            ) : isToday ? (
              <div className="mt-2 flex items-center gap-1 text-sm">
                <TrendingUp aria-hidden className="h-4 w-4 text-emerald-600" />
                <span className="font-medium text-emerald-600">
                  +{Math.min(toFiniteNumber(summary?.salesCount), 8)}
                </span>
                <span className="text-xs font-normal text-muted-foreground">ventas hoy</span>
              </div>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">Clientes activos en catálogo</p>
            )
          }
          value={isSummaryMissing ? "—" : String(toFiniteNumber(summary?.activeCustomers))}
        />
        <DashboardKpiCard
          accentClassName="bg-red-500/25"
          icon={AlertTriangle}
          iconClassName="text-red-600"
          label="Alertas stock"
          trend={
            <div className="mt-2 flex items-center gap-1 text-sm text-red-600">
              <ArrowDown aria-hidden className="h-4 w-4" />
              <span className="font-medium">Crítico</span>
              <span className="text-xs font-normal text-muted-foreground">requiere acción</span>
            </div>
          }
          value={isSummaryMissing ? "—" : String(toFiniteNumber(summary?.lowStockCount))}
          variant="alert"
        />
      </div>
    </>
  );
}
