import { getBusinessTodayIsoDate, shiftIsoDate } from "./businessDate";

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

export function isTruthyQueryParam(value: string | null) {
  if (value == null) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized !== "" && normalized !== "0" && normalized !== "false";
}

export function parseDashboardMetricsDateParams(searchParams: URLSearchParams) {
  const fromStart = isTruthyQueryParam(searchParams.get("fromStart"));

  return {
    from: fromStart ? null : searchParams.get("from"),
    fromStart,
    to: searchParams.get("to"),
  };
}

export function inclusiveIsoDayCount(from: string, to: string) {
  const [fromYear, fromMonth, fromDay] = from.split("-").map(Number);
  const [toYear, toMonth, toDay] = to.split("-").map(Number);
  const start = Date.UTC(fromYear, (fromMonth ?? 1) - 1, fromDay ?? 1);
  const end = Date.UTC(toYear, (toMonth ?? 1) - 1, toDay ?? 1);

  return Math.max(Math.floor((end - start) / 86_400_000) + 1, 1);
}

export function resolveKpiMetricsFilters(
  preset: DashboardKpiPreset,
  customRange?: KpiCustomRange,
  today: string = getBusinessTodayIsoDate(),
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

export function resolvePreviousKpiMetricsFilters(
  preset: DashboardKpiPreset,
  customRange?: KpiCustomRange,
  today: string = getBusinessTodayIsoDate(),
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
