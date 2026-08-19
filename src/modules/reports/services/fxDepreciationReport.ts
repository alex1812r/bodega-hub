import { paginateList, parsePagination, type PaginatedList } from "@/lib/api/pagination";
import { toCaracasDateKey } from "@/shared/utils/caracasBusinessDay";

export type FxDepreciationMethodBreakdown = {
  amountRef: number;
  amountVes: number;
  exposedToFx: boolean;
  lossRef: number;
  method: string;
  paymentCount: number;
  refToday: number;
};

export type FxDepreciationReportSummary = {
  byMethod: FxDepreciationMethodBreakdown[];
  capitalLossRef: number;
  capitalRefAtCollection: number;
  capitalRefToday: number;
  depreciationPctOnVes: number;
  generatedAt: string;
  usdHeldRef: number;
  valuationRateAt: string | null;
  valuationRateVes: number;
  vesExposed: number;
  vesLossRef: number;
  vesRefAtCollection: number;
  vesRefToday: number;
};

export type FxDepreciationReportRow = {
  invoiceNumber: string;
  lossRef: number;
  rateAtSale: number;
  saleDate: string;
  saleId: string;
  storeId?: string | null;
  totalRef: number;
  usdRef: number;
  vesCollected: number;
  vesRefAtCollection: number;
  vesRefToday: number;
};

export type FxDepreciationReportResult = PaginatedList<FxDepreciationReportRow> & {
  summary: FxDepreciationReportSummary;
};

export type FxDepreciationPaymentInput = {
  amountRef: number;
  amountVes: number;
  method: string;
  saleId: string;
  storeId: string;
};

export type FxDepreciationSaleInput = {
  createdAt: string;
  id: string;
  invoiceNumber: string;
  refRateVes: number;
  storeId: string;
  totalRef: number;
};

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

export function isFxExposedPaymentMethod(method: string) {
  return method !== "efectivo_usd";
}

export function computeFxDepreciationReport(input: {
  generatedAt?: string;
  payments: FxDepreciationPaymentInput[];
  sales: FxDepreciationSaleInput[];
  searchParams: URLSearchParams;
  /** Latest rate per store_id used to value VES holdings "today". */
  valuationRatesByStore: Record<string, { createdAt: string | null; rateVes: number }>;
}): FxDepreciationReportResult {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const saleById = new Map(input.sales.map((sale) => [sale.id, sale]));

  const methodMap = new Map<
    string,
    { amountRef: number; amountVes: number; paymentCount: number }
  >();

  type Acc = {
    invoiceNumber: string;
    rateAtSale: number;
    saleDate: string;
    saleId: string;
    storeId: string;
    totalRef: number;
    usdRef: number;
    vesCollected: number;
    vesRefAtCollection: number;
  };

  const saleAcc = new Map<string, Acc>();

  for (const payment of input.payments) {
    const sale = saleById.get(payment.saleId);
    if (!sale) {
      continue;
    }

    const method = payment.method;
    const methodBucket = methodMap.get(method) ?? {
      amountRef: 0,
      amountVes: 0,
      paymentCount: 0,
    };
    methodBucket.paymentCount += 1;
    methodBucket.amountRef += payment.amountRef;
    methodBucket.amountVes += payment.amountVes;
    methodMap.set(method, methodBucket);

    const acc = saleAcc.get(sale.id) ?? {
      invoiceNumber: sale.invoiceNumber,
      rateAtSale: sale.refRateVes,
      saleDate: toCaracasDateKey(sale.createdAt),
      saleId: sale.id,
      storeId: sale.storeId,
      totalRef: sale.totalRef,
      usdRef: 0,
      vesCollected: 0,
      vesRefAtCollection: 0,
    };

    if (isFxExposedPaymentMethod(method)) {
      acc.vesCollected += payment.amountVes;
      acc.vesRefAtCollection += payment.amountRef;
    } else {
      acc.usdRef += payment.amountRef;
    }

    saleAcc.set(sale.id, acc);
  }

  const valuationEntries = Object.entries(input.valuationRatesByStore);
  const primaryValuation = valuationEntries[0]?.[1] ?? {
    createdAt: null,
    rateVes: 0,
  };
  // If multi-store with different rates, summary valuationRate shows the first;
  // per-row/per-store math still uses each store's rate.
  const valuationRateVes =
    valuationEntries.length === 1
      ? primaryValuation.rateVes
      : valuationEntries.length > 1
        ? roundMoney(
            valuationEntries.reduce((sum, [, v]) => sum + v.rateVes, 0) /
              valuationEntries.length,
          )
        : 0;
  const valuationRateAt =
    valuationEntries.length === 1
      ? primaryValuation.createdAt
      : valuationEntries
          .map(([, v]) => v.createdAt)
          .filter(Boolean)
          .sort()
          .at(-1) ?? null;

  const rows: FxDepreciationReportRow[] = [...saleAcc.values()]
    .map((acc) => {
      const storeRate =
        input.valuationRatesByStore[acc.storeId]?.rateVes || valuationRateVes;
      const vesRefToday =
        storeRate > 0 ? roundMoney(acc.vesCollected / storeRate) : 0;
      const vesRefAtCollection = roundMoney(acc.vesRefAtCollection);
      return {
        invoiceNumber: acc.invoiceNumber,
        lossRef: roundMoney(vesRefAtCollection - vesRefToday),
        rateAtSale: acc.rateAtSale,
        saleDate: acc.saleDate,
        saleId: acc.saleId,
        storeId: acc.storeId,
        totalRef: roundMoney(acc.totalRef),
        usdRef: roundMoney(acc.usdRef),
        vesCollected: roundMoney(acc.vesCollected),
        vesRefAtCollection,
        vesRefToday,
      };
    })
    .sort((a, b) => b.saleDate.localeCompare(a.saleDate) || b.invoiceNumber.localeCompare(a.invoiceNumber));

  let vesExposed = 0;
  let vesRefAtCollection = 0;
  let vesRefToday = 0;
  let usdHeldRef = 0;

  for (const row of rows) {
    vesExposed += row.vesCollected;
    vesRefAtCollection += row.vesRefAtCollection;
    vesRefToday += row.vesRefToday;
    usdHeldRef += row.usdRef;
  }

  vesExposed = roundMoney(vesExposed);
  vesRefAtCollection = roundMoney(vesRefAtCollection);
  vesRefToday = roundMoney(vesRefToday);
  usdHeldRef = roundMoney(usdHeldRef);

  const vesLossRef = roundMoney(vesRefAtCollection - vesRefToday);
  const depreciationPctOnVes =
    vesRefAtCollection > 0
      ? roundMoney((vesLossRef / vesRefAtCollection) * 100)
      : 0;
  const capitalRefAtCollection = roundMoney(vesRefAtCollection + usdHeldRef);
  const capitalRefToday = roundMoney(vesRefToday + usdHeldRef);
  const capitalLossRef = roundMoney(capitalRefAtCollection - capitalRefToday);

  const byMethod: FxDepreciationMethodBreakdown[] = [...methodMap.entries()]
    .map(([method, bucket]) => {
      const exposedToFx = isFxExposedPaymentMethod(method);
      const amountRef = roundMoney(bucket.amountRef);
      const amountVes = roundMoney(bucket.amountVes);
      // For method breakdown with multi-store, approximate using primary/avg rate.
      const refToday = exposedToFx
        ? valuationRateVes > 0
          ? roundMoney(amountVes / valuationRateVes)
          : 0
        : amountRef;
      const lossRef = exposedToFx ? roundMoney(amountRef - refToday) : 0;
      return {
        amountRef,
        amountVes,
        exposedToFx,
        lossRef,
        method,
        paymentCount: bucket.paymentCount,
        refToday,
      };
    })
    .sort((a, b) => b.amountRef - a.amountRef);

  const page = paginateList(rows, input.searchParams);
  // Preserve pagination params explicitly
  parsePagination(input.searchParams);

  return {
    ...page,
    summary: {
      byMethod,
      capitalLossRef,
      capitalRefAtCollection,
      capitalRefToday,
      depreciationPctOnVes,
      generatedAt,
      usdHeldRef,
      valuationRateAt,
      valuationRateVes,
      vesExposed,
      vesLossRef,
      vesRefAtCollection,
      vesRefToday,
    },
  };
}
