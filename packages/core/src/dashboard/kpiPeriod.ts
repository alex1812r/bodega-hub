import { shiftIsoDate } from "../dates/caracasBusinessDay";

export type KpiMetricsFilters = {
  from?: string;
  fromStart?: boolean;
  to?: string;
};

export const DASHBOARD_KPI_PERIODS = [
  { key: "hoy", label: "Hoy" },
  { key: "ayer", label: "Ayer" },
  { key: "rango", label: "Rango" },
  { key: "desde_inicio", label: "Desde el inicio" },
] as const;

export type DashboardKpiPreset = (typeof DASHBOARD_KPI_PERIODS)[number]["key"];

export type KpiCustomRange = {
  from: string;
  to: string;
};

export function inclusiveIsoDayCount(from: string, to: string) {
  const [fromYear, fromMonth, fromDay] = from.split("-").map(Number);
  const [toYear, toMonth, toDay] = to.split("-").map(Number);
  const start = Date.UTC(fromYear, (fromMonth ?? 1) - 1, fromDay ?? 1);
  const end = Date.UTC(toYear, (toMonth ?? 1) - 1, toDay ?? 1);

  return Math.max(Math.floor((end - start) / 86_400_000) + 1, 1);
}

/**
 * Rango que se manda a `/api/dashboard/metrics`.
 *
 * `today` es obligatorio a proposito: cada cliente decide cual es el dia
 * operativo (la web fija una fecha en modo mock, el movil usa el dia de
 * Caracas), y un valor por defecto aqui esconderia esa diferencia.
 */
export function resolveKpiMetricsFilters(
  preset: DashboardKpiPreset,
  customRange: KpiCustomRange | undefined,
  today: string,
): KpiMetricsFilters {
  if (preset === "hoy") {
    return { from: today, to: today };
  }

  if (preset === "ayer") {
    const yesterday = shiftIsoDate(today, -1);
    return { from: yesterday, to: yesterday };
  }

  if (preset === "desde_inicio") {
    return { fromStart: true, to: today };
  }

  return {
    from: customRange?.from || today,
    to: customRange?.to || today,
  };
}

/** Periodo anterior de la misma longitud, para la comparacion. */
export function resolvePreviousKpiMetricsFilters(
  preset: DashboardKpiPreset,
  customRange: KpiCustomRange | undefined,
  today: string,
): KpiMetricsFilters | null {
  if (preset === "desde_inicio") {
    return null;
  }

  const current = resolveKpiMetricsFilters(preset, customRange, today);
  if (!current.from || !current.to) {
    return null;
  }

  const length = inclusiveIsoDayCount(current.from, current.to);

  return {
    from: shiftIsoDate(current.from, -length),
    to: shiftIsoDate(current.from, -1),
  };
}

export function getKpiComparisonLabel(preset: DashboardKpiPreset) {
  if (preset === "hoy") {
    return "vs ayer";
  }

  if (preset === "ayer") {
    return "vs dia anterior";
  }

  if (preset === "rango") {
    return "vs periodo anterior";
  }

  return null;
}

function formatIsoDateLabel(isoDate: string) {
  const [year, month, day] = isoDate.split("-");
  if (!year || !month || !day) {
    return isoDate;
  }

  return `${day}/${month}/${year}`;
}

export function getKpiPeriodLabel(preset: DashboardKpiPreset, customRange?: KpiCustomRange) {
  if (preset === "rango" && customRange?.from && customRange?.to) {
    if (customRange.from === customRange.to) {
      return formatIsoDateLabel(customRange.from);
    }

    return `${formatIsoDateLabel(customRange.from)} - ${formatIsoDateLabel(customRange.to)}`;
  }

  return DASHBOARD_KPI_PERIODS.find((period) => period.key === preset)?.label ?? preset;
}

export function kpiChangePercent(current: number, previous: number | null | undefined) {
  if (previous == null || previous === 0) {
    return null;
  }

  return ((current - previous) / previous) * 100;
}
