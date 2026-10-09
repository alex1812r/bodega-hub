"use client";

import { useMemo, useState, type Ref } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  usePlotArea,
  useXAxisScale,
  useYAxisScale,
  XAxis,
  YAxis,
} from "recharts";

import {
  CHART_COLORS,
  CHART_FONT_SIZE,
  CHART_PREVIOUS_SERIES_STYLE,
  CHART_SERIES_STYLE,
  getChartSeriesColor,
} from "@/shared/components/charts/chartTheme";
import { EmptyState } from "@/shared/components/EmptyState";
import { ErrorState } from "@/shared/components/ErrorState";
import { Skeleton } from "@/shared/components/Skeleton";
import { cn } from "@/shared/utils/cn";

import {
  buildRows,
  formatMoney,
  hasPreviousPeriod,
  hasVesValues,
  pointValue,
  summarizeChart,
  type TimeSeriesCurrency,
  type TimeSeriesRow,
  type TimeSeriesSeries,
  type TimeSeriesSummaryMode,
} from "./chartData";
import { findPeaks, layoutPeakLabels } from "./peaks";
import { computeYScale, formatAxisValue } from "./scale";
import { TimeSeriesTooltip } from "./TimeSeriesTooltip";

export type TimeSeriesChartProps = {
  /**
   * De 1 a N series con nombre. La paleta distingue hasta 5
   * (`CHART_MAX_SERIES`); con más, los colores se repiten. Con más de una se
   * muestra la leyenda.
   */
  series: readonly TimeSeriesSeries[];
  /** Qué muestra el gráfico («Ventas diarias»). Encabeza el resumen de `aria-label`. */
  ariaLabel: string;
  /** Qué cuenta `count` en el tooltip, en plural y minúscula. Por defecto «ventas». */
  countLabel?: string;
  /**
   * Cuántos picos (máximos locales más altos) se destacan por serie. Por
   * defecto 3; 0 los apaga. La etiqueta de valor solo se dibuja con una serie.
   */
  peakCount?: number;
  /**
   * Máximo de puntos con marcador individual. Por encima (rangos largos) solo
   * quedan los marcadores de los picos. Por defecto 60.
   */
  markerLimit?: number;
  /** Moneda del eje Y, en modo controlado. */
  currency?: TimeSeriesCurrency;
  /** Moneda inicial en modo no controlado. Por defecto REF. */
  defaultCurrency?: TimeSeriesCurrency;
  onCurrencyChange?: (currency: TimeSeriesCurrency) => void;
  /**
   * No dibuja el control REF / Bs: la moneda la elige quien usa el gráfico, con
   * su propio control, y la pasa en `currency`. Por defecto `false`.
   */
  hideCurrencyToggle?: boolean;
  /**
   * Cifra de cada serie en el resumen accesible (`aria-label`). `sum` (por
   * defecto): total de sus puntos. `last`: su último valor, para un acumulado
   * o un saldo. `none`: solo el rango.
   */
  summary?: TimeSeriesSummaryMode;
  loading?: boolean;
  /** Mensaje de error; si viene, sustituye al gráfico. */
  error?: string | null;
  /** Con `error`, muestra el botón «Reintentar». */
  onRetry?: () => void;
  emptyTitle?: string;
  emptyDescription?: string;
  /** Alto del gráfico en px. Por defecto 280. */
  height?: number;
  className?: string;
  /**
   * Contenedor del gráfico (`role="img"`), para exportarlo como imagen. Dentro
   * hay un único `<svg class="recharts-surface">`:
   *
   * ```ts
   * const svg = chartRef.current?.querySelector("svg.recharts-surface");
   * ```
   *
   * Los colores del SVG son `var(--token)`: fuera del documento no se
   * resuelven. Antes de serializar con `XMLSerializer`, copia a
   * cada nodo de un clon su `getComputedStyle(nodo).stroke` / `.fill` / `.color`
   * leídos del original. La leyenda y el control REF / Bs son HTML y quedan
   * fuera. Mientras hay carga, error o vacío no existe el contenedor (`null`).
   */
  ref?: Ref<HTMLDivElement>;
};

const DEFAULT_HEIGHT = 280;
const DEFAULT_PEAK_COUNT = 3;
const DEFAULT_MARKER_LIMIT = 60;
/** Ancho aproximado de un carácter de etiqueta respecto al tamaño de letra. */
const LABEL_CHAR_RATIO = 0.6;
/** Separación horizontal mínima entre dos etiquetas de pico, en px. */
const PEAK_LABEL_GAP = 4;

const CURRENCY_OPTIONS: { label: string; value: TimeSeriesCurrency }[] = [
  { label: "REF", value: "ref" },
  { label: "Bs", value: "ves" },
];

type DrawnSeries = {
  id: string;
  name: string;
  color: string;
  hasPrevious: boolean;
  /** El periodo anterior llega a verse en el gráfico (y por eso va en la leyenda). */
  previousIsVisible: boolean;
  /** Valor de cada fila en la moneda activa. */
  values: (number | null)[];
};

type CurrencyToggleProps = {
  value: TimeSeriesCurrency;
  onChange: (currency: TimeSeriesCurrency) => void;
};

function CurrencyToggle({ onChange, value }: CurrencyToggleProps) {
  return (
    <div
      aria-label="Moneda del gráfico"
      className="inline-flex shrink-0 rounded-lg border border-outline bg-surface-container-lowest p-0.5"
      role="group"
    >
      {CURRENCY_OPTIONS.map((option) => {
        const selected = option.value === value;

        return (
          <button
            aria-pressed={selected}
            className={cn(
              "min-h-9 min-w-11 rounded-md px-3 text-xs font-semibold transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
              selected
                ? "bg-primary text-on-primary"
                : "text-on-surface-variant hover:bg-surface-container",
            )}
            key={option.value}
            onClick={() => onChange(option.value)}
            type="button"
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

type ChartLegendProps = {
  series: readonly DrawnSeries[];
};

function ChartLegend({ series }: ChartLegendProps) {
  return (
    <ul className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-on-surface-variant">
      {series.map((item) => (
        <li className="flex min-w-0 items-center gap-1.5" key={item.id}>
          <span
            aria-hidden="true"
            className="h-0.5 w-4 shrink-0 rounded-full"
            style={{ backgroundColor: item.color }}
          />
          <span className="truncate">{item.name}</span>
        </li>
      ))}
      {series.some((item) => item.previousIsVisible) ? (
        <li className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="w-4 shrink-0 border-t-2 border-dashed border-on-surface-variant opacity-60"
          />
          Periodo anterior
        </li>
      ) : null}
    </ul>
  );
}

type PeakMarkersProps = {
  currency: TimeSeriesCurrency;
  peakCount: number;
  rows: readonly TimeSeriesRow[];
  series: readonly DrawnSeries[];
};

/**
 * Marcador destacado en los picos de cada serie y, con una sola serie, la
 * etiqueta con su valor. Qué puntos son pico sale solo de los datos. Se monta
 * dentro del `LineChart` porque colocar las etiquetas sí necesita las escalas y
 * el área de dibujo reales: en un gráfico estrecho se apartan para no pisarse
 * y, si no caben, el pico más bajo se queda solo con su marcador.
 */
function PeakMarkers({ currency, peakCount, rows, series }: PeakMarkersProps) {
  const plot = usePlotArea();
  const xScale = useXAxisScale();
  const yScale = useYAxisScale();

  if (!plot || !xScale || !yScale || peakCount <= 0) {
    return null;
  }

  const withLabels = series.length === 1;

  return series.flatMap((item) => {
    const peaks = findPeaks(item.values, peakCount).flatMap((index) => {
      const value = item.values[index];
      const cx = xScale(rows[index].key);
      const cy = value === null ? undefined : yScale(value);

      if (value === null || cx === undefined || cy === undefined) {
        return [];
      }

      const label = formatMoney(value, currency);

      return [
        {
          cx,
          cy,
          key: rows[index].key,
          label,
          textWidth: label.length * CHART_FONT_SIZE * LABEL_CHAR_RATIO,
          value,
        },
      ];
    });
    const labelPositions = withLabels
      ? layoutPeakLabels(peaks, {
          fontSize: CHART_FONT_SIZE,
          gap: PEAK_LABEL_GAP,
          plot,
          radius: CHART_SERIES_STYLE.peakDotRadius,
        })
      : [];

    return peaks.map((peak, order) => {
      const position = labelPositions[order] ?? null;

      return (
        <ReferenceDot
          ifOverflow="extendDomain"
          key={`${item.id}:${peak.key}`}
          shape={({ cx = peak.cx, cy = peak.cy }) => (
            <g data-peak={peak.key}>
              <circle
                cx={cx}
                cy={cy}
                fill={item.color}
                r={CHART_SERIES_STYLE.peakDotRadius}
                stroke={CHART_COLORS.markerOutline}
                strokeWidth={2}
              />
              {position ? (
                <text
                  fill={CHART_COLORS.label}
                  fontSize={CHART_FONT_SIZE}
                  fontWeight={600}
                  paintOrder="stroke"
                  stroke={CHART_COLORS.markerOutline}
                  strokeLinejoin="round"
                  strokeWidth={3}
                  textAnchor="start"
                  x={position.x}
                  y={position.y}
                >
                  {peak.label}
                </text>
              ) : null}
            </g>
          )}
          x={peak.key}
          y={peak.value}
        />
      );
    });
  });
}

/**
 * Gráfico de línea para series temporales en dinero: ventas diarias del
 * dashboard, ganancia bruta, compras por periodo. Destaca los picos, compara
 * con el periodo anterior (línea discontinua atenuada) y cambia el eje Y entre
 * REF y Bs cuando los puntos traen `valueVes`.
 *
 * No agrupa ni convierte fechas: cada punto llega con su clave ya calculada
 * (día operativo de Caracas `yyyy-mm-dd`, o la clave de su semana o mes).
 *
 * Colores: solo tokens del tema, vía `chartTheme`.
 */
export function TimeSeriesChart({
  ariaLabel,
  className,
  countLabel = "ventas",
  currency,
  defaultCurrency = "ref",
  emptyDescription = "Prueba con otro rango de fechas.",
  emptyTitle = "Sin datos en este periodo",
  error,
  height = DEFAULT_HEIGHT,
  hideCurrencyToggle = false,
  loading = false,
  markerLimit = DEFAULT_MARKER_LIMIT,
  onCurrencyChange,
  onRetry,
  peakCount = DEFAULT_PEAK_COUNT,
  ref,
  series,
  summary: summaryMode = "sum",
}: TimeSeriesChartProps) {
  const [ownCurrency, setOwnCurrency] = useState<TimeSeriesCurrency>(defaultCurrency);
  const canShowVes = useMemo(() => hasVesValues(series), [series]);
  const activeCurrency: TimeSeriesCurrency = canShowVes ? (currency ?? ownCurrency) : "ref";

  const rows = useMemo(() => buildRows(series), [series]);
  const rowsByKey = useMemo(() => new Map(rows.map((row) => [row.key, row])), [rows]);

  const drawn = useMemo<DrawnSeries[]>(
    () =>
      series.map((item, index) => ({
        color: getChartSeriesColor(index),
        hasPrevious: hasPreviousPeriod(rows, item.id),
        id: item.id,
        // La línea del periodo anterior no lleva marcadores: con un solo punto no pinta nada.
        previousIsVisible: hasPreviousPeriod(rows, item.id) && rows.length > 1,
        name: item.name,
        values: rows.map((row) => pointValue(row.cells.get(item.id)?.current, activeCurrency)),
      })),
    [activeCurrency, rows, series],
  );

  const scale = useMemo(
    () =>
      computeYScale(
        rows.flatMap((row) =>
          [...row.cells.values()].flatMap((cell) => [
            pointValue(cell.current, activeCurrency),
            pointValue(cell.previous, activeCurrency),
          ]),
        ),
      ),
    [activeCurrency, rows],
  );

  const summary = useMemo(
    () => summarizeChart({ ariaLabel, currency: activeCurrency, mode: summaryMode, rows, series }),
    [activeCurrency, ariaLabel, rows, series, summaryMode],
  );

  function handleCurrencyChange(next: TimeSeriesCurrency) {
    setOwnCurrency(next);

    if (next !== activeCurrency) {
      onCurrencyChange?.(next);
    }
  }

  if (loading) {
    return (
      <div aria-label={`Cargando ${ariaLabel}`} className={className} role="status">
        <Skeleton className="w-full" style={{ height }} />
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

  if (rows.length === 0) {
    return <EmptyState className={className} description={emptyDescription} title={emptyTitle} />;
  }

  const showDots = rows.length <= markerLimit;
  const showLegend = drawn.length > 1 || drawn.some((item) => item.previousIsVisible);
  const showCurrencyToggle = canShowVes && !hideCurrencyToggle;

  return (
    <div className={cn("flex min-w-0 flex-col gap-3", className)}>
      {showLegend || showCurrencyToggle ? (
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2">
          {showLegend ? <ChartLegend series={drawn} /> : <span />}
          {showCurrencyToggle ? (
            <CurrencyToggle onChange={handleCurrencyChange} value={activeCurrency} />
          ) : null}
        </div>
      ) : null}
      <div
        aria-label={summary}
        className="w-full min-w-0"
        ref={ref}
        role="img"
        style={{ height }}
      >
        <ResponsiveContainer height={height} minWidth={0} width="100%">
          <LineChart
            accessibilityLayer={false}
            data={rows}
            margin={{ bottom: 0, left: 0, right: 12, top: 8 }}
          >
            <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="3 3" vertical={false} />
            <XAxis
              axisLine={{ stroke: CHART_COLORS.grid }}
              dataKey="key"
              interval="preserveStartEnd"
              minTickGap={24}
              padding={{ left: 12, right: 12 }}
              tick={{ fill: CHART_COLORS.axisText, fontSize: CHART_FONT_SIZE }}
              tickFormatter={(key: string) => rowsByKey.get(String(key))?.label ?? String(key)}
              tickLine={false}
            />
            <YAxis
              axisLine={false}
              domain={scale.domain}
              tick={{ fill: CHART_COLORS.axisText, fontSize: CHART_FONT_SIZE }}
              tickFormatter={formatAxisValue}
              tickLine={false}
              ticks={scale.ticks}
              width={52}
            />
            {scale.domain[0] < 0 ? <ReferenceLine stroke={CHART_COLORS.axis} y={0} /> : null}
            <Tooltip
              content={({ active, label }) => {
                const row = active ? rowsByKey.get(String(label)) : undefined;

                return row ? (
                  <TimeSeriesTooltip
                    countLabel={countLabel}
                    currency={activeCurrency}
                    row={row}
                    series={drawn}
                  />
                ) : null;
              }}
              cursor={{ stroke: CHART_COLORS.cursor, strokeDasharray: "3 3" }}
              isAnimationActive={false}
            />
            {drawn
              .filter((item) => item.hasPrevious)
              .map((item) => (
                <Line
                  activeDot={false}
                  className="time-series-previous"
                  dataKey={(row: TimeSeriesRow) =>
                    pointValue(row.cells.get(item.id)?.previous, activeCurrency)
                  }
                  dot={false}
                  isAnimationActive={false}
                  key={`${item.id}:previous`}
                  name={`${item.name} (periodo anterior)`}
                  stroke={item.color}
                  type="linear"
                  {...CHART_PREVIOUS_SERIES_STYLE}
                />
              ))}
            {drawn.map((item) => (
              <Line
                activeDot={{
                  fill: item.color,
                  r: CHART_SERIES_STYLE.activeDotRadius,
                  stroke: CHART_COLORS.markerOutline,
                  strokeWidth: 2,
                }}
                className="time-series-current"
                dataKey={(row: TimeSeriesRow) =>
                  pointValue(row.cells.get(item.id)?.current, activeCurrency)
                }
                dot={
                  showDots
                    ? { fill: item.color, r: CHART_SERIES_STYLE.dotRadius, strokeWidth: 0 }
                    : false
                }
                isAnimationActive={false}
                key={item.id}
                name={item.name}
                stroke={item.color}
                strokeWidth={CHART_SERIES_STYLE.strokeWidth}
                type="linear"
              />
            ))}
            <PeakMarkers
              currency={activeCurrency}
              peakCount={peakCount}
              rows={rows}
              series={drawn}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
