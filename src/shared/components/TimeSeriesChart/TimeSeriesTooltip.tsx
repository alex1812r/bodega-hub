import { CHART_TOOLTIP_COLORS } from "@/shared/components/charts/chartTheme";

import {
  formatMoney,
  formatPointLabel,
  pointValue,
  type TimeSeriesCurrency,
  type TimeSeriesRow,
} from "./chartData";

export type TimeSeriesTooltipSeries = {
  id: string;
  name: string;
  color: string;
};

type TimeSeriesTooltipProps = {
  row: TimeSeriesRow;
  series: readonly TimeSeriesTooltipSeries[];
  /** Moneda del eje: su valor va destacado; la otra, en la línea secundaria. */
  currency: TimeSeriesCurrency;
  /** Qué cuenta `count`, en plural y minúscula: «ventas», «compras». */
  countLabel: string;
};

function capitalize(text: string) {
  return text.charAt(0).toLocaleUpperCase("es") + text.slice(1);
}

/**
 * Contenido del tooltip de `TimeSeriesChart`: fecha del punto y, por serie, el
 * valor en REF y en Bs, el nº de operaciones y el valor del periodo anterior.
 */
export function TimeSeriesTooltip({ countLabel, currency, row, series }: TimeSeriesTooltipProps) {
  const other: TimeSeriesCurrency = currency === "ref" ? "ves" : "ref";

  return (
    <div
      className="max-w-64 rounded-lg border px-3 py-2 text-xs shadow-md"
      style={{
        backgroundColor: CHART_TOOLTIP_COLORS.background,
        borderColor: CHART_TOOLTIP_COLORS.border,
        color: CHART_TOOLTIP_COLORS.text,
      }}
    >
      <p className="font-semibold">{capitalize(row.title)}</p>
      <ul className="mt-1.5 space-y-1.5">
        {series.map((item) => {
          const cell = row.cells.get(item.id);
          const current = cell?.current;

          if (!current) {
            return null;
          }

          const mainValue = pointValue(current, currency);
          const otherValue = pointValue(current, other);
          const previousValue =
            pointValue(cell.previous, currency) ?? pointValue(cell.previous, "ref");
          const previousCurrency =
            pointValue(cell.previous, currency) === null ? "ref" : currency;
          const count =
            typeof current.count === "number" && Number.isFinite(current.count)
              ? current.count
              : null;

          return (
            <li key={item.id}>
              <div className="flex items-center justify-between gap-4">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: item.color }}
                  />
                  <span className="truncate">{item.name}</span>
                </span>
                <span className="shrink-0 font-semibold tabular-nums">
                  {mainValue === null ? "Sin dato" : formatMoney(mainValue, currency)}
                </span>
              </div>
              <div className="tabular-nums" style={{ color: CHART_TOOLTIP_COLORS.mutedText }}>
                {otherValue !== null || count !== null ? (
                  <p>
                    {[
                      otherValue === null ? null : formatMoney(otherValue, other),
                      count === null ? null : `${capitalize(countLabel)}: ${count}`,
                    ]
                      .filter((part) => part !== null)
                      .join(" · ")}
                  </p>
                ) : null}
                {cell.previous && previousValue !== null ? (
                  <p>
                    Periodo anterior ({formatPointLabel(cell.previous)}):{" "}
                    {formatMoney(previousValue, previousCurrency)}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
