import {
  type AnyDateRangePreset,
  DATE_RANGE_PRESET_LABELS,
  DATE_RANGE_PRESETS,
  type DateRangePreset,
  type DateRangeValue,
  EXTENDED_DATE_RANGE_PRESETS,
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

/** Periodos del dashboard de tienda: los chips por defecto de `DateRangeField`. */
export const DASHBOARD_STORE_PRESETS: readonly DateRangePreset[] = DATE_RANGE_PRESETS;

/**
 * Periodos del dashboard de plataforma: los de tienda más 14 días, 3 meses,
 * 6 meses y "Desde el inicio". "Personalizado" sigue al final.
 */
export const DASHBOARD_PLATFORM_PRESETS: readonly AnyDateRangePreset[] = [
  ...DATE_RANGE_PRESETS.filter((preset) => preset !== "custom"),
  ...EXTENDED_DATE_RANGE_PRESETS,
  "custom",
];

/**
 * Periodo del dashboard ya resuelto: días operativos de Caracas, ambos
 * incluidos. Sin `from` solo con el preset `all_time` ("Desde el inicio").
 */
export type DashboardPeriodRange = {
  from?: string;
  preset: AnyDateRangePreset;
  to: string;
};

export type DashboardPeriod = {
  /**
   * "vs ayer", "vs el día anterior" o "vs los 30 días anteriores". `null` desde
   * el inicio: no hay periodo anterior comparable.
   */
  comparisonLabel: string | null;
  currentFilters: KpiMetricsFilters;
  /** "Hoy", "Mes pasado" o "1–7 may 2026". */
  kpiPeriodLabel: string;
  /** Preset de las tarjetas KPI (`@bodega/core/dashboard`): hoy, ayer, rango o desde el inicio. */
  preset: DashboardKpiPreset;
  /** Mismo nº de días inmediatamente antes de `range.from`; `null` desde el inicio. */
  previousFilters: KpiMetricsFilters | null;
  range: DashboardPeriodRange;
};

/**
 * Rango tal como llega de la URL o de `DateRangeField` → periodo completo. Sin
 * fechas vale el preset relativo calculado con `today`; sin nada, hoy (el
 * periodo por defecto del dashboard). Con un solo extremo, ese día. El preset
 * `all_time` no tiene `from`: va desde el inicio hasta hoy.
 */
export function normalizeDashboardRange(
  value: DateRangeValue<AnyDateRangePreset>,
  today: string,
): DashboardPeriodRange {
  if (value.preset === "all_time") {
    if (!value.from) {
      return { preset: "all_time", to: value.to ?? today };
    }
  } else if (!value.from && !value.to) {
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

type BoundedDashboardRange = DashboardPeriodRange & { from: string };

function resolveKpiPreset(range: BoundedDashboardRange, today: string): DashboardKpiPreset {
  if (range.from !== range.to) {
    return "rango";
  }

  if (range.from === today) {
    return "hoy";
  }

  return range.from === shiftIsoDate(today, -1) ? "ayer" : "rango";
}

function resolveComparisonLabel(range: BoundedDashboardRange, today: string) {
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
 * anterior): la etiqueta dice cuántos días son. Desde el inicio las métricas
 * se piden con `fromStart` y no hay periodo anterior.
 */
export function describeDashboardPeriod(range: DashboardPeriodRange, today: string): DashboardPeriod {
  const { from } = range;

  if (from === undefined) {
    return {
      comparisonLabel: null,
      currentFilters: { fromStart: true, to: range.to },
      kpiPeriodLabel: DATE_RANGE_PRESET_LABELS.all_time,
      preset: "desde_inicio",
      previousFilters: null,
      range,
    };
  }

  const bounded = { ...range, from };
  const currentFilters = { from, to: range.to };

  return {
    comparisonLabel: resolveComparisonLabel(bounded, today),
    currentFilters,
    kpiPeriodLabel:
      range.preset === "custom"
        ? formatDateRangeLabel(from, range.to)
        : DATE_RANGE_PRESET_LABELS[range.preset],
    preset: resolveKpiPreset(bounded, today),
    previousFilters: resolvePreviousKpiMetricsFilters("rango", currentFilters, today),
    range,
  };
}

/**
 * Ventana del gráfico de ventas: el rango elegido o, si tiene menos de
 * `DASHBOARD_CHART_MIN_DAYS` días, los últimos 7 que terminan en su `to`. Sin
 * `from` (desde el inicio) la ventana queda abierta: el servidor la empieza
 * en el primer día con ventas.
 */
export function resolveDashboardChartRange(range: { from?: string; to: string }): {
  from: string | undefined;
  to: string;
  widened: boolean;
} {
  if (
    range.from === undefined ||
    inclusiveIsoDayCount(range.from, range.to) >= DASHBOARD_CHART_MIN_DAYS
  ) {
    return { from: range.from, to: range.to, widened: false };
  }

  return {
    from: shiftIsoDate(range.to, -(DASHBOARD_CHART_MIN_DAYS - 1)),
    to: range.to,
    widened: true,
  };
}
