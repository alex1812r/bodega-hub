import {
  resolveKpiMetricsFilters as resolveKpiMetricsFiltersCore,
  resolvePreviousKpiMetricsFilters as resolvePreviousKpiMetricsFiltersCore,
  type DashboardKpiPreset,
  type KpiCustomRange,
} from "@bodega/core/dashboard";

import { getBusinessTodayIsoDate } from "./businessDate";

export {
  DASHBOARD_KPI_PERIODS,
  getKpiComparisonLabel,
  getKpiPeriodLabel,
  inclusiveIsoDayCount,
  kpiChangePercent,
  type DashboardKpiPreset,
  type KpiCustomRange,
  type KpiMetricsFilters,
} from "@bodega/core/dashboard";

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

/**
 * El calculo vive en `@bodega/core/dashboard` para que el movil use el mismo.
 * Aqui solo se aporta el dia operativo de la web, que en modo mock es una fecha
 * fija.
 */
export function resolveKpiMetricsFilters(
  preset: DashboardKpiPreset,
  customRange?: KpiCustomRange,
  today: string = getBusinessTodayIsoDate(),
) {
  return resolveKpiMetricsFiltersCore(preset, customRange, today);
}

export function resolvePreviousKpiMetricsFilters(
  preset: DashboardKpiPreset,
  customRange?: KpiCustomRange,
  today: string = getBusinessTodayIsoDate(),
) {
  return resolvePreviousKpiMetricsFiltersCore(preset, customRange, today);
}
