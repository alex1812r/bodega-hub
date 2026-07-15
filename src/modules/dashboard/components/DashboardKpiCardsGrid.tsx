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
import type { DashboardKpiPeriodDays } from "@/modules/dashboard/utils/chartPeriod";
import { formatRef, formatVes } from "@/shared/utils/currency";

type DashboardKpiCardsGridProps = {
  isMetricsLoading?: boolean;
  metrics?: DashboardMetrics;
  periodDays: DashboardKpiPeriodDays;
  summary?: DashboardSummary;
};

export function DashboardKpiCardsGrid({
  isMetricsLoading = false,
  metrics,
  periodDays,
  summary,
}: DashboardKpiCardsGridProps) {
  const isToday = periodDays === 1;
  const salesLabel = isToday ? "Ventas del dia" : "Ventas del periodo";
  const vesLabel = isToday ? "Total VES" : "Total VES del periodo";

  const salesValue = isMetricsLoading
    ? "—"
    : formatRef(metrics?.totalRef ?? 0);
  const vesValue = isMetricsLoading ? "—" : formatVes(metrics?.totalVes ?? 0);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <DashboardKpiCard
        accentClassName="bg-primary/15"
        icon={Banknote}
        iconClassName="text-primary"
        label={salesLabel}
        trend={
          isToday ? (
            <DashboardKpiTrend changePercent={summary?.dayOverDayChangePercent} />
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">
                {isMetricsLoading ? "—" : (metrics?.salesCount ?? 0)}
              </span>{" "}
              ventas en el periodo
            </p>
          )
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
