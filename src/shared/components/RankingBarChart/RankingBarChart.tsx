"use client";

import { useEffect, useMemo, useState, type Ref } from "react";

import {
  CHART_COLORS,
  CHART_FONT_SIZE,
  CHART_PREVIOUS_SERIES_STYLE,
  getChartSeriesColor,
} from "@/shared/components/charts/chartTheme";
import { EmptyState } from "@/shared/components/EmptyState";
import { ErrorState } from "@/shared/components/ErrorState";
import { Skeleton } from "@/shared/components/Skeleton";
import { cn } from "@/shared/utils/cn";
import { formatRef } from "@/shared/utils/currency";

import {
  barSpan,
  computeBarScale,
  DEFAULT_TOP_N,
  formatDeltaPct,
  hasComparison,
  rankItems,
  summarizeRanking,
  truncateLabel,
  type RankingBarItem,
} from "./rankingData";

export type RankingBarChartProps = {
  /** Elementos en cualquier orden: el gráfico los ordena de mayor a menor. */
  items: readonly RankingBarItem[];
  /** Qué muestra el gráfico («Top productos»). Encabeza el resumen de `aria-label`. */
  ariaLabel: string;
  /** Cuántos elementos se dibujan como máximo. Por defecto 10. */
  topN?: number;
  /** Texto del valor al final de la barra. Por defecto, dinero en REF. */
  formatValue?: (value: number) => string;
  loading?: boolean;
  /** Mensaje de error; si viene, sustituye al gráfico. */
  error?: string | null;
  /** Con `error`, muestra el botón «Reintentar». */
  onRetry?: () => void;
  emptyTitle?: string;
  emptyDescription?: string;
  className?: string;
  /**
   * Contenedor del gráfico (`role="img"`), para exportarlo como imagen. Dentro
   * hay un único `<svg class="ranking-bar-chart-surface">`:
   *
   * ```ts
   * const svg = chartRef.current?.querySelector("svg.ranking-bar-chart-surface");
   * ```
   *
   * Igual que en `TimeSeriesChart`, los colores son `var(--token)` y
   * `color-mix(...)`: antes de serializar hay que copiar a un clon los
   * `getComputedStyle(nodo).fill` / `.stroke` del original. Mientras hay carga,
   * error o vacío no existe el contenedor (`null`).
   */
  ref?: Ref<HTMLDivElement>;
};

/** Ancho con el que se dibuja mientras no se ha medido el contenedor (y en SSR). */
const FALLBACK_WIDTH = 320;
const LABEL_FONT_SIZE = 12;
/** Ancho aproximado de un carácter respecto al tamaño de letra. */
const CHAR_RATIO = 0.6;
const LABEL_LINE_HEIGHT = 16;
const BAR_HEIGHT = 12;
const PREVIOUS_BAR_HEIGHT = 4;
const BAR_GAP = 2;
const ROW_GAP = 12;
const VALUE_GAP = 6;
const COLUMN_GAP = 12;
const MIN_BAR_WIDTH = 2;
const MIN_PLOT_WIDTH = 40;
const MIN_LABEL_CHARS = 4;
const SKELETON_ROW_HEIGHT = LABEL_LINE_HEIGHT + BAR_HEIGHT + ROW_GAP;

function textWidth(text: string, fontSize: number) {
  return [...text].length * fontSize * CHAR_RATIO;
}

/** Ancho real del nodo; 0 hasta que el navegador lo mide. */
function useMeasuredWidth() {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    if (!node || typeof ResizeObserver === "undefined") {
      return undefined;
    }

    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width ?? 0;

      setWidth(Number.isFinite(measured) && measured > 0 ? measured : 0);
    });

    observer.observe(node);

    return () => observer.disconnect();
  }, [node]);

  return { setNode, width };
}

/**
 * Ranking en barras horizontales, de mayor a menor: top productos, top
 * clientes, rentabilidad por producto, métodos de pago. Cada fila lleva el
 * nombre arriba (a todo el ancho, así cabe en 390 px) y debajo su barra con el
 * valor al final. Con `previousValue` añade una barra fina atenuada del periodo
 * anterior y el texto «Antes … · ↑ n %».
 *
 * Los valores negativos (una rentabilidad en pérdida) crecen hacia la izquierda
 * desde la línea de cero.
 *
 * Colores: solo tokens del tema, vía `chartTheme`.
 */
export function RankingBarChart({
  ariaLabel,
  className,
  emptyDescription = "Prueba con otro rango de fechas.",
  emptyTitle = "Sin datos para el ranking",
  error,
  formatValue = formatRef,
  items,
  loading = false,
  onRetry,
  ref,
  topN = DEFAULT_TOP_N,
}: RankingBarChartProps) {
  const { setNode, width: measuredWidth } = useMeasuredWidth();
  const ranked = useMemo(() => rankItems(items, topN), [items, topN]);
  const withComparison = useMemo(() => hasComparison(items), [items]);

  if (loading) {
    return (
      <div aria-label={`Cargando ${ariaLabel}`} className={className} role="status">
        <Skeleton className="w-full" style={{ height: SKELETON_ROW_HEIGHT * 5 }} />
      </div>
    );
  }

  if (error) {
    return (
      <div className={className}>
        <ErrorState description={error} onRetry={onRetry} title="No se pudo cargar el gráfico" />
      </div>
    );
  }

  if (ranked.length === 0) {
    return <EmptyState className={className} description={emptyDescription} title={emptyTitle} />;
  }

  const width = measuredWidth > 0 ? measuredWidth : FALLBACK_WIDTH;
  const rows = ranked.map((item) => ({
    comparisonText: withComparison
      ? `Antes ${item.previousValue === null ? "—" : formatValue(item.previousValue)} · ${formatDeltaPct(item.deltaPct)}`
      : "",
    item,
    valueText: formatValue(item.value),
  }));
  const valueColumn = Math.max(...rows.map((row) => textWidth(row.valueText, CHART_FONT_SIZE)));
  const comparisonColumn = Math.max(
    ...rows.map((row) => textWidth(row.comparisonText, CHART_FONT_SIZE)),
  );
  const plotWidth = Math.max(MIN_PLOT_WIDTH, width - valueColumn - VALUE_GAP);
  const labelWidth = width - (withComparison ? comparisonColumn + COLUMN_GAP : 0);
  const labelChars = Math.max(
    MIN_LABEL_CHARS,
    Math.floor(labelWidth / (LABEL_FONT_SIZE * CHAR_RATIO)),
  );
  const scale = computeBarScale(
    ranked.flatMap((item) => [item.value, withComparison ? (item.previousValue ?? 0) : 0]),
    plotWidth,
  );
  const barsHeight = BAR_HEIGHT + (withComparison ? BAR_GAP + PREVIOUS_BAR_HEIGHT : 0);
  const rowHeight = LABEL_LINE_HEIGHT + barsHeight + ROW_GAP;
  const height = rowHeight * rows.length - ROW_GAP;
  const color = getChartSeriesColor(0);
  const summary = summarizeRanking({ ariaLabel, formatValue, items: ranked, withComparison });

  return (
    <div aria-label={summary} className={cn("w-full min-w-0", className)} ref={ref} role="img">
      <div className="w-full min-w-0" ref={setNode}>
        <svg
          aria-hidden="true"
          className="ranking-bar-chart-surface block"
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
        >
          {scale.hasNegative ? (
            <line
              stroke={CHART_COLORS.axis}
              x1={scale.zeroX}
              x2={scale.zeroX}
              y1={0}
              y2={height}
            />
          ) : null}
          {rows.map(({ comparisonText, item, valueText }, index) => {
            const top = index * rowHeight;
            const barTop = top + LABEL_LINE_HEIGHT;
            const bar = barSpan(scale, item.value, MIN_BAR_WIDTH);
            const previousBar =
              item.previousValue === null
                ? null
                : barSpan(scale, item.previousValue, MIN_BAR_WIDTH);
            const fullLabel = `${item.rank}. ${item.label}`;

            return (
              <g data-rank={item.rank} key={item.id}>
                <text
                  fill={CHART_COLORS.label}
                  fontSize={LABEL_FONT_SIZE}
                  x={0}
                  y={top + LABEL_FONT_SIZE}
                >
                  <title>{fullLabel}</title>
                  {truncateLabel(fullLabel, labelChars)}
                </text>
                {withComparison ? (
                  <text
                    data-comparison=""
                    fill={CHART_COLORS.axisText}
                    fontSize={CHART_FONT_SIZE}
                    textAnchor="end"
                    x={width}
                    y={top + LABEL_FONT_SIZE}
                  >
                    {comparisonText}
                  </text>
                ) : null}
                <rect
                  data-bar="current"
                  fill={color}
                  height={BAR_HEIGHT}
                  rx={2}
                  width={bar.width}
                  x={bar.x}
                  y={barTop}
                />
                {previousBar ? (
                  <rect
                    data-bar="previous"
                    fill={color}
                    fillOpacity={CHART_PREVIOUS_SERIES_STYLE.strokeOpacity}
                    height={PREVIOUS_BAR_HEIGHT}
                    rx={1}
                    width={previousBar.width}
                    x={previousBar.x}
                    y={barTop + BAR_HEIGHT + BAR_GAP}
                  />
                ) : null}
                <text
                  data-value=""
                  fill={CHART_COLORS.label}
                  fontSize={CHART_FONT_SIZE}
                  fontWeight={600}
                  x={(item.value < 0 ? scale.zeroX : bar.x + bar.width) + VALUE_GAP}
                  y={barTop + BAR_HEIGHT - 2}
                >
                  {valueText}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
