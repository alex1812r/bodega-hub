"use client";

import { useMemo } from "react";

import { formatDateRangeLabel } from "@/shared/components/DateRangeField";
import { TimeSeriesChart, type TimeSeriesPoint } from "@/shared/components/TimeSeriesChart";
import { formatRef } from "@/shared/utils/currency";

import type { ReportDateRangeFilters } from "../../hooks/useReports";
import {
  toTimeSeriesPoints,
  type ReportGroupBy,
  type ReportSeries,
  type ReportSeriesMeasures,
} from "../../services/reportSeries";
import type { ReportDefinition } from "../config/reportCatalog";
import { ReportChartCard, type ReportDeltaTone } from "./ReportChartCard";

const GROUP_BY_LABELS: Record<ReportGroupBy, string> = {
  day: "día",
  month: "mes",
  week: "semana",
};

/**
 * Aviso cuando la agrupación que se ve no es la que el usuario espera: la
 * automática dejó de ser por día (rangos largos), o el servidor devolvió una
 * distinta de la pedida.
 */
export function getGroupingNotice(
  requested: ReportDateRangeFilters["groupBy"],
  effective: ReportGroupBy | undefined,
) {
  if (!effective) {
    return null;
  }

  const isAutomatic = requested === undefined || requested === "auto";
  const isExpected = isAutomatic ? effective === "day" : effective === requested;

  return isExpected ? null : `Agrupado por ${GROUP_BY_LABELS[effective]} automáticamente.`;
}

function hasMovement(point: TimeSeriesPoint) {
  return point.valueRef !== 0 || Boolean(point.count);
}

export type ReportSeriesChartMeasure<M extends ReportSeriesMeasures> = {
  /** Nº de operaciones por periodo, para el tooltip. */
  count?: keyof M & string;
  /** Qué cuenta `count`, en plural y minúscula («ventas»). */
  countLabel?: string;
  /** Color de la variación: en compras subir no es «bueno». */
  deltaTone?: ReportDeltaTone;
  /** Nombre de la serie en la leyenda y el tooltip. */
  name: string;
  /** Etiqueta del total junto al título («Total vendido»). */
  totalLabel: string;
  /** Medida que se dibuja; es la misma sobre la que el servicio calcula `deltaPct`. */
  valueRef: keyof M & string;
  valueVes?: keyof M & string;
};

type ReportSeriesChartProps<M extends ReportSeriesMeasures> = {
  error: Error | null;
  /** Filtros de fecha que se enviaron al reporte (`toReportDateFilters`). */
  filters: ReportDateRangeFilters;
  isLoading: boolean;
  measure: ReportSeriesChartMeasure<M>;
  onRetry: () => void;
  report: ReportDefinition;
  series: ReportSeries<M> | undefined;
};

/**
 * Gráfico de línea de un reporte de serie (ventas diarias, ganancia bruta,
 * compras): una sola medida, con el periodo anterior superpuesto y la variación
 * del total cuando se compara.
 */
export function ReportSeriesChart<M extends ReportSeriesMeasures>({
  error,
  filters,
  isLoading,
  measure,
  onRetry,
  report,
  series,
}: ReportSeriesChartProps<M>) {
  const { count, name, valueRef, valueVes } = measure;
  const hasFullRange = Boolean(filters.from && filters.to);
  const buckets = series?.current;
  const previousBuckets = series?.previous;
  const chartSeries = useMemo(() => {
    const fields = { count, valueRef, valueVes };
    const points = toTimeSeriesPoints(buckets, fields);
    const previousPoints = toTimeSeriesPoints(previousBuckets, fields);
    // Un periodo sin movimiento llega relleno de ceros: el actual se muestra como
    // estado vacío y el anterior no se dibuja (una línea plana en 0 no dice nada).
    const hasData = points.some(hasMovement);

    return [
      {
        id: report.id,
        name,
        points: hasData ? points : [],
        previousPoints: hasData && previousPoints.some(hasMovement) ? previousPoints : [],
      },
    ];
  }, [buckets, count, name, previousBuckets, report.id, valueRef, valueVes]);
  const isCompared = Boolean(previousBuckets);

  return (
    <ReportChartCard
      delta={
        series && isCompared
          ? { deltaPct: series.totals.deltaPct, tone: measure.deltaTone }
          : undefined
      }
      notice={getGroupingNotice(filters.groupBy, series?.groupBy)}
      subtitle={
        series
          ? `${formatDateRangeLabel(filters.from, filters.to)} · por ${GROUP_BY_LABELS[series.groupBy]}`
          : formatDateRangeLabel(filters.from, filters.to)
      }
      title={report.name}
      total={
        series
          ? { label: measure.totalLabel, value: formatRef(series.totals.current[valueRef]) }
          : undefined
      }
    >
      <TimeSeriesChart
        ariaLabel={report.name}
        countLabel={measure.countLabel}
        emptyDescription={
          hasFullRange
            ? "Prueba con otro rango de fechas."
            : "El gráfico necesita un rango con fecha de inicio y de fin."
        }
        emptyTitle={hasFullRange ? "Sin datos en este periodo" : "Elige un rango de fechas"}
        error={error?.message}
        loading={isLoading}
        onRetry={onRetry}
        series={chartSeries}
      />
    </ReportChartCard>
  );
}
