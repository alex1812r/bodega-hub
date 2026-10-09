"use client";

import Link from "next/link";
import { useMemo } from "react";

import type { DataTableColumn } from "@/shared/components/DataTable";
import { formatDateRangeLabel } from "@/shared/components/DateRangeField";
import { EmptyState } from "@/shared/components/EmptyState";
import { RankingBarChart, type RankingBarItem } from "@/shared/components/RankingBarChart";
import { TimeSeriesChart, type TimeSeriesSeries } from "@/shared/components/TimeSeriesChart";
import { formatCaracasDateTime } from "@/shared/utils/caracasBusinessDay";
import { formatRef } from "@/shared/utils/currency";
import { withReturnTo } from "@/shared/utils/returnTo";

import {
  type StockAdjustmentsFilters,
  useStockAdjustmentsReport,
} from "../../../hooks/useInventoryReports";
import type {
  StockAdjustmentReasonSummary,
  StockAdjustmentRow,
} from "../../../services/inventoryReports";
import type { MoneyReportRange } from "../../../services/moneyReports";
import { toTimeSeriesPoints, type ReportGroupBy } from "../../../services/reportSeries";
import type { ReportDefinition } from "../../config/reportCatalog";
import { getReportQueryError } from "../../reportQueryState";
import { ReportQueryError } from "../money/ReportStates";
import { ReportChartCard } from "../ReportChartCard";
import { getGroupingNotice, GROUP_BY_LABELS } from "../ReportSeriesChart";
import {
  formatResultsRange,
  ReportTable,
  type ReportPagination,
  useResetPagePastTheEnd,
} from "../ReportTable";
import { ReportTableSection } from "../ReportTableSection";
import {
  formatSignedRef,
  formatSignedUnits,
  formatUnits,
  NO_VALUE,
  STOCK_ADJUSTMENTS_NOTE,
} from "./inventoryReportText";
import { ReportStatTiles } from "./ReportStatTiles";

const linkClassName =
  "font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function buildColumns(listHref: string | undefined): DataTableColumn<StockAdjustmentRow>[] {
  return [
    { header: "Fecha", key: "createdAt", render: (row) => formatCaracasDateTime(row.createdAt) },
    {
      header: "Producto",
      key: "product",
      render: (row) => (
        <Link className={linkClassName} href={withReturnTo(row.product.href, listHref)}>
          {row.product.name || row.product.sku || NO_VALUE}
        </Link>
      ),
    },
    {
      align: "right",
      header: "Cantidad",
      key: "quantityDelta",
      render: (row) => (
        <span className="font-semibold tabular-nums" data-direction={row.quantityDelta < 0 ? "salida" : "entrada"}>
          {formatSignedUnits(row.quantityDelta)}
        </span>
      ),
    },
    { header: "Motivo", key: "reason", render: (row) => row.reason },
    { align: "right", header: "Valor", key: "valueRef", render: (row) => formatSignedRef(row.valueRef) },
  ];
}

/** Hacia dónde movió inventario un motivo: el color de la barra nunca lo dice solo. */
function reasonDirection(summary: StockAdjustmentReasonSummary) {
  if (summary.unitsIn > 0 && summary.unitsOut > 0) {
    return "entradas y salidas";
  }

  return summary.unitsOut > 0 ? "salidas" : "entradas";
}

function SectionTitle({ children, hint }: { children: string; hint: string }) {
  return (
    <div>
      <h4 className="text-sm font-semibold text-foreground">{children}</h4>
      <p className="text-xs text-on-surface-variant">{hint}</p>
    </div>
  );
}

type StockAdjustmentsReportPanelProps = {
  /** Agrupación pedida (`groupBy` de la URL); `auto` deja elegir al servidor. */
  groupBy?: ReportGroupBy | "auto";
  /** URL actual de la lista, para el `returnTo` de los enlaces. */
  listHref?: string;
  /** Página y tamaño (URL): la tabla se pagina en servidor. */
  pagination: ReportPagination;
  /** Rango global de la página. Sin `from` y `to` no se consulta. */
  range: Partial<MoneyReportRange>;
  report: Pick<ReportDefinition, "name">;
};

/**
 * Ajustes y mermas: ajustes manuales de inventario por motivo (barras) y por
 * periodo (líneas), con la lista de movimientos paginada en servidor.
 *
 * Por periodo se dibujan DOS series, entradas y salidas, y no el neto: una
 * merma de 100 y una entrada de 100 en la misma semana dan neto 0 y esconden
 * justo lo que el reporte quiere enseñar (cuánto se pierde). El neto va en las
 * cifras de cabecera.
 */
export function StockAdjustmentsReportPanel({
  groupBy,
  listHref,
  pagination,
  range,
  report,
}: StockAdjustmentsReportPanelProps) {
  const hasRange = Boolean(range.from && range.to);
  const filters: StockAdjustmentsFilters = {
    from: range.from,
    groupBy,
    limit: pagination.limit,
    skip: pagination.skip,
    to: range.to,
  };
  const query = useStockAdjustmentsReport(filters);
  const queryError = getReportQueryError(query);
  const { data } = query;
  const byReason = data?.byReason;
  const buckets = data?.series;
  // Vacío confirmado por el servidor; mientras llega una página la tabla sigue montada.
  const isEmpty = data !== undefined && data.totals.movementsCount === 0;
  const columns = useMemo(() => buildColumns(listHref), [listHref]);
  const reasonItems = useMemo<RankingBarItem[]>(
    () =>
      (byReason ?? []).map((summary) => ({
        id: summary.reason,
        label: `${summary.reason} · ${reasonDirection(summary)}`,
        value: summary.valueInRef + summary.valueOutRef,
      })),
    [byReason],
  );
  const series = useMemo<TimeSeriesSeries[]>(
    () => [
      { id: "entradas", name: "Entradas", points: toTimeSeriesPoints(buckets, { valueRef: "valueInRef" }) },
      { id: "salidas", name: "Salidas", points: toTimeSeriesPoints(buckets, { valueRef: "valueOutRef" }) },
    ],
    [buckets],
  );
  const shownReasons = Math.min(reasonItems.length, 10);

  useResetPagePastTheEnd(query, pagination);

  return (
    <div className="min-w-0 space-y-4">
      <ReportChartCard
        notice={[STOCK_ADJUSTMENTS_NOTE, getGroupingNotice(groupBy, data?.groupBy)].filter(Boolean).join(" ")}
        subtitle={
          data
            ? `${formatDateRangeLabel(range.from, range.to)} · por ${GROUP_BY_LABELS[data.groupBy]}`
            : formatDateRangeLabel(range.from, range.to)
        }
        title={report.name}
        total={
          data && !isEmpty
            ? { label: "Neto a costo", value: formatSignedRef(data.totals.netValueRef) }
            : undefined
        }
      >
        {!hasRange ? (
          <EmptyState
            description="Este reporte necesita un rango con fecha de inicio y de fin."
            title="Elige un rango de fechas"
          />
        ) : queryError ? (
          <ReportQueryError
            error={queryError}
            onRetry={() => void query.refetch()}
            reportName={report.name}
          />
        ) : isEmpty ? (
          <EmptyState
            description="No hay ajustes manuales de inventario en este rango."
            title="Sin ajustes en este periodo"
          />
        ) : (
          <>
            {data ? (
              <ReportStatTiles
                label="Totales de ajustes"
                stats={[
                  {
                    hint: `${formatUnits(data.totals.unitsIn)} uds`,
                    label: "Entradas",
                    value: formatRef(data.totals.valueInRef),
                  },
                  {
                    hint: `${formatUnits(data.totals.unitsOut)} uds`,
                    label: "Salidas",
                    value: formatRef(data.totals.valueOutRef),
                  },
                  {
                    hint: `${formatSignedUnits(data.totals.netUnits)} uds`,
                    label: "Neto",
                    value: formatSignedRef(data.totals.netValueRef),
                  },
                ]}
              />
            ) : null}

            <section aria-label="Ajustes por motivo" className="min-w-0 space-y-3">
              <SectionTitle
                hint={[
                  "Valor movido a costo (entradas + salidas), en REF",
                  reasonItems.length > shownReasons
                    ? `Top ${shownReasons} de ${reasonItems.length} motivos`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              >
                Por motivo
              </SectionTitle>
              <RankingBarChart
                ariaLabel={`${report.name}: valor movido por motivo`}
                items={reasonItems}
                loading={query.isLoading}
              />
            </section>

            <section aria-label="Ajustes por periodo" className="min-w-0 space-y-3">
              <SectionTitle hint="Entradas y salidas a costo, en REF">Por periodo</SectionTitle>
              <TimeSeriesChart
                ariaLabel={`${report.name}: entradas y salidas por periodo`}
                loading={query.isLoading}
                series={series}
              />
            </section>
          </>
        )}
      </ReportChartCard>

      {hasRange && !queryError && !isEmpty ? (
        <ReportTableSection
          summary={formatResultsRange(data?.skip ?? pagination.skip, pagination.limit, data?.total ?? 0)}
        >
          <ReportTable
            columns={columns}
            getRowId={(row) => row.movementId}
            limit={pagination.limit}
            onLimitChange={pagination.setLimit}
            onSkipChange={pagination.setSkip}
            query={query}
            report={report}
            skip={pagination.skip}
          />
        </ReportTableSection>
      ) : null}
    </div>
  );
}
