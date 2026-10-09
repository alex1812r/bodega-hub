"use client";

import {
  DEFAULT_TOP_N,
  RankingBarChart,
  type RankingBarItem,
} from "@/shared/components/RankingBarChart";

import type { ReportDefinition } from "../config/reportCatalog";
import { ReportChartCard } from "./ReportChartCard";

type ReportRankingChartProps = {
  error: Error | null;
  /** Texto del valor al final de la barra. Por defecto, dinero en REF. */
  formatValue?: (value: number) => string;
  isLoading: boolean;
  /** Filas de la página visible de la tabla, en cualquier orden. */
  items: readonly RankingBarItem[];
  /** Qué mide la barra («Unidades vendidas»). */
  measureLabel: string;
  onRetry: () => void;
  /** Rango aplicado, si el reporte usa fechas. */
  rangeLabel?: string;
  report: ReportDefinition;
};

/**
 * Ranking de un reporte en barras horizontales. Usa las filas de la página
 * visible de la tabla, ordenadas de mayor a menor: por eso la cabecera dice
 * «Top N de esta página».
 */
export function ReportRankingChart({
  error,
  formatValue,
  isLoading,
  items,
  measureLabel,
  onRetry,
  rangeLabel,
  report,
}: ReportRankingChartProps) {
  const shown = Math.min(items.length, DEFAULT_TOP_N);
  const subtitle = [
    shown > 0 ? `Top ${shown} de esta página` : "Top de esta página",
    measureLabel,
    rangeLabel,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <ReportChartCard subtitle={subtitle} title={report.name}>
      <RankingBarChart
        ariaLabel={`${report.name}: ${measureLabel.toLowerCase()}`}
        emptyDescription={
          rangeLabel ? "Prueba con otro rango de fechas." : "Aún no hay datos para este reporte."
        }
        error={error?.message}
        formatValue={formatValue}
        items={items}
        loading={isLoading}
        onRetry={onRetry}
        topN={DEFAULT_TOP_N}
      />
    </ReportChartCard>
  );
}
