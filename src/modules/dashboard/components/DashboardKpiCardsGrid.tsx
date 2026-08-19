"use client";

import {
  AlertTriangle,
  ArrowDown,
  Banknote,
  Percent,
  TrendingUp,
  Users,
} from "lucide-react";

import { DashboardKpiCard } from "@/modules/dashboard/components/DashboardKpiCard";
import { DashboardKpiTrend } from "@/modules/dashboard/components/DashboardKpiTrend";
import type {
  DashboardMetrics,
  DashboardSummary,
} from "@/modules/dashboard/hooks/useDashboard";
import type { DashboardKpiPreset } from "@/modules/dashboard/utils/kpiPeriod";
import { kpiChangePercent } from "@/modules/dashboard/utils/kpiPeriod";
import { formatRef, formatVes } from "@/shared/utils/currency";

type DashboardKpiCardsGridProps = {
  comparisonLabel?: string | null;
  isMetricsLoading?: boolean;
  isPreviousLoading?: boolean;
  metrics?: DashboardMetrics;
  previousMetrics?: DashboardMetrics;
  preset: DashboardKpiPreset;
  summary?: DashboardSummary;
};

function salesCardLabel(preset: DashboardKpiPreset) {
  if (preset === "hoy") {
    return "Ventas del dia";
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

export function DashboardKpiCardsGrid({
  comparisonLabel,
  isMetricsLoading = false,
  isPreviousLoading = false,
  metrics,
  previousMetrics,
  preset,
  summary,
}: DashboardKpiCardsGridProps) {
  const isToday = preset === "hoy";
  const salesLabel = salesCardLabel(preset);
  const vesLabel = vesCardLabel(preset);
  const hasPreviousPeriod = preset !== "desde_inicio";

  const salesValue = isMetricsLoading ? "—" : formatRef(metrics?.totalRef ?? 0);
  const vesValue = isMetricsLoading ? "—" : formatVes(metrics?.totalVes ?? 0);
  const salesCount = metrics?.salesCount ?? 0;
  const salesCountDelta =
    !isPreviousLoading && previousMetrics ? salesCount - previousMetrics.salesCount : null;

  const changePercent =
    isMetricsLoading || isPreviousLoading
      ? null
      : kpiChangePercent(metrics?.totalRef ?? 0, previousMetrics?.totalRef);

  const trendNeutralLabel = !hasPreviousPeriod
    ? "Sin periodo anterior comparable"
    : isPreviousLoading
      ? "Comparando..."
      : "Sin datos del periodo anterior";

  return (
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
              comparisonLabel={comparisonLabel ?? "vs periodo anterior"}
              neutralLabel={trendNeutralLabel}
            />
            <p className="mt-1 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">
                {isMetricsLoading ? "—" : salesCount}
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
            {isMetricsLoading ? (
              "Calculando..."
            ) : (
              <>
                <span className="font-medium text-foreground">
                  {formatVes(metrics?.paidVes ?? 0)}
                </span>{" "}
                cobrado ·{" "}
                <span className="font-medium text-foreground">
                  {formatVes(metrics?.pendingVes ?? 0)}
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
          isToday ? (
            <div className="mt-2 flex items-center gap-1 text-sm">
              <TrendingUp aria-hidden className="h-4 w-4 text-emerald-600" />
              <span className="font-medium text-emerald-600">
                +{Math.min(summary?.salesCount ?? 0, 8)}
              </span>
              <span className="text-xs font-normal text-muted-foreground">ventas hoy</span>
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">Clientes activos en catalogo</p>
          )
        }
        value={String(summary?.activeCustomers ?? 0)}
      />
      <DashboardKpiCard
        accentClassName="bg-red-500/25"
        icon={AlertTriangle}
        iconClassName="text-red-600"
        label="Alertas stock"
        trend={
          <div className="mt-2 flex items-center gap-1 text-sm text-red-600">
            <ArrowDown aria-hidden className="h-4 w-4" />
            <span className="font-medium">Critico</span>
            <span className="text-xs font-normal text-muted-foreground">requiere accion</span>
          </div>
        }
        value={String(summary?.lowStockCount ?? 0)}
        variant="alert"
      />
    </div>
  );
}
