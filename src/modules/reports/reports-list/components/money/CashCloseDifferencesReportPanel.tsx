"use client";

import { useMemo } from "react";

import type { DataTableColumn } from "@/shared/components/DataTable";
import { formatDateRangeLabel } from "@/shared/components/DateRangeField";
import { TimeSeriesChart, type TimeSeriesPoint } from "@/shared/components/TimeSeriesChart";
import { formatCaracasDateTime } from "@/shared/utils/caracasBusinessDay";
import { cn } from "@/shared/utils/cn";

import {
  type CashCloseDifferencesFilters,
  useCashCloseDifferencesReport,
} from "../../../hooks/useMoneyReports";
import {
  CASH_CLOSE_CURRENCIES,
  type CashCloseCurrency,
  type CashCloseCurrencyTotals,
  type CashCloseDifferenceRow,
} from "../../../services/moneyReports";
import type { ReportDefinition } from "../../config/reportCatalog";
import { ReportChartCard } from "../ReportChartCard";
import {
  formatResultsRange,
  ReportTable,
  type ReportPagination,
  useResetPagePastTheEnd,
} from "../ReportTable";
import { ReportTableSection } from "../ReportTableSection";
import {
  CASH_CLOSE_CURRENCY_LABELS,
  CASH_CLOSE_REASON_LABELS,
  cashDifferenceKind,
  formatCashAmount,
  formatSignedCashAmount,
} from "./moneyReportText";
import { ReportQueryError } from "./ReportStates";

const DIFFERENCE_TONE = {
  faltante: "text-error",
  "sin diferencia": "text-on-surface-variant",
  sobrante: "text-primary",
} as const;

/** Diferencia con signo, color del tema y la palabra: el color nunca va solo. */
function CashDifference({ currency, value }: { currency: CashCloseCurrency; value: number }) {
  const kind = cashDifferenceKind(value);

  return (
    <span className={cn("font-semibold tabular-nums", DIFFERENCE_TONE[kind])} data-difference={kind}>
      {formatSignedCashAmount(value, currency)}{" "}
      <span className="text-xs font-normal">{kind}</span>
    </span>
  );
}

const columns: DataTableColumn<CashCloseDifferenceRow>[] = [
  { header: "Fecha de cierre", key: "closedAt", render: (row) => formatCaracasDateTime(row.closedAt) },
  { header: "Caja", key: "registerName", render: (row) => row.registerName ?? "—" },
  {
    header: "Motivo de cierre",
    key: "closedReason",
    render: (row) => (row.closedReason ? CASH_CLOSE_REASON_LABELS[row.closedReason] : "—"),
  },
  {
    align: "right",
    header: "Esperado",
    key: "expected",
    render: (row) => formatCashAmount(row.expected, row.currency),
  },
  {
    align: "right",
    header: "Contado",
    key: "counted",
    render: (row) => formatCashAmount(row.counted, row.currency),
  },
  {
    align: "right",
    header: "Diferencia",
    key: "difference",
    render: (row) => <CashDifference currency={row.currency} value={row.difference} />,
  },
  {
    align: "right",
    header: "Acumulado",
    key: "runningDifference",
    render: (row) => formatSignedCashAmount(row.runningDifference, row.currency),
  },
];

function CurrencySelector({
  onChange,
  value,
}: {
  onChange: (currency: CashCloseCurrency) => void;
  value: CashCloseCurrency;
}) {
  return (
    <div aria-label="Moneda" className="flex flex-wrap items-center gap-2" role="group">
      <span aria-hidden className="text-sm font-medium text-on-surface">
        Moneda
      </span>
      {CASH_CLOSE_CURRENCIES.map((currency) => {
        const isActive = currency === value;

        return (
          <button
            aria-pressed={isActive}
            className={cn(
              "inline-flex h-9 min-w-11 cursor-pointer items-center justify-center rounded-full border px-3 text-xs font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
              isActive
                ? "border-primary bg-primary/10 text-on-surface"
                : "border-outline bg-surface-container-lowest text-on-surface hover:bg-surface-container-low",
            )}
            key={currency}
            onClick={() => onChange(currency)}
            type="button"
          >
            {CASH_CLOSE_CURRENCY_LABELS[currency]}
          </button>
        );
      })}
    </div>
  );
}

function TotalsStrip({ totals }: { totals: readonly CashCloseCurrencyTotals[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2" data-testid="cash-close-totals">
      {totals.map((row) => (
        <div
          className="min-w-0 rounded-lg border border-outline-variant bg-surface-container-lowest px-4 py-3"
          key={row.currency}
        >
          <p className="text-xs text-on-surface-variant">
            Total en {CASH_CLOSE_CURRENCY_LABELS[row.currency]} · {row.sessionsCount}{" "}
            {row.sessionsCount === 1 ? "cierre" : "cierres"}
          </p>
          <p className="mt-1 text-lg">
            <CashDifference currency={row.currency} value={row.difference} />
          </p>
          <p className="text-xs tabular-nums text-on-surface-variant">
            Esperado {formatCashAmount(row.expected, row.currency)} · Contado{" "}
            {formatCashAmount(row.counted, row.currency)}
          </p>
        </div>
      ))}
    </div>
  );
}

/**
 * Un punto por cierre, en orden de cierre. Cada cierre existe en una sola
 * moneda: en Bs el valor va en `valueVes` (sin valor en REF), en REF solo en
 * `valueRef`; así el gráfico nunca pinta una moneda con las cifras de la otra.
 */
function toRunningPoints(rows: readonly CashCloseDifferenceRow[]) {
  return [...rows]
    .sort((first, second) => first.closedAt.localeCompare(second.closedAt))
    .map<TimeSeriesPoint>((row) => {
      const when = formatCaracasDateTime(row.closedAt);

      return {
        key: row.cashSessionId,
        label: when.slice(0, 5),
        title: row.registerName ? `${when} · ${row.registerName}` : when,
        ...(row.currency === "ves"
          ? { valueRef: null, valueVes: row.runningDifference }
          : { valueRef: row.runningDifference }),
      };
    });
}

type CashCloseDifferencesReportPanelProps = {
  /** Moneda elegida (`currency` de la URL). */
  currency: CashCloseCurrency;
  onCurrencyChange: (currency: CashCloseCurrency) => void;
  /** Página y tamaño (URL): la tabla se pagina en servidor. */
  pagination: ReportPagination;
  /** Rango global de la página; opcional: sin él, todos los cierres. */
  range: { from?: string; to?: string };
  report: Pick<ReportDefinition, "name">;
};

/**
 * Diferencias de cierre de caja (contado − esperado) por cierre, en una sola
 * moneda a la vez. Solo lectura: no hay ninguna acción sobre la caja ni el baúl.
 */
export function CashCloseDifferencesReportPanel({
  currency,
  onCurrencyChange,
  pagination,
  range,
  report,
}: CashCloseDifferencesReportPanelProps) {
  const filters: CashCloseDifferencesFilters = {
    currency,
    from: range.from,
    limit: pagination.limit,
    skip: pagination.skip,
    to: range.to,
  };
  const query = useCashCloseDifferencesReport(filters);
  const { data } = query;
  const items = data?.items;
  const series = useMemo(
    () => [
      {
        id: "running-difference",
        name: `Diferencia acumulada en ${CASH_CLOSE_CURRENCY_LABELS[currency]}`,
        points: toRunningPoints(items ?? []),
      },
    ],
    [currency, items],
  );

  useResetPagePastTheEnd(query, pagination);

  return (
    <div className="min-w-0 space-y-4">
      <ReportChartCard
        notice="Diferencia = contado − esperado. Positiva es sobrante; negativa, faltante."
        subtitle={`${formatDateRangeLabel(range.from, range.to)} · acumulado de los cierres de esta página`}
        title={report.name}
      >
        <CurrencySelector onChange={onCurrencyChange} value={currency} />

        {query.error ? (
          <ReportQueryError
            error={query.error}
            onRetry={() => void query.refetch()}
            reportName={report.name}
          />
        ) : (
          <>
            {data ? <TotalsStrip totals={data.totals} /> : null}
            <TimeSeriesChart
              ariaLabel={`${report.name}: acumulado en ${CASH_CLOSE_CURRENCY_LABELS[currency]}`}
              countLabel="cierres"
              currency={currency}
              emptyDescription="No hay cierres de caja en este rango."
              emptyTitle="Sin cierres"
              // La moneda se elige arriba (un solo control, el de la URL).
              hideCurrencyToggle
              loading={query.isLoading}
              peakCount={0}
              series={series}
              // La serie ya es un acumulado: se resume con su último valor, no con la suma.
              summary="last"
            />
          </>
        )}
      </ReportChartCard>

      {!query.error ? (
        <ReportTableSection
          summary={formatResultsRange(data?.skip ?? pagination.skip, pagination.limit, data?.total ?? 0)}
        >
          <ReportTable
            columns={columns}
            getRowId={(row) => `${row.cashSessionId}-${row.currency}`}
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
