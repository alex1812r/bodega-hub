"use client";

import { useMemo } from "react";

import {
  type DailySalesSeries,
  type ReportGroupBy,
  toTimeSeriesPoints,
} from "@/modules/reports/services/reportSeries";
import { formatDateRangeLabel } from "@/shared/components/DateRangeField";
import { TimeSeriesChart, type TimeSeriesSeries } from "@/shared/components/TimeSeriesChart";
import { formatRef } from "@/shared/utils/currency";

import { type DashboardRequestScope, useDashboardSalesTrend } from "../hooks/useDashboard";
import { getBusinessTodayIsoDate } from "../utils/businessDate";
import { DashboardDeltaValue } from "./DashboardKpiTrend";
import { DASHBOARD_CHART_MIN_DAYS, resolveDashboardChartRange } from "../utils/dashboardPeriod";

/** Picos de venta que el gráfico destaca. */
const SALES_PEAK_COUNT = 3;

const GROUP_BY_LABELS: Record<ReportGroupBy, string> = {
  day: "por día",
  month: "por mes",
  week: "por semana",
};

const SERIES_FIELDS = { count: "count", valueRef: "totalRef", valueVes: "totalVes" } as const;

type DashboardSalesChartCardProps = {
  /** Periodo del dashboard. Sin él, hoy. */
  range?: { from: string; to: string };
  scope?: DashboardRequestScope;
};

function hasSales(series: DailySalesSeries) {
  const { current, previous } = series.totals;

  return current.count > 0 || current.totalRef !== 0 || (previous?.count ?? 0) > 0;
}

function toChartSeries(series: DailySalesSeries | null | undefined): TimeSeriesSeries[] {
  if (!series || !hasSales(series)) {
    return [];
  }

  return [
    {
      id: "sales",
      name: "Ventas",
      points: toTimeSeriesPoints(series.current, SERIES_FIELDS),
      previousPoints: toTimeSeriesPoints(series.previous, SERIES_FIELDS),
    },
  ];
}

/**
 * Flujo de ventas del periodo del dashboard: línea con los picos destacados y
 * el periodo anterior atenuado. Con un periodo de menos de 7 días muestra los
 * últimos 7 que terminan en su último día, para que siempre haya picos que ver.
 */
export function DashboardSalesChartCard({ range, scope }: DashboardSalesChartCardProps = {}) {
  const today = getBusinessTodayIsoDate();
  const from = range?.from ?? today;
  const to = range?.to ?? today;
  const chartRange = useMemo(() => resolveDashboardChartRange({ from, to }), [from, to]);
  const trend = useDashboardSalesTrend(
    { compare: true, from: chartRange.from, to: chartRange.to },
    scope,
  );
  const series = trend.data?.series;
  const chartSeries = useMemo(() => toChartSeries(series), [series]);

  return (
    <div className="flex w-full min-w-0 flex-col gap-4 rounded-xl border border-border bg-surface-container-lowest p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-foreground">Flujo de ventas</h2>
          <p className="text-sm text-on-surface-variant">
            {formatDateRangeLabel(chartRange.from, chartRange.to)}
            {series ? ` · ${GROUP_BY_LABELS[series.groupBy]}` : ""}
            {chartRange.widened
              ? ` · últimos ${DASHBOARD_CHART_MIN_DAYS} días (el periodo elegido es más corto)`
              : ""}
          </p>
        </div>
        {series ? (
          <div className="text-right">
            <p className="text-lg font-semibold tabular-nums text-foreground">
              {formatRef(series.totals.current.totalRef)}
            </p>
            <p className="text-xs text-on-surface-variant">
              <DashboardDeltaValue deltaPct={series.totals.deltaPct} testId="sales-chart-delta" />{" "}
              vs. periodo anterior
            </p>
          </div>
        ) : null}
      </div>

      <TimeSeriesChart
        ariaLabel="Flujo de ventas"
        emptyDescription="Prueba con otro periodo."
        emptyTitle="Sin ventas en este periodo"
        error={trend.error ? "No pudimos cargar el flujo de ventas." : null}
        loading={trend.isLoading}
        onRetry={() => void trend.refetch()}
        peakCount={SALES_PEAK_COUNT}
        series={chartSeries}
      />
    </div>
  );
}
