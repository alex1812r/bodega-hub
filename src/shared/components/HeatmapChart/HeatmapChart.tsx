"use client";

import { type KeyboardEvent, useRef, useState } from "react";

import { getChartSeriesColor } from "@/shared/components/charts/chartTheme";
import { EmptyState } from "@/shared/components/EmptyState";
import { ErrorState } from "@/shared/components/ErrorState";
import { Skeleton } from "@/shared/components/Skeleton";
import { cn } from "@/shared/utils/cn";
import { formatRef } from "@/shared/utils/currency";

import {
  cellValue,
  HEAT_LEVEL_OPACITY,
  HEAT_LEVELS,
  heatLevel,
  isLabeledColumn,
  maxHeatValue,
} from "./heatmapData";

export type HeatmapAxisItem = {
  /** Único dentro de su eje. */
  id: string;
  /** Rótulo corto visible («Lun», «18»). */
  label: string;
  /** Nombre completo para el `title` y el lector de pantalla («lunes», «18:00»). Por defecto, `label`. */
  name?: string;
};

export type HeatmapChartProps = {
  /** Qué muestra el mapa («Ventas por hora y día»). Es el título accesible de la tabla. */
  ariaLabel: string;
  /** Filas, de arriba abajo, en su orden natural. */
  rows: readonly HeatmapAxisItem[];
  /** Columnas, de izquierda a derecha, en su orden natural. */
  columns: readonly HeatmapAxisItem[];
  /** `values[fila][columna]`. Un hueco, un negativo o un valor no numérico cuenta como 0. */
  values: readonly (readonly number[])[];
  /** Texto del valor en la leyenda y en el `title` por defecto. Por defecto, dinero en REF. */
  formatValue?: (value: number) => string;
  /**
   * Texto exacto de una celda: su `title`, lo que lee el lector de pantalla y lo
   * que se escribe bajo el mapa al enfocarla o tocarla. Por defecto: «fila, columna: valor».
   */
  describeCell?: (cell: { column: number; row: number; value: number }) => string;
  /** Rotula una de cada N columnas (24 horas en poco ancho no caben todas). Por defecto todas. */
  columnLabelEvery?: number;
  /** Qué mide la intensidad, para la leyenda («REF vendido»). */
  measureLabel?: string;
  loading?: boolean;
  /** Mensaje de error; si viene, sustituye al mapa. */
  error?: string | null;
  /** Con `error`, muestra el botón «Reintentar». */
  onRetry?: () => void;
  emptyTitle?: string;
  emptyDescription?: string;
  className?: string;
};

const SKELETON_HEIGHT = 200;
const LEVELS = Array.from({ length: HEAT_LEVELS }, (_, index) => index + 1);
const CELL_DETAIL_HINT = "Toca una celda o muévete con las flechas para ver su valor.";

type CellPosition = { column: number; row: number };

/** A qué celda lleva una tecla desde `from`; `null` si la tecla no mueve el foco. */
function nextCellPosition(key: string, from: CellPosition, rowCount: number, columnCount: number) {
  switch (key) {
    case "ArrowRight":
      return { column: Math.min(columnCount - 1, from.column + 1), row: from.row };
    case "ArrowLeft":
      return { column: Math.max(0, from.column - 1), row: from.row };
    case "ArrowDown":
      return { column: from.column, row: Math.min(rowCount - 1, from.row + 1) };
    case "ArrowUp":
      return { column: from.column, row: Math.max(0, from.row - 1) };
    case "Home":
      return { column: 0, row: from.row };
    case "End":
      return { column: columnCount - 1, row: from.row };
    default:
      return null;
  }
}

function HeatSwatch({ level }: { level: number }) {
  return (
    <span
      aria-hidden="true"
      className="block size-full rounded-sm"
      data-heat-level={level}
      style={{ backgroundColor: getChartSeriesColor(0), opacity: HEAT_LEVEL_OPACITY[level] }}
    />
  );
}

/**
 * Mapa de calor: una tabla de filas × columnas donde la intensidad de un único
 * tono del tema (`--chart-1`) crece con el valor, en cinco pasos. Sirve para ver
 * de un vistazo dónde se concentra algo (ventas por día de la semana y hora).
 *
 * - Es una `<table>` real: cada celda lleva su valor exacto en `title` y en
 *   texto para lector de pantalla; el color nunca es el único canal.
 * - Cada celda es un botón: al enfocarla o tocarla, su valor exacto se escribe
 *   en una zona fija bajo el mapa (nada depende de pasar el ratón). El mapa es
 *   un solo alto de tabulación; dentro se navega con flechas, Inicio y Fin.
 * - Las columnas se reparten el ancho disponible (`table-fixed`): no provoca
 *   scroll horizontal. Con muchas columnas y poco ancho, quien lo usa puede
 *   trasponer filas y columnas.
 * - Las celdas sin valor quedan con el fondo neutro del tema.
 *
 * Colores: solo tokens del tema, vía `chartTheme`.
 */
export function HeatmapChart({
  ariaLabel,
  className,
  columnLabelEvery = 1,
  columns,
  describeCell,
  emptyDescription = "Prueba con otro rango de fechas.",
  emptyTitle = "Sin datos para el mapa",
  error,
  formatValue = formatRef,
  loading = false,
  measureLabel,
  onRetry,
  rows,
  values,
}: HeatmapChartProps) {
  const tableRef = useRef<HTMLTableElement>(null);
  const [activeCell, setActiveCell] = useState<CellPosition | null>(null);

  if (loading) {
    return (
      <div aria-label={`Cargando ${ariaLabel}`} className={className} role="status">
        <Skeleton className="w-full" style={{ height: SKELETON_HEIGHT }} />
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

  if (rows.length === 0 || columns.length === 0) {
    return <EmptyState className={className} description={emptyDescription} title={emptyTitle} />;
  }

  const max = maxHeatValue(values);
  // Si el mapa cambia de tamaño (otro rango, trasponer), la celda activa deja de valer.
  const active =
    activeCell && activeCell.row < rows.length && activeCell.column < columns.length
      ? activeCell
      : null;
  const tabStop = active ?? { column: 0, row: 0 };

  function cellText(position: CellPosition) {
    const row = rows[position.row];
    const column = columns[position.column];
    const value = cellValue(values, position.row, position.column);

    return describeCell
      ? describeCell({ column: position.column, row: position.row, value })
      : `${row.name ?? row.label}, ${column.name ?? column.label}: ${formatValue(value)}`;
  }

  function handleCellKeyDown(event: KeyboardEvent<HTMLButtonElement>, from: CellPosition) {
    const next = nextCellPosition(event.key, from, rows.length, columns.length);

    if (!next) {
      return;
    }

    event.preventDefault();
    tableRef.current
      ?.querySelector<HTMLButtonElement>(
        `[data-heat-row="${next.row}"][data-heat-column="${next.column}"]`,
      )
      ?.focus();
  }

  return (
    <div className={cn("w-full min-w-0 space-y-3", className)}>
      <table className="w-full table-fixed border-separate border-spacing-0.5" ref={tableRef}>
        <caption className="sr-only">{ariaLabel}</caption>
        <thead>
          <tr>
            <td className="w-9" />
            {columns.map((column, index) => (
              <th
                className="overflow-visible px-0 pb-1 text-center text-[11px] font-normal whitespace-nowrap text-on-surface-variant"
                key={column.id}
                scope="col"
              >
                <span className="sr-only">{column.name ?? column.label}</span>
                {isLabeledColumn(index, columnLabelEvery) ? (
                  <span aria-hidden="true">{column.label}</span>
                ) : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={row.id}>
              <th
                className="pr-1 text-left text-[11px] font-normal whitespace-nowrap text-on-surface-variant"
                scope="row"
              >
                <span className="sr-only">{row.name ?? row.label}</span>
                <span aria-hidden="true">{row.label}</span>
              </th>
              {columns.map((column, columnIndex) => {
                const position = { column: columnIndex, row: rowIndex };
                const level = heatLevel(cellValue(values, rowIndex, columnIndex), max);
                const text = cellText(position);
                const isActive = active?.row === rowIndex && active.column === columnIndex;
                const isTabStop = tabStop.row === rowIndex && tabStop.column === columnIndex;

                return (
                  <td
                    className="h-5 rounded-sm bg-surface-container p-0 sm:h-6"
                    data-heat-cell={level}
                    key={column.id}
                    title={text}
                  >
                    <button
                      className={cn(
                        "block size-full cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        isActive && "ring-2 ring-ring",
                      )}
                      data-heat-column={columnIndex}
                      data-heat-row={rowIndex}
                      onClick={() => setActiveCell(position)}
                      onFocus={() => setActiveCell(position)}
                      onKeyDown={(event) => handleCellKeyDown(event, position)}
                      tabIndex={isTabStop ? 0 : -1}
                      type="button"
                    >
                      <HeatSwatch level={level} />
                      <span className="sr-only">{text}</span>
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <p
        aria-live="polite"
        className={cn(
          "min-h-5 text-sm tabular-nums",
          active ? "font-medium text-on-surface" : "text-on-surface-variant",
        )}
        data-testid="heatmap-cell-detail"
      >
        {active ? cellText(active) : CELL_DETAIL_HINT}
      </p>

      <div
        className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-on-surface-variant"
        data-testid="heatmap-legend"
      >
        <span>Menos</span>
        <span aria-hidden="true" className="flex items-center gap-0.5">
          <span className="block size-4 rounded-sm bg-surface-container" />
          {LEVELS.map((level) => (
            <span className="block size-4 rounded-sm bg-surface-container" key={level}>
              <HeatSwatch level={level} />
            </span>
          ))}
        </span>
        <span>Más</span>
        <span>
          {measureLabel ? `${measureLabel} · ` : ""}
          {max > 0 ? `máximo ${formatValue(max)}` : "sin valores"}
        </span>
      </div>
    </div>
  );
}
