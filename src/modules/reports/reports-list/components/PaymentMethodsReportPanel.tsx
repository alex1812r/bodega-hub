"use client";

import { useMemo } from "react";

import { getPaginatedItems } from "@/lib/api/pagination";
import { DataTable, type DataTableColumn } from "@/shared/components/DataTable";
import { formatDateRangeLabel } from "@/shared/components/DateRangeField";
import { EmptyState } from "@/shared/components/EmptyState";
import {
  formatDeltaPct,
  RankingBarChart,
  type RankingBarItem,
} from "@/shared/components/RankingBarChart";
import { paymentMethodLabels } from "@/shared/payments/paymentMethods";
import { formatRef, formatVes } from "@/shared/utils/currency";

import {
  type PaymentMethodReportRow,
  type PaymentMethodsReportSummary,
  type ReportDateRangeFilters,
  type ReportRequestScope,
  usePaymentMethodsReport,
} from "../../hooks/useReports";
import type { PaymentMethodsReportComparison } from "../../services/paymentMethodsReport";
import { getReportQueryError } from "../reportQueryState";
import { ReportQueryError } from "./money/ReportStates";
import { ReportChartCard } from "./ReportChartCard";
import { ReportTableSection } from "./ReportTableSection";

const methodColumns: DataTableColumn<PaymentMethodReportRow>[] = [
  {
    header: "Método",
    key: "method",
    render: (row) => paymentMethodLabels[row.method] ?? row.method,
  },
  {
    align: "right",
    header: "Pagos",
    key: "paymentCount",
    render: (row) => row.paymentCount,
  },
  {
    align: "right",
    header: "REF",
    key: "amountRef",
    render: (row) => formatRef(row.amountRef),
  },
  {
    align: "right",
    header: "VES",
    key: "amountVes",
    render: (row) => formatVes(row.amountVes),
  },
];

function getPreviousAmountRef(
  comparison: PaymentMethodsReportComparison,
  method: PaymentMethodReportRow["method"],
) {
  return comparison.previous?.items.find((row) => row.method === method)?.amountRef ?? null;
}

/** Con comparación: valor del periodo anterior y variación por método («—» si no hay). */
function buildComparisonColumns(
  comparison: PaymentMethodsReportComparison,
): DataTableColumn<PaymentMethodReportRow>[] {
  return [
    {
      align: "right",
      header: "REF anterior",
      key: "previousAmountRef",
      render: (row) => {
        const previous = getPreviousAmountRef(comparison, row.method);

        return previous === null ? "—" : formatRef(previous);
      },
    },
    {
      align: "right",
      header: "Variación",
      key: "deltaPct",
      render: (row) => formatDeltaPct(comparison.deltaPctByMethod[row.method]),
    },
  ];
}

function SummaryStrip({ summary }: { summary: PaymentMethodsReportSummary }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-lg border border-outline-variant bg-surface-container-lowest px-4 py-3">
        <p className="text-xs text-on-surface-variant">Pagos</p>
        <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">
          {summary.paymentCount}
        </p>
      </div>
      <div className="rounded-lg border border-outline-variant bg-surface-container-lowest px-4 py-3">
        <p className="text-xs text-on-surface-variant">Total REF</p>
        <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">
          {formatRef(summary.totalRef)}
        </p>
      </div>
      <div className="rounded-lg border border-outline-variant bg-surface-container-lowest px-4 py-3">
        <p className="text-xs text-on-surface-variant">Total VES</p>
        <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">
          {formatVes(summary.totalVes)}
        </p>
      </div>
    </div>
  );
}

type PaymentMethodsReportPanelProps = {
  /**
   * Rango global de la página (`from` / `to`) y, si se compara, `compare`: el
   * panel no tiene control de fechas propio. Sin rango = todos los pagos.
   */
  dateFilters: ReportDateRangeFilters;
  scope?: ReportRequestScope;
};

/**
 * Métodos de pago: barras horizontales por método, ordenadas por REF cobrado
 * (comparan mejor que una dona y reutilizan el gráfico de ranking), y debajo la
 * tabla plegable. Con `compare`, cada método trae su valor anterior y su variación.
 */
export function PaymentMethodsReportPanel({
  dateFilters,
  scope,
}: PaymentMethodsReportPanelProps) {
  // Con `compare` la respuesta trae `comparison` (totales del periodo anterior).
  const query = usePaymentMethodsReport(dateFilters, scope);
  const items = getPaginatedItems(query.data);
  const summary = query.data?.summary;
  const comparison = dateFilters.compare ? query.data?.comparison : undefined;
  const hasPayments = items.some((row) => row.paymentCount > 0 || row.amountRef !== 0);
  const chartItems = useMemo<RankingBarItem[]>(
    () =>
      items.map((row) => ({
        id: row.method,
        label: paymentMethodLabels[row.method] ?? row.method,
        value: row.amountRef,
        ...(comparison
          ? {
              deltaPct: comparison.deltaPctByMethod[row.method] ?? null,
              previousValue: getPreviousAmountRef(comparison, row.method),
            }
          : {}),
      })),
    [comparison, items],
  );
  const columns = useMemo(
    () => (comparison ? [...methodColumns, ...buildComparisonColumns(comparison)] : methodColumns),
    [comparison],
  );
  // Error de negocio, genérico (5xx, respuesta rota) o sin red (consulta en
  // pausa: no es un reporte vacío).
  const queryError = query.isLoading ? null : getReportQueryError(query);
  const isReady = !query.isLoading && !queryError;

  return (
    <div className="min-w-0 space-y-4">
      <ReportChartCard
        delta={comparison ? { deltaPct: comparison.deltaPct } : undefined}
        subtitle={
          <>
            Pagos de venta activos agrupados por método ·{" "}
            {formatDateRangeLabel(dateFilters.from, dateFilters.to)}
          </>
        }
        title="Métodos de pago"
      >
        {query.isLoading ? (
          // El mismo indicador de carga que los demás gráficos: es la señal que
          // espera la captura de imagen del exporte.
          <RankingBarChart ariaLabel="Métodos de pago" items={[]} loading />
        ) : null}

        {queryError ? (
          <ReportQueryError
            error={queryError}
            onRetry={() => void query.refetch()}
            reportName="Métodos de pago"
          />
        ) : null}

        {summary ? <SummaryStrip summary={summary} /> : null}

        {isReady && hasPayments ? (
          <RankingBarChart ariaLabel="Métodos de pago: REF cobrado" items={chartItems} />
        ) : null}

        {isReady && query.data && !hasPayments ? (
          <EmptyState
            description="No hay pagos de venta en el rango elegido."
            title="Sin pagos"
          />
        ) : null}
      </ReportChartCard>

      {isReady && items.length > 0 ? (
        <ReportTableSection
          summary={`${items.length} ${items.length === 1 ? "método" : "métodos"}`}
        >
          <DataTable
            columns={columns}
            data={items}
            embedded
            getRowId={(row) => row.method}
            variant="stitch"
          />
        </ReportTableSection>
      ) : null}
    </div>
  );
}
