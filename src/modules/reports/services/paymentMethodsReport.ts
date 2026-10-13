import { paginateList, type PaginatedList } from "@/lib/api/pagination";
import type { PaymentMethod } from "@/shared/mocks/erp-data";
import { PAYMENT_METHODS } from "@/shared/payments/paymentMethods";
import { isUtcTimestampInCaracasDateRange } from "@/shared/utils/caracasBusinessDay";

import {
  computeDeltaPct,
  parseReportSeriesParams,
  resolvePreviousRange,
  type ReportSeriesRange,
} from "./reportSeries";

export type PaymentMethodReportRow = {
  amountRef: number;
  amountVes: number;
  method: PaymentMethod;
  paymentCount: number;
};

export type PaymentMethodsReportSummary = {
  paymentCount: number;
  totalRef: number;
  totalVes: number;
};

/** Comparación con el periodo anterior (`compare=1`). */
export type PaymentMethodsReportComparison = {
  /** Mismo nº de días inmediatamente antes de `from`; `null` si falta `from` o `to`. */
  previousRange: ReportSeriesRange | null;
  /** Totales del periodo anterior: los 5 métodos, en el orden del catálogo, sin paginar. */
  previous: {
    items: PaymentMethodReportRow[];
    summary: PaymentMethodsReportSummary;
  } | null;
  /** Variación % de `summary.totalRef`; `null` sin periodo anterior o si su total es 0. */
  deltaPct: number | null;
  /** Variación % de `amountRef` por método; `null` con la misma regla. */
  deltaPctByMethod: Record<PaymentMethod, number | null>;
};

export type PaymentMethodsReportResult = PaginatedList<PaymentMethodReportRow> & {
  /** Solo con `compare=1`. */
  comparison?: PaymentMethodsReportComparison;
  summary: PaymentMethodsReportSummary;
};

export type PaymentMethodsReportPaymentInput = {
  amountRef: number;
  amountVes: number;
  method: string;
  saleId?: string | null;
  status?: string | null;
};

export type PaymentMethodsReportRequest = {
  compare: boolean;
  from: string | null;
  to: string | null;
  /** Periodo anterior a leer; `null` sin `compare` o sin `from`/`to`. */
  previousRange: ReportSeriesRange | null;
};

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function isCatalogPaymentMethod(method: string): method is PaymentMethod {
  return (PAYMENT_METHODS as readonly string[]).includes(method);
}

/** Valida `from`/`to` (400 en español) y resuelve el periodo anterior si llega `compare`. */
export function resolvePaymentMethodsReportRequest(
  searchParams: URLSearchParams,
): PaymentMethodsReportRequest {
  const { compare, from, to } = parseReportSeriesParams(searchParams);

  return {
    compare,
    from,
    previousRange:
      compare && from !== null && to !== null ? resolvePreviousRange({ from, to }) : null,
    to,
  };
}

/**
 * Reparte los pagos leídos de una vez (rango actual + anterior) en cada periodo
 * por su día operativo de Caracas.
 */
export function splitPaymentsByPeriod<T extends { createdAt: string }>(
  payments: readonly T[],
  request: PaymentMethodsReportRequest,
) {
  const previousRange = request.previousRange;

  return {
    current: payments.filter((payment) =>
      isUtcTimestampInCaracasDateRange(payment.createdAt, request.from, request.to),
    ),
    previous: previousRange
      ? payments.filter((payment) =>
          isUtcTimestampInCaracasDateRange(payment.createdAt, previousRange.from, previousRange.to),
        )
      : [],
  };
}

function summarizePayments(payments: readonly PaymentMethodsReportPaymentInput[]) {
  const buckets = new Map<PaymentMethod, PaymentMethodReportRow>(
    PAYMENT_METHODS.map((method) => [
      method,
      { amountRef: 0, amountVes: 0, method, paymentCount: 0 },
    ]),
  );

  for (const payment of payments) {
    const status = payment.status ?? "activo";
    if (status !== "activo" || !payment.saleId) {
      continue;
    }

    if (!isCatalogPaymentMethod(payment.method)) {
      continue;
    }

    const bucket = buckets.get(payment.method)!;
    bucket.paymentCount += 1;
    bucket.amountRef += payment.amountRef;
    bucket.amountVes += payment.amountVes;
  }

  const items: PaymentMethodReportRow[] = PAYMENT_METHODS.map((method) => {
    const bucket = buckets.get(method)!;
    return {
      amountRef: roundMoney(bucket.amountRef),
      amountVes: roundMoney(bucket.amountVes),
      method,
      paymentCount: bucket.paymentCount,
    };
  });

  const summary = items.reduce<PaymentMethodsReportSummary>(
    (acc, row) => ({
      paymentCount: acc.paymentCount + row.paymentCount,
      totalRef: roundMoney(acc.totalRef + row.amountRef),
      totalVes: roundMoney(acc.totalVes + row.amountVes),
    }),
    { paymentCount: 0, totalRef: 0, totalVes: 0 },
  );

  return { items, summary };
}

export function computePaymentMethodsReport(input: {
  /** Con `compare=1`: pagos del periodo anterior y su rango (`null` si no hay rango). */
  comparison?: {
    payments: PaymentMethodsReportPaymentInput[];
    previousRange: ReportSeriesRange | null;
  };
  payments: PaymentMethodsReportPaymentInput[];
  searchParams?: URLSearchParams;
}): PaymentMethodsReportResult {
  const searchParams = input.searchParams ?? new URLSearchParams();
  const { items, summary } = summarizePayments(input.payments);
  const result: PaymentMethodsReportResult = {
    ...paginateList(items, searchParams),
    summary,
  };

  if (!input.comparison) {
    return result;
  }

  const previous = input.comparison.previousRange
    ? summarizePayments(input.comparison.payments)
    : null;

  return {
    ...result,
    comparison: {
      deltaPct: computeDeltaPct(summary.totalRef, previous?.summary.totalRef),
      deltaPctByMethod: Object.fromEntries(
        items.map((row, index) => [
          row.method,
          computeDeltaPct(row.amountRef, previous?.items[index]?.amountRef),
        ]),
      ) as Record<PaymentMethod, number | null>,
      previous,
      previousRange: input.comparison.previousRange,
    },
  };
}
