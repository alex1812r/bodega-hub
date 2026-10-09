"use client";

import type { DashboardPeriodState } from "@/modules/dashboard/hooks/useDashboardKpiPeriod";
import { DateRangeField } from "@/shared/components/DateRangeField";

type DashboardPeriodFieldProps = {
  className?: string;
  /** `presets` son los chips de la pantalla; sin ellos, los de por defecto. */
  period: Pick<DashboardPeriodState, "range" | "setRange" | "today"> &
    Partial<Pick<DashboardPeriodState, "presets">>;
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
      presets={period.presets}
      size="sm"
      today={period.today}
      value={period.range}
    />
  );
}
