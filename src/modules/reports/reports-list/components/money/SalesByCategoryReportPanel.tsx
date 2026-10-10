"use client";

import { useMemo, type ReactNode } from "react";

import { DataTable, type DataTableColumn } from "@/shared/components/DataTable";
import { formatDateRangeLabel } from "@/shared/components/DateRangeField";
import { EmptyState } from "@/shared/components/EmptyState";
import { formatMarkupPct, MarginBadge } from "@/shared/components/MarginBadge";
import {
  DEFAULT_TOP_N,
  RankingBarChart,
  type RankingBarItem,
} from "@/shared/components/RankingBarChart";
import { cn } from "@/shared/utils/cn";
import { formatRef } from "@/shared/utils/currency";

import { useSalesByCategoryReport } from "../../../hooks/useMoneyReports";
import type { MoneyReportRange, SalesByCategoryTotals } from "../../../services/moneyReports";
import type { ReportDefinition } from "../../config/reportCatalog";
import { useReportPanelReady } from "../../reportPanelReady";
import { getReportQueryError } from "../../reportQueryState";
import { ReportChartCard } from "../ReportChartCard";
import { ReportTableSection } from "../ReportTableSection";
import { ReportQueryError } from "./ReportStates";

/**
 * El ingreso suma las líneas de venta (como la ganancia bruta); «Ventas diarias»
 * suma el total de cada documento. Con descuentos o impuestos no dan lo mismo.
 */
const CATEGORY_NOTE =
  "La categoría es la actual del producto. El ingreso suma las líneas de venta, antes del descuento y los impuestos de cada venta: puede diferir del total de «Ventas diarias».";

const TOTAL_ROW_ID = "__total__";
const UNCATEGORIZED_ROW_ID = "__sin-categoria__";

type CategoryTableRow = SalesByCategoryTotals & { id: string; isTotal: boolean; name: string };

function formatUnits(value: number) {
  return value.toLocaleString("es-VE", { maximumFractionDigits: 2 });
}

/** La fila de totales va en negrita. */
function cell(row: CategoryTableRow, content: ReactNode) {
  return <span className={cn(row.isTotal && "font-semibold")}>{content}</span>;
}

// Regla 10 del plan: «ganancia» = markup sobre costo. Las dos razones van con su
// base en el encabezado para que no se confundan.
const categoryColumns: DataTableColumn<CategoryTableRow>[] = [
  { header: "Categoría", key: "name", render: (row) => cell(row, row.name) },
  { align: "right", header: "Unidades", key: "units", render: (row) => cell(row, formatUnits(row.units)) },
  { align: "right", header: "Ingreso", key: "revenueRef", render: (row) => cell(row, formatRef(row.revenueRef)) },
  { align: "right", header: "Costo", key: "costRef", render: (row) => cell(row, formatRef(row.costRef)) },
  {
    align: "right",
    header: "Ganancia",
    key: "grossProfitRef",
    render: (row) => cell(row, formatRef(row.grossProfitRef)),
  },
  {
    align: "right",
    header: "Ganancia sobre costo",
    key: "markupPct",
    render: (row) => (row.markupPct === null ? "—" : <MarginBadge pct={row.markupPct} />),
  },
  {
    align: "right",
    header: "Margen sobre venta",
    key: "marginPct",
    render: (row) => cell(row, row.marginPct === null ? "—" : formatMarkupPct(row.marginPct)),
  },
];

type SalesByCategoryReportPanelProps = {
  /** Rango global de la página. Sin `from` y `to` no se consulta. */
  range: Partial<MoneyReportRange>;
  report: Pick<ReportDefinition, "name">;
};

/** Ventas y margen por categoría: barras por ingreso en REF y tabla con totales. */
export function SalesByCategoryReportPanel({ range, report }: SalesByCategoryReportPanelProps) {
  const hasRange = Boolean(range.from && range.to);
  const query = useSalesByCategoryReport(range);

  useReportPanelReady(!query.isLoading);

  const queryError = getReportQueryError(query);
  const { data } = query;
  const items = data?.items;
  const hasSales = Boolean(items && items.length > 0);
  const chartItems = useMemo<RankingBarItem[]>(
    () =>
      (items ?? []).map((row) => ({
        id: row.categoryId ?? UNCATEGORIZED_ROW_ID,
        label: row.categoryName,
        value: row.revenueRef,
      })),
    [items],
  );
  const tableRows = useMemo<CategoryTableRow[]>(() => {
    if (!data || data.items.length === 0) {
      return [];
    }

    return [
      ...data.items.map(({ categoryId, categoryName, ...measures }) => ({
        ...measures,
        id: categoryId ?? UNCATEGORIZED_ROW_ID,
        isTotal: false,
        name: categoryName,
      })),
      { ...data.totals, id: TOTAL_ROW_ID, isTotal: true, name: "Total" },
    ];
  }, [data]);
  const shown = Math.min(chartItems.length, DEFAULT_TOP_N);

  return (
    <div className="min-w-0 space-y-4">
      <ReportChartCard
        notice={CATEGORY_NOTE}
        subtitle={[
          formatDateRangeLabel(range.from, range.to),
          "Ingreso en REF",
          chartItems.length > DEFAULT_TOP_N ? `Top ${shown} de ${chartItems.length} categorías` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        title={report.name}
        total={data && hasSales ? { label: "Ingreso total", value: formatRef(data.totals.revenueRef) } : undefined}
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
        ) : (
          <RankingBarChart
            ariaLabel={`${report.name}: ingreso en REF`}
            emptyTitle="Sin ventas en este periodo"
            items={chartItems}
            loading={query.isLoading}
          />
        )}
      </ReportChartCard>

      {hasSales ? (
        <ReportTableSection
          summary={`${chartItems.length} ${chartItems.length === 1 ? "categoría" : "categorías"}`}
        >
          <DataTable
            columns={categoryColumns}
            data={tableRows}
            embedded
            getRowId={(row) => row.id}
            layout="table"
            variant="stitch"
          />
        </ReportTableSection>
      ) : null}
    </div>
  );
}
