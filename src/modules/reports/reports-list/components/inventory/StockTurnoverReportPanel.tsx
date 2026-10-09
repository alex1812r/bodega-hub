"use client";

import Link from "next/link";
import { useMemo } from "react";

import type { DataTableColumn } from "@/shared/components/DataTable";
import { formatDateRangeLabel } from "@/shared/components/DateRangeField";
import { EmptyState } from "@/shared/components/EmptyState";
import { RankingBarChart, type RankingBarItem } from "@/shared/components/RankingBarChart";
import { formatRef } from "@/shared/utils/currency";
import { withReturnTo } from "@/shared/utils/returnTo";

import { type StockTurnoverFilters, useStockTurnoverReport } from "../../../hooks/useInventoryReports";
import type { StockTurnoverGroupBy, StockTurnoverRow } from "../../../services/inventoryReports";
import type { MoneyReportRange } from "../../../services/moneyReports";
import type { ReportDefinition } from "../../config/reportCatalog";
import { ReportQueryError } from "../money/ReportStates";
import { ReportChartCard } from "../ReportChartCard";
import { ReportChipGroup, type ReportChipOption } from "../ReportChipGroup";
import {
  formatResultsRange,
  ReportTable,
  type ReportPagination,
  useResetPagePastTheEnd,
} from "../ReportTable";
import { ReportTableSection } from "../ReportTableSection";
import {
  formatDaysCount,
  formatDaysOfInventory,
  formatTurnover,
  formatUnits,
  NO_VALUE,
  STOCK_TURNOVER_NOTE,
} from "./inventoryReportText";
import { ReportStatTiles } from "./ReportStatTiles";

const TURNOVER_BY_OPTIONS: readonly ReportChipOption<StockTurnoverGroupBy>[] = [
  { label: "Producto", value: "product" },
  { label: "Categoría", value: "category" },
];

const GROUP_NOUN: Record<StockTurnoverGroupBy, { plural: string; singular: string }> = {
  category: { plural: "categorías", singular: "categoría" },
  product: { plural: "productos", singular: "producto" },
};

const linkClassName =
  "font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function rowLabel(row: StockTurnoverRow) {
  return row.product ? row.product.name || row.product.sku || NO_VALUE : row.category.name || NO_VALUE;
}

function formatTurnoverTimes(value: number) {
  return `${formatTurnover(value)} ${value === 1 ? "vez" : "veces"}`;
}

const measureColumns: DataTableColumn<StockTurnoverRow>[] = [
  {
    align: "right",
    header: "Unidades vendidas",
    key: "soldUnits",
    render: (row) => formatUnits(row.soldUnits),
  },
  {
    align: "right",
    header: "Costo de lo vendido",
    key: "cogsRef",
    render: (row) => formatRef(row.cogsRef),
  },
  { align: "right", header: "Stock", key: "stock", render: (row) => formatUnits(row.stock) },
  {
    align: "right",
    header: "Valor de stock",
    key: "stockValueRef",
    render: (row) => formatRef(row.stockValueRef),
  },
  {
    align: "right",
    header: "Rotación",
    key: "turnover",
    render: (row) => <span className="font-semibold">{formatTurnover(row.turnover)}</span>,
  },
  {
    align: "right",
    header: "Días de inventario",
    key: "daysOfInventory",
    render: (row) => formatDaysOfInventory(row.daysOfInventory),
  },
];

function buildColumns(
  groupBy: StockTurnoverGroupBy,
  listHref: string | undefined,
): DataTableColumn<StockTurnoverRow>[] {
  if (groupBy === "category") {
    return [
      { header: "Categoría", key: "category", render: (row) => row.category.name || NO_VALUE },
      { align: "right", header: "Productos", key: "productsCount", render: (row) => row.productsCount },
      ...measureColumns,
    ];
  }

  return [
    {
      header: "Producto",
      key: "product",
      render: (row) =>
        row.product ? (
          <Link className={linkClassName} href={withReturnTo(row.product.href, listHref)}>
            {rowLabel(row)}
          </Link>
        ) : (
          NO_VALUE
        ),
    },
    { header: "SKU", key: "sku", render: (row) => row.product?.sku || NO_VALUE },
    { header: "Categoría", key: "category", render: (row) => row.category.name || NO_VALUE },
    ...measureColumns,
  ];
}

type StockTurnoverReportPanelProps = {
  /** URL actual de la lista, para el `returnTo` de los enlaces. */
  listHref?: string;
  onTurnoverByChange: (turnoverBy: StockTurnoverGroupBy) => void;
  /** Página y tamaño (URL): la tabla se pagina en servidor. */
  pagination: ReportPagination;
  /** Rango global de la página. Sin `from` y `to` no se consulta. */
  range: Partial<MoneyReportRange>;
  report: Pick<ReportDefinition, "name">;
  /** Agrupación (`turnoverBy` de la URL): viaja al endpoint como `groupBy`. */
  turnoverBy: StockTurnoverGroupBy;
};

/**
 * Rotación de inventario por producto o por categoría. Los totales son de todo
 * el reporte; las barras, de la página visible (el servidor ordena por rotación,
 * así que la primera página es el top global).
 */
export function StockTurnoverReportPanel({
  listHref,
  onTurnoverByChange,
  pagination,
  range,
  report,
  turnoverBy,
}: StockTurnoverReportPanelProps) {
  const hasRange = Boolean(range.from && range.to);
  const filters: StockTurnoverFilters = {
    from: range.from,
    groupBy: turnoverBy,
    limit: pagination.limit,
    skip: pagination.skip,
    to: range.to,
  };
  const query = useStockTurnoverReport(filters);
  const { data } = query;
  const items = data?.items;
  const total = data?.total ?? 0;
  // Vacío confirmado por el servidor; mientras llega una página la tabla sigue montada.
  const isEmpty = data !== undefined && total === 0;
  const noun = GROUP_NOUN[turnoverBy];
  const columns = useMemo(() => buildColumns(turnoverBy, listHref), [listHref, turnoverBy]);
  // Sin rotación calculable (inventario promedio en 0) no hay barra que dibujar.
  const chartItems = useMemo<RankingBarItem[]>(
    () =>
      (items ?? []).flatMap((row) =>
        row.turnover === null ? [] : [{ id: row.key || "__sin-categoria__", label: rowLabel(row), value: row.turnover }],
      ),
    [items],
  );
  const shown = Math.min(chartItems.length, 10);
  // La primera página ya es el top global (orden por rotación en servidor).
  const isFirstPage = (data?.skip ?? pagination.skip) === 0;
  const topLabel =
    shown === 0
      ? null
      : isFirstPage
        ? total > shown
          ? `Top ${shown} de ${total} ${noun.plural}`
          : null
        : `Top ${shown} de esta página`;

  useResetPagePastTheEnd(query, pagination);

  return (
    <div className="min-w-0 space-y-4">
      <ReportChartCard
        notice={STOCK_TURNOVER_NOTE}
        subtitle={[formatDateRangeLabel(range.from, range.to), `Rotación por ${noun.singular}`, topLabel]
          .filter(Boolean)
          .join(" · ")}
        title={report.name}
        total={
          data && !isEmpty
            ? { label: "Rotación total", value: formatTurnover(data.totals.turnover) }
            : undefined
        }
      >
        <ReportChipGroup
          label="Ver por"
          onChange={onTurnoverByChange}
          options={TURNOVER_BY_OPTIONS}
          value={turnoverBy}
        />

        {!hasRange ? (
          <EmptyState
            description="Este reporte necesita un rango con fecha de inicio y de fin."
            title="Elige un rango de fechas"
          />
        ) : query.error ? (
          <ReportQueryError
            error={query.error}
            onRetry={() => void query.refetch()}
            reportName={report.name}
          />
        ) : isEmpty ? (
          <EmptyState
            description="No hubo ventas ni inventario en este rango. Prueba con otras fechas."
            title="Sin rotación en este periodo"
          />
        ) : (
          <>
            {data ? (
              <ReportStatTiles
                label="Totales de rotación"
                stats={[
                  {
                    hint: `en ${formatDaysCount(data.rangeDays)}`,
                    label: "Rotación",
                    value: formatTurnover(data.totals.turnover),
                  },
                  {
                    label: "Días de inventario",
                    value: formatDaysOfInventory(data.totals.daysOfInventory),
                  },
                  { label: "Costo de lo vendido", value: formatRef(data.totals.cogsRef) },
                  {
                    hint: "apertura y cierre, a costo actual",
                    label: "Inventario promedio",
                    value: formatRef(data.totals.averageStockValueRef),
                  },
                  { hint: "hoy", label: "Valor de stock", value: formatRef(data.totals.stockValueRef) },
                  { label: "Unidades vendidas", value: formatUnits(data.totals.soldUnits) },
                ]}
              />
            ) : null}
            <RankingBarChart
              ariaLabel={`${report.name}: rotación por ${noun.singular}`}
              emptyDescription="Ninguna fila de esta página tiene inventario promedio para calcularla."
              emptyTitle="Sin rotación calculable"
              formatValue={formatTurnoverTimes}
              items={chartItems}
              loading={query.isLoading}
            />
          </>
        )}
      </ReportChartCard>

      {hasRange && !query.error && !isEmpty ? (
        <ReportTableSection
          summary={formatResultsRange(data?.skip ?? pagination.skip, pagination.limit, total)}
        >
          <ReportTable
            columns={columns}
            getRowId={(row) => row.key || "__sin-categoria__"}
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
