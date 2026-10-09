"use client";

import { getPaginatedItems } from "@/lib/api/pagination";
import { DataTable, type DataTableColumn } from "@/shared/components/DataTable";
import { formatDateRangeLabel } from "@/shared/components/DateRangeField";
import { EmptyState } from "@/shared/components/EmptyState";
import { paymentMethodLabels } from "@/shared/payments/paymentMethods";
import { formatRef, formatVes } from "@/shared/utils/currency";

import {
  type PaymentMethodReportRow,
  type PaymentMethodsReportSummary,
  type ReportDateRangeFilters,
  type ReportRequestScope,
  usePaymentMethodsReport,
} from "../../hooks/useReports";

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

export function PaymentMethodsReportPanel({
  dateFilters,
  scope,
}: PaymentMethodsReportPanelProps) {
  // Con `compare` la respuesta trae `comparison` (totales del periodo anterior).
  const query = usePaymentMethodsReport(dateFilters, scope);
  const items = getPaginatedItems(query.data);
  const summary = query.data?.summary;

  return (
    <section className="space-y-4 rounded-lg border border-outline-variant bg-surface-container-lowest p-5 shadow-sm">
      <div>
        <h3 className="text-base font-semibold text-foreground">Métodos de pago</h3>
        <p className="mt-1 text-sm text-on-surface-variant">
          Pagos de venta activos agrupados por método ·{" "}
          {formatDateRangeLabel(dateFilters.from, dateFilters.to)}
        </p>
      </div>

      {query.isLoading ? (
        <p className="text-sm text-on-surface-variant">Cargando métodos de pago…</p>
      ) : null}

      {query.error ? (
        <p className="text-sm text-error" role="alert">
          No se pudo generar el reporte de métodos de pago.
        </p>
      ) : null}

      {summary ? <SummaryStrip summary={summary} /> : null}

      {!query.isLoading && !query.error && items.length > 0 ? (
        <DataTable
          columns={methodColumns}
          data={items}
          embedded
          getRowId={(row) => row.method}
          variant="stitch"
        />
      ) : null}

      {!query.isLoading && !query.error && query.data && items.length === 0 ? (
        <EmptyState
          description="No hay pagos de venta en el rango elegido."
          title="Sin pagos"
        />
      ) : null}
    </section>
  );
}
