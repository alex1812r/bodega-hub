"use client";

import { Filter } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { IconButton } from "@/shared/components/IconButton";
import { LoadingState } from "@/shared/components/LoadingState";
import { formatRef } from "@/shared/utils/currency";

import {
  type DashboardRequestScope,
  useDashboardSalesTrend,
} from "../hooks/useDashboard";
import {
  DASHBOARD_CHART_PERIODS,
  type DashboardChartPeriodDays,
  getChartDateRange,
  getChartPeriodLabel,
} from "../utils/chartPeriod";
import { buildChartSeries } from "../utils/chartSeries";
import { DashboardPeriodFilterModal } from "./DashboardPeriodFilterModal";

const CHART_PRIMARY = "#4f46e5";

type DashboardSalesChartCardProps = {
  scope?: DashboardRequestScope;
};

export function DashboardSalesChartCard({ scope }: DashboardSalesChartCardProps = {}) {
  const [periodDays, setPeriodDays] = useState<DashboardChartPeriodDays>(7);
  const [periodModalOpen, setPeriodModalOpen] = useState(false);
  const [draftPeriodDays, setDraftPeriodDays] = useState<DashboardChartPeriodDays>(7);
  const [chartReady, setChartReady] = useState(false);
  const range = useMemo(() => getChartDateRange(periodDays), [periodDays]);
  const trendQuery = useDashboardSalesTrend(range, scope);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setChartReady(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const chartData = useMemo(
    () => buildChartSeries(trendQuery.data?.items ?? [], range.from, range.to),
    [range.from, range.to, trendQuery.data?.items],
  );

  const maxValue = useMemo(
    () => Math.max(...chartData.map((point) => point.totalRef), 1),
    [chartData],
  );

  function openPeriodModal() {
    setDraftPeriodDays(periodDays);
    setPeriodModalOpen(true);
  }

  function applyPeriod() {
    setPeriodDays(draftPeriodDays);
    setPeriodModalOpen(false);
  }

  return (
    <div className="flex w-full min-w-0 flex-col rounded-xl border border-border bg-surface-container-lowest p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-foreground">
          Flujo de ventas ({getChartPeriodLabel(periodDays)})
        </h2>
        <IconButton
          aria-label="Filtrar periodo del grafico"
          className="text-muted-foreground hover:bg-surface-container hover:text-primary"
          icon={<Filter className="h-5 w-5" />}
          onClick={openPeriodModal}
          variant="ghost"
        />
      </div>

      <div className="h-64 min-h-64 w-full min-w-0 rounded-lg border border-border/30 bg-surface">
        {trendQuery.isLoading || !chartReady ? (
          <div className="flex h-full min-h-64 items-center justify-center">
            <LoadingState
              description="Cargando ventas del periodo seleccionado."
              title="Cargando grafico"
              variant="inline"
            />
          </div>
        ) : trendQuery.error ? (
          <p className="flex h-full min-h-64 items-center justify-center px-4 text-center text-sm text-red-600">
            No pudimos cargar el grafico de ventas.
          </p>
        ) : (
          <div className="h-64 w-full min-w-0">
            <ResponsiveContainer height="100%" minHeight={256} minWidth={0} width="100%">
              <BarChart data={chartData} margin={{ bottom: 8, left: 4, right: 8, top: 16 }}>
                <CartesianGrid stroke="#c7c4d8" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  axisLine={false}
                  dataKey="label"
                  tick={{ fill: "#464555", fontSize: 12 }}
                  tickLine={false}
                />
                <YAxis
                  axisLine={false}
                  domain={[0, maxValue]}
                  tick={{ fill: "#464555", fontSize: 12 }}
                  tickFormatter={(value) => formatRef(Number(value))}
                  tickLine={false}
                  width={72}
                />
                <Tooltip
                  cursor={{ fill: "rgba(79, 70, 229, 0.08)" }}
                  formatter={(value) => [formatRef(Number(value)), "Ventas"]}
                  labelFormatter={(label) => `Dia ${label}`}
                />
                <Bar
                  dataKey="totalRef"
                  fill={CHART_PRIMARY}
                  maxBarSize={48}
                  minPointSize={2}
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <DashboardPeriodFilterModal
        description="Selecciona el rango para el flujo de ventas."
        draftPeriodDays={draftPeriodDays}
        onApply={applyPeriod}
        onDraftPeriodChange={(days) => setDraftPeriodDays(days as DashboardChartPeriodDays)}
        onOpenChange={setPeriodModalOpen}
        open={periodModalOpen}
        periods={DASHBOARD_CHART_PERIODS}
        title="Periodo del grafico"
      />
    </div>
  );
}
