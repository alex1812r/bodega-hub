"use client";

import type { DashboardPeriodState } from "@/modules/dashboard/hooks/useDashboardKpiPeriod";
import { DateRangeField } from "@/shared/components/DateRangeField";

type DashboardPeriodFieldProps = {
  className?: string;
  period: Pick<DashboardPeriodState, "range" | "setRange" | "today">;
};

/**
 * Único control de periodo del dashboard: indicadores, mix de pagos, cierre y
 * gráfico de ventas leen el mismo rango. Sin días futuros.
 */
export function DashboardPeriodField({ className, period }: DashboardPeriodFieldProps) {
  return (
    <DateRangeField
      className={className}
      label="Periodo"
      maxDate={period.today}
      onChange={period.setRange}
      size="sm"
      today={period.today}
      value={period.range}
    />
  );
}
