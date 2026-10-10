"use client";

import { useMemo } from "react";

import { DataTable, type DataTableColumn } from "@/shared/components/DataTable";
import { formatDateRangeLabel } from "@/shared/components/DateRangeField";
import { EmptyState } from "@/shared/components/EmptyState";
import { HeatmapChart, type HeatmapAxisItem } from "@/shared/components/HeatmapChart";
import { formatRef, formatVesBs } from "@/shared/utils/currency";

import { useSalesByHourReport } from "../../../hooks/useMoneyReports";
import {
  HOUR_COUNT,
  type MoneyReportRange,
  type SalesByHourMeasures,
  type SalesByHourReport,
} from "../../../services/moneyReports";
import type { ReportDefinition } from "../../config/reportCatalog";
import { useReportPanelReady } from "../../reportPanelReady";
import { getReportQueryError } from "../../reportQueryState";
import { useIsNarrowViewport } from "../../hooks/useIsNarrowViewport";
import { ReportChartCard } from "../ReportChartCard";
import { ReportTableSection } from "../ReportTableSection";
import { findPeakIndex, formatHour, formatSalesCount, WEEKDAYS } from "./moneyReportText";
import { ReportQueryError } from "./ReportStates";

const WEEKDAY_AXIS: HeatmapAxisItem[] = WEEKDAYS.map((day, index) => ({
  id: String(index + 1),
  label: day.label,
  name: day.name,
}));

const HOUR_AXIS: HeatmapAxisItem[] = Array.from({ length: HOUR_COUNT }, (_, hour) => ({
  id: String(hour),
  label: String(hour),
  name: formatHour(hour),
}));

/** Traspuesto (móvil) las horas son filas: caben enteras («18:00»). */
const HOUR_ROW_AXIS: HeatmapAxisItem[] = HOUR_AXIS.map((hour) => ({ ...hour, label: hour.name ?? hour.label }));

/** En horizontal (7 días × 24 horas) se rotula una hora de cada tres. */
const HOUR_LABEL_EVERY = 3;

type MeasureRow = SalesByHourMeasures & { id: string; label: string };

/** Cuatro columnas cortas: cada cifra en una línea y alineada por dígitos. */
const MEASURE_CELL_CLASS = "whitespace-nowrap tabular-nums";

const measureColumns = (firstHeader: string): DataTableColumn<MeasureRow>[] => [
  { cellClassName: MEASURE_CELL_CLASS, header: firstHeader, key: "label", render: (row) => row.label },
  {
    align: "right",
    cellClassName: MEASURE_CELL_CLASS,
    header: "Ventas",
    key: "salesCount",
    render: (row) => row.salesCount,
  },
  {
    align: "right",
    cellClassName: MEASURE_CELL_CLASS,
    header: "REF",
    key: "totalRef",
    render: (row) => formatRef(row.totalRef),
  },
  {
    align: "right",
    cellClassName: MEASURE_CELL_CLASS,
    header: "Bs",
    key: "totalVes",
    render: (row) => formatVesBs(row.totalVes),
  },
];

const weekdayColumns = measureColumns("Día");
const hourColumns = measureColumns("Hora");

function describeMeasures(day: number, hour: number, cell: SalesByHourMeasures | undefined) {
  const measures = cell ?? { salesCount: 0, totalRef: 0, totalVes: 0 };

  return `${WEEKDAYS[day]?.name ?? ""}, ${formatHour(hour)}: ${formatSalesCount(measures.salesCount)} · ${formatRef(measures.totalRef)} · ${formatVesBs(measures.totalVes)}`;
}

function SalesByHourTable({
  columns,
  rows,
  title,
}: {
  columns: DataTableColumn<MeasureRow>[];
  rows: MeasureRow[];
  title: string;
}) {
  return (
    <section
      aria-label={title}
      // Las dos tablas van lado a lado (~440 px cada una a 1280): se quita el
      // ancho mínimo de 720 px de la tabla «stitch», que escondía REF y Bs.
      className="overflow-hidden rounded-lg border border-outline-variant bg-surface-container-lowest [&_table]:min-w-0"
    >
      <h4 className="border-b border-outline-variant bg-surface-container-low px-4 py-2 text-sm font-semibold text-on-surface">
        {title}
      </h4>
      <DataTable
        columns={columns}
        data={rows}
        embedded
        getRowId={(row) => row.id}
        layout="table"
        variant="stitch"
      />
    </section>
  );
}

function SalesByHourHeatmap({ report }: { report: SalesByHourReport }) {
  // En móvil se traspone: 24 filas (horas) × 7 columnas (días). Así cada celda
  // mide lo bastante para tocarla y nada desborda a 390 px.
  const isNarrow = useIsNarrowViewport();
  const { matrix } = report;
  const values = useMemo(
    () =>
      isNarrow
        ? HOUR_AXIS.map((_, hour) => WEEKDAY_AXIS.map((__, day) => matrix[day]?.[hour]?.totalRef ?? 0))
        : matrix.map((hours) => hours.map((cell) => cell.totalRef)),
    [isNarrow, matrix],
  );

  return (
    <HeatmapChart
      ariaLabel="Ventas por día de la semana y hora, en REF"
      columnLabelEvery={isNarrow ? 1 : HOUR_LABEL_EVERY}
      columns={isNarrow ? WEEKDAY_AXIS : HOUR_AXIS}
      describeCell={({ column, row }) => {
        const day = isNarrow ? column : row;
        const hour = isNarrow ? row : column;

        return describeMeasures(day, hour, matrix[day]?.[hour]);
      }}
      measureLabel="REF vendido"
      rows={isNarrow ? HOUR_ROW_AXIS : WEEKDAY_AXIS}
      values={values}
    />
  );
}

type SalesByHourReportPanelProps = {
  /** Rango global de la página. Sin `from` y `to` no se consulta. */
  range: Partial<MoneyReportRange>;
  report: Pick<ReportDefinition, "name">;
};

/**
 * Ventas por hora y día de la semana. Mapa de calor 7 × 24 y no dos gráficos de
 * barras: la pregunta es «¿qué días a qué horas vendo más?», y solo la matriz
 * enseña el cruce (el sábado por la tarde no es el martes por la tarde). Las
 * sumas por hora y por día van en la tabla y en la línea de picos.
 */
export function SalesByHourReportPanel({ range, report }: SalesByHourReportPanelProps) {
  const hasRange = Boolean(range.from && range.to);
  const query = useSalesByHourReport(range);

  useReportPanelReady(!query.isLoading);

  const queryError = getReportQueryError(query);
  const { data } = query;
  const hasSales = Boolean(data && data.totals.salesCount > 0);
  const peakHour = data ? findPeakIndex(data.byHour) : null;
  const peakDay = data ? findPeakIndex(data.byWeekday) : null;
  const weekdayRows = useMemo<MeasureRow[]>(
    () =>
      (data?.byWeekday ?? []).map((row) => ({
        ...row,
        id: String(row.dow),
        label: WEEKDAYS[row.dow - 1]?.name ?? String(row.dow),
      })),
    [data],
  );
  const hourRows = useMemo<MeasureRow[]>(
    () => (data?.byHour ?? []).map((row) => ({ ...row, id: String(row.hour), label: formatHour(row.hour) })),
    [data],
  );

  return (
    <div className="min-w-0 space-y-4">
      <ReportChartCard
        subtitle={`${formatDateRangeLabel(range.from, range.to)} · hora de Caracas`}
        title={report.name}
        total={data && hasSales ? { label: "Total vendido", value: formatRef(data.totals.totalRef) } : undefined}
      >
        {!hasRange ? (
          <EmptyState
            description="Este reporte necesita un rango con fecha de inicio y de fin."
            title="Elige un rango de fechas"
          />
        ) : query.isLoading ? (
          <HeatmapChart ariaLabel={report.name} columns={[]} loading rows={[]} values={[]} />
        ) : queryError ? (
          <ReportQueryError
            error={queryError}
            onRetry={() => void query.refetch()}
            reportName={report.name}
          />
        ) : data && hasSales ? (
          <>
            {peakHour !== null && peakDay !== null ? (
              <p className="text-sm font-medium text-on-surface" data-testid="sales-by-hour-peak">
                Hora pico: {formatHour(peakHour)} · Día pico: {WEEKDAYS[peakDay]?.name}
              </p>
            ) : null}
            <SalesByHourHeatmap report={data} />
          </>
        ) : data ? (
          <EmptyState description="Prueba con otro rango de fechas." title="Sin ventas en este periodo" />
        ) : null}
      </ReportChartCard>

      {data && hasSales ? (
        <ReportTableSection summary={`${formatSalesCount(data.totals.salesCount)} · por día y por hora`}>
          <div className="grid min-w-0 gap-4 lg:grid-cols-2">
            <SalesByHourTable columns={weekdayColumns} rows={weekdayRows} title="Por día de la semana" />
            <SalesByHourTable columns={hourColumns} rows={hourRows} title="Por hora" />
          </div>
        </ReportTableSection>
      ) : null}
    </div>
  );
}
