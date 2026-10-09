import {
  DATE_RANGE_PRESET_LABELS,
  type DateRangePreset,
  type DateRangeValue,
  formatDateRangeLabel,
  resolveDateRangePreset,
} from "@/shared/components/DateRangeField";

import { shiftIsoDate } from "./businessDate";
import {
  type DashboardKpiPreset,
  inclusiveIsoDayCount,
  type KpiMetricsFilters,
  resolvePreviousKpiMetricsFilters,
} from "./kpiPeriod";

/** El gráfico necesita varios puntos para que se vean picos: nunca menos de 7 días. */
export const DASHBOARD_CHART_MIN_DAYS = 7;

/** Periodo del dashboard ya resuelto: días operativos de Caracas, ambos incluidos. */
export type DashboardPeriodRange = {
  from: string;
  preset: DateRangePreset;
  to: string;
};

export type DashboardPeriod = {
  /** "vs ayer", "vs el día anterior" o "vs los 30 días anteriores". */
  comparisonLabel: string;
  currentFilters: KpiMetricsFilters;
  /** "Hoy", "Mes pasado" o "1–7 may 2026". */
  kpiPeriodLabel: string;
  /** Preset de las tarjetas KPI (`@bodega/core/dashboard`): hoy, ayer o rango. */
  preset: DashboardKpiPreset;
  /** Mismo nº de días inmediatamente antes de `range.from`. */
  previousFilters: KpiMetricsFilters | null;
  range: DashboardPeriodRange;
};

/**
 * Rango tal como llega de la URL o de `DateRangeField` → periodo completo. Sin
 * fechas vale el preset relativo calculado con `today`; sin nada, hoy (el
 * periodo por defecto del dashboard). Con un solo extremo, ese día.
 */
export function normalizeDashboardRange(
  value: DateRangeValue,
  today: string,
): DashboardPeriodRange {
  if (!value.from && !value.to) {
    const preset = value.preset && value.preset !== "custom" ? value.preset : "today";

    return { ...resolveDateRangePreset(preset, today), preset };
  }

  const from = value.from ?? value.to ?? today;
  const to = value.to ?? value.from ?? today;

  return {
    from,
    preset: value.preset ?? (from === today && to === today ? "today" : "custom"),
    to,
  };
}

function resolveKpiPreset(range: DashboardPeriodRange, today: string): DashboardKpiPreset {
  if (range.from !== range.to) {
    return "rango";
  }

  if (range.from === today) {
    return "hoy";
  }

  return range.from === shiftIsoDate(today, -1) ? "ayer" : "rango";
}

function resolveComparisonLabel(range: DashboardPeriodRange, today: string) {
  const days = inclusiveIsoDayCount(range.from, range.to);

  if (days > 1) {
    return `vs los ${days} días anteriores`;
  }

  return range.from === today ? "vs ayer" : "vs el día anterior";
}

/**
 * Filtros de KPI, periodo anterior y etiquetas de un rango del dashboard.
 *
 * El periodo anterior es siempre el de igual duración justo antes (también en
 * "Este mes" y "Mes pasado", que no se comparan con el mes de calendario
 * anterior): la etiqueta dice cuántos días son.
 */
export function describeDashboardPeriod(range: DashboardPeriodRange, today: string): DashboardPeriod {
  const currentFilters = { from: range.from, to: range.to };

  return {
    comparisonLabel: resolveComparisonLabel(range, today),
    currentFilters,
    kpiPeriodLabel:
      range.preset === "custom"
        ? formatDateRangeLabel(range.from, range.to)
        : DATE_RANGE_PRESET_LABELS[range.preset],
    preset: resolveKpiPreset(range, today),
    previousFilters: resolvePreviousKpiMetricsFilters("rango", currentFilters, today),
    range,
  };
}

/**
 * Ventana del gráfico de ventas: el rango elegido o, si tiene menos de
 * `DASHBOARD_CHART_MIN_DAYS` días, los últimos 7 que terminan en su `to`.
 */
export function resolveDashboardChartRange(range: { from: string; to: string }) {
  if (inclusiveIsoDayCount(range.from, range.to) >= DASHBOARD_CHART_MIN_DAYS) {
    return { from: range.from, to: range.to, widened: false };
  }

  return {
    from: shiftIsoDate(range.to, -(DASHBOARD_CHART_MIN_DAYS - 1)),
    to: range.to,
    widened: true,
  };
}
