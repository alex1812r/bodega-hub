"use client";

import type { DashboardPeriodState } from "@/modules/dashboard/hooks/useDashboardKpiPeriod";
import { InvalidUrlRangeNotice } from "@/modules/reports/reports-list/components/InvalidUrlRangeNotice";
import { DateRangeField } from "@/shared/components/DateRangeField";

type DashboardPeriodFieldProps = {
  className?: string;
  /** `presets` son los chips de la pantalla; sin ellos, los de por defecto. */
  period: Pick<DashboardPeriodState, "range" | "setRange" | "today"> &
    Partial<Pick<DashboardPeriodState, "presets" | "urlRangeWasInvalid">>;
};

/**
 * Único control de periodo del dashboard: indicadores, mix de pagos, cierre y
 * gráfico de ventas leen el mismo rango. Sin días futuros. Si la URL traía un
 * rango que no se puede usar, lo avisa encima (el periodo ya es el de por defecto).
 */
export function DashboardPeriodField({ className, period }: DashboardPeriodFieldProps) {
  return (
    <>
      <InvalidUrlRangeNotice show={Boolean(period.urlRangeWasInvalid)} />
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
    </>
  );
}
