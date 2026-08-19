"use client";

import { useMemo, useState } from "react";

import { getPaginatedItems } from "@/lib/api/pagination";
import { getBusinessTodayIsoDate, shiftIsoDate } from "@/modules/dashboard/utils/businessDate";
import { DataTable, type DataTableColumn } from "@/shared/components/DataTable";
import { paymentMethodLabels } from "@/shared/payments/paymentMethods";
import {
  stitchListFilterFieldClassName,
  stitchListFilterLabelClassName,
} from "@/shared/styles/form-controls";
import { cn } from "@/shared/utils/cn";
import { formatRef, formatVes } from "@/shared/utils/currency";

import {
  type PaymentMethodReportRow,
  type PaymentMethodsReportSummary,
  type ReportDateRangeFilters,
  type ReportRequestScope,
  usePaymentMethodsReport,
} from "../../hooks/useReports";

type PeriodPreset = "ayer" | "hoy" | "inicio" | "rango";

const PRESETS: { id: PeriodPreset; label: string }[] = [
  { id: "hoy", label: "Hoy" },
  { id: "ayer", label: "Ayer" },
  { id: "rango", label: "Rango" },
  { id: "inicio", label: "Desde el inicio" },
];

const methodColumns: DataTableColumn<PaymentMethodReportRow>[] = [
  {
    header: "Metodo",
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
  dateFilters: ReportDateRangeFilters;
  scope?: ReportRequestScope;
};

export function PaymentMethodsReportPanel({
  dateFilters,
  scope,
}: PaymentMethodsReportPanelProps) {
  const today = getBusinessTodayIsoDate();
  const hasGlobalRange = Boolean(dateFilters.from || dateFilters.to);
  const [preset, setPreset] = useState<PeriodPreset>(hasGlobalRange ? "rango" : "hoy");
  const [rangeFrom, setRangeFrom] = useState(dateFilters.from ?? today);
  const [rangeTo, setRangeTo] = useState(dateFilters.to ?? today);

  const queryFilters = useMemo(() => {
    if (hasGlobalRange) {
      return { from: dateFilters.from, to: dateFilters.to };
    }

    if (preset === "hoy") {
      return { from: today, to: today };
    }

    if (preset === "ayer") {
      const yesterday = shiftIsoDate(today, -1);
      return { from: yesterday, to: yesterday };
    }

    if (preset === "rango") {
      return { from: rangeFrom || undefined, to: rangeTo || undefined };
    }

    return {};
  }, [dateFilters.from, dateFilters.to, hasGlobalRange, preset, rangeFrom, rangeTo, today]);

  const query = usePaymentMethodsReport(queryFilters, scope);
  const items = getPaginatedItems(query.data);
  const summary = query.data?.summary;

  return (
    <section className="space-y-4 rounded-lg border border-outline-variant bg-surface-container-lowest p-5 shadow-sm">
      <div>
        <h3 className="text-base font-semibold text-foreground">Metodos de pago</h3>
        <p className="mt-1 text-sm text-on-surface-variant">
          Pagos de venta activos agrupados por metodo. Dia operativo Caracas (America/Caracas).
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {PRESETS.map((option) => (
          <button
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm transition-colors",
              !hasGlobalRange && preset === option.id
                ? "bg-primary/10 font-medium text-primary"
                : "text-foreground hover:bg-surface-container-low",
              hasGlobalRange && "opacity-60",
            )}
            disabled={hasGlobalRange}
            key={option.id}
            onClick={() => setPreset(option.id)}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>

      {hasGlobalRange ? (
        <p className="text-xs text-on-surface-variant">
          Usando filtros globales: {dateFilters.from ?? "inicio"} a {dateFilters.to ?? "hoy"}.
        </p>
      ) : null}

      {!hasGlobalRange && preset === "rango" ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label className={stitchListFilterLabelClassName} htmlFor="payment-methods-from">
              Desde
            </label>
            <input
              className={cn(stitchListFilterFieldClassName, "w-full")}
              id="payment-methods-from"
              onChange={(event) => setRangeFrom(event.target.value)}
              type="date"
              value={rangeFrom}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className={stitchListFilterLabelClassName} htmlFor="payment-methods-to">
              Hasta
            </label>
            <input
              className={cn(stitchListFilterFieldClassName, "w-full")}
              id="payment-methods-to"
              onChange={(event) => setRangeTo(event.target.value)}
              type="date"
              value={rangeTo}
            />
          </div>
        </div>
      ) : null}

      {query.isLoading ? (
        <p className="text-sm text-on-surface-variant">Cargando metodos de pago...</p>
      ) : null}

      {query.error ? (
        <p className="text-sm text-error">No se pudo generar el reporte de metodos de pago.</p>
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
    </section>
  );
}
