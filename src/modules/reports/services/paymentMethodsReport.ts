import { paginateList, type PaginatedList } from "@/lib/api/pagination";
import type { PaymentMethod } from "@/shared/mocks/erp-data";
import { PAYMENT_METHODS } from "@/shared/payments/paymentMethods";

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

export type PaymentMethodsReportResult = PaginatedList<PaymentMethodReportRow> & {
  summary: PaymentMethodsReportSummary;
};

export type PaymentMethodsReportPaymentInput = {
  amountRef: number;
  amountVes: number;
  method: string;
  saleId?: string | null;
  status?: string | null;
};

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function isCatalogPaymentMethod(method: string): method is PaymentMethod {
  return (PAYMENT_METHODS as readonly string[]).includes(method);
}

export function computePaymentMethodsReport(input: {
  payments: PaymentMethodsReportPaymentInput[];
  searchParams?: URLSearchParams;
}): PaymentMethodsReportResult {
  const searchParams = input.searchParams ?? new URLSearchParams();
  const buckets = new Map<PaymentMethod, PaymentMethodReportRow>(
    PAYMENT_METHODS.map((method) => [
      method,
      { amountRef: 0, amountVes: 0, method, paymentCount: 0 },
    ]),
  );

  for (const payment of input.payments) {
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

  return {
    ...paginateList(items, searchParams),
    summary,
  };
}
