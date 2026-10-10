import { inclusiveIsoDayCount } from "@bodega/core/dashboard";

import { ApiError } from "@/lib/api/apiError";
import { parsePagination, type PaginatedList } from "@/lib/api/pagination";
import { canViewPurchasePayments } from "@/shared/auth/paymentAccess";
import type { Permission, UserRole } from "@/shared/auth/permissions";
import { roundMoney } from "@/shared/utils/currency";

import { parseReportSeriesParams, REPORT_SERIES_MAX_DAYS } from "./reportSeries";

/**
 * Reportes de dinero (REP-06): tipos de respuesta y lógica pura compartida por
 * el servidor (`moneyReports.server.ts`, vistas `report_*` del parche
 * `20261013a`) y el mock (`moneyReports.mock-server.ts`).
 *
 * Todas las fechas son días operativos de Caracas (`yyyy-mm-dd`). Ningún
 * reporte desglosa por vendedor.
 */

export const MONEY_REPORT_SLUGS = [
  "sales-by-hour",
  "sales-by-category",
  "receivables-aging",
  "payables-aging",
  "cash-close-differences",
] as const;

export type MoneyReportSlug = (typeof MONEY_REPORT_SLUGS)[number];

/** Rango de días Caracas, ambos incluidos. */
export type MoneyReportRange = { from: string; to: string };

function badRequest(message: string) {
  return new ApiError(400, "BAD_REQUEST", message);
}

function blankToUndefined(value: string | null) {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : undefined;
}

/** División en porcentaje con dos decimales; `null` si el divisor es 0. */
export function ratioPct(numerator: number, denominator: number) {
  return denominator === 0 ? null : roundMoney((numerator / denominator) * 100);
}

// ---------------------------------------------------------------------------
// Permisos
// ---------------------------------------------------------------------------

/**
 * Permisos de cada reporte además de `reports.view` (que exige la ruta):
 *
 * - `sales-by-hour`, `sales-by-category`: ninguno más.
 * - `receivables-aging`: `payments.manage` o `sales.create`, como las ventas de
 *   `GET /api/payments/open-documents`.
 * - `payables-aging`: `payments.manage` y un rol que vea pagos de compra, como
 *   las compras de esa misma ruta.
 * - `cash-close-differences`: `cash.view`, como el historial de turnos de
 *   `GET /api/cash/registers/[id]/sessions` (mismo contado / teórico).
 *
 * Con los roles por defecto los cinco los ven admin y contador; vendedor y
 * almacén ninguno (no tienen `reports.view`).
 */
export function assertMoneyReportAccess(
  report: MoneyReportSlug,
  auth: { permissions: readonly Permission[]; role: UserRole },
) {
  const has = (permission: Permission) => auth.permissions.includes(permission);
  let allowed = true;

  if (report === "receivables-aging") {
    allowed = has("payments.manage") || has("sales.create");
  } else if (report === "payables-aging") {
    allowed = has("payments.manage") && canViewPurchasePayments(auth.role);
  } else if (report === "cash-close-differences") {
    allowed = has("cash.view");
  }

  if (!has("reports.view") || !allowed) {
    throw new ApiError(403, "FORBIDDEN", "No tienes permiso para realizar esta acción.");
  }
}

// ---------------------------------------------------------------------------
// Rango obligatorio (ventas por hora / por categoría)
// ---------------------------------------------------------------------------

/**
 * `from` y `to` obligatorios y válidos (400 en español si faltan, están mal
 * formados, `from > to` o el rango pasa de 10 años): estos reportes agregan
 * todas las filas del rango.
 */
export function parseMoneyReportRange(searchParams: URLSearchParams): MoneyReportRange {
  const { from, to } = parseReportSeriesParams(searchParams);

  if (from === null || to === null) {
    throw badRequest('Indica las fechas "desde" y "hasta" del reporte.');
  }

  if (inclusiveIsoDayCount(from, to) > REPORT_SERIES_MAX_DAYS) {
    throw badRequest("El rango de fechas es demasiado amplio. Usa un máximo de 10 años.");
  }

  return { from, to };
}

// ---------------------------------------------------------------------------
// 1. Ventas por hora del día y día de la semana
// ---------------------------------------------------------------------------

export const WEEKDAY_COUNT = 7;
export const HOUR_COUNT = 24;

export type SalesByHourMeasures = {
  salesCount: number;
  totalRef: number;
  totalVes: number;
};

/** Una fila de `report_sales_by_hour` (o su equivalente del mock). */
export type SalesByHourInput = SalesByHourMeasures & {
  /** 1 = lunes … 7 = domingo. */
  dow: number;
  /** 0–23, hora de Caracas. */
  hour: number;
};

export type SalesByHourReport = {
  range: MoneyReportRange;
  /** `matrix[dow - 1][hour]`: 7 filas (lunes primero) × 24 horas, con ceros. */
  matrix: SalesByHourMeasures[][];
  /** 24 posiciones, hora 0 primero. */
  byHour: Array<SalesByHourMeasures & { hour: number }>;
  /** 7 posiciones, lunes (`dow` 1) primero. */
  byWeekday: Array<SalesByHourMeasures & { dow: number }>;
  totals: SalesByHourMeasures;
};

function emptyHourMeasures(): SalesByHourMeasures {
  return { salesCount: 0, totalRef: 0, totalVes: 0 };
}

function addHourMeasures(target: SalesByHourMeasures, row: SalesByHourMeasures) {
  target.salesCount += row.salesCount;
  target.totalRef += row.totalRef;
  target.totalVes += row.totalVes;
}

function roundHourMeasures(measures: SalesByHourMeasures): SalesByHourMeasures {
  return {
    salesCount: measures.salesCount,
    totalRef: roundMoney(measures.totalRef),
    totalVes: roundMoney(measures.totalVes),
  };
}

export function buildSalesByHourReport(
  range: MoneyReportRange,
  rows: readonly SalesByHourInput[],
): SalesByHourReport {
  const matrix = Array.from({ length: WEEKDAY_COUNT }, () =>
    Array.from({ length: HOUR_COUNT }, emptyHourMeasures),
  );
  const byHour = Array.from({ length: HOUR_COUNT }, emptyHourMeasures);
  const byWeekday = Array.from({ length: WEEKDAY_COUNT }, emptyHourMeasures);
  const totals = emptyHourMeasures();

  for (const row of rows) {
    const cell = matrix[row.dow - 1]?.[row.hour];

    if (!cell) {
      continue;
    }

    addHourMeasures(cell, row);
    addHourMeasures(byHour[row.hour]!, row);
    addHourMeasures(byWeekday[row.dow - 1]!, row);
    addHourMeasures(totals, row);
  }

  return {
    byHour: byHour.map((measures, hour) => ({ ...roundHourMeasures(measures), hour })),
    byWeekday: byWeekday.map((measures, index) => ({ ...roundHourMeasures(measures), dow: index + 1 })),
    matrix: matrix.map((hours) => hours.map(roundHourMeasures)),
    range,
    totals: roundHourMeasures(totals),
  };
}

/** Día de la semana ISO (1 = lunes … 7 = domingo) de un día `yyyy-mm-dd`. */
export function isoWeekday(isoDay: string) {
  const [year, month, day] = isoDay.split("-").map(Number);
  const weekday = new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay();

  return weekday === 0 ? 7 : weekday;
}

// ---------------------------------------------------------------------------
// 2. Ventas y margen por categoría
// ---------------------------------------------------------------------------

export const UNCATEGORIZED_LABEL = "Sin categoría";

export type SalesByCategoryMeasures = {
  costRef: number;
  grossProfitRef: number;
  revenueRef: number;
  units: number;
};

/** Una fila de `report_sales_by_category` (o su equivalente del mock). */
export type SalesByCategoryInput = SalesByCategoryMeasures & {
  categoryId: string | null;
  categoryName: string;
};

export type SalesByCategoryTotals = SalesByCategoryMeasures & {
  /** Ganancia / ingreso × 100; `null` si el ingreso es 0. */
  marginPct: number | null;
  /** Ganancia / costo × 100; `null` si el costo es 0. */
  markupPct: number | null;
};

export type SalesByCategoryRow = SalesByCategoryTotals & {
  /** `null` = productos sin categoría. */
  categoryId: string | null;
  categoryName: string;
};

export type SalesByCategoryReport = {
  range: MoneyReportRange;
  /** Una fila por categoría con ventas, de mayor a menor ingreso. */
  items: SalesByCategoryRow[];
  /** Suma de todas las categorías: la misma de Ganancia bruta en ese rango. */
  totals: SalesByCategoryTotals;
};

function withCategoryRatios(measures: SalesByCategoryMeasures): SalesByCategoryTotals {
  const rounded = {
    costRef: roundMoney(measures.costRef),
    grossProfitRef: roundMoney(measures.grossProfitRef),
    revenueRef: roundMoney(measures.revenueRef),
    units: measures.units,
  };

  return {
    ...rounded,
    marginPct: ratioPct(rounded.grossProfitRef, rounded.revenueRef),
    markupPct: ratioPct(rounded.grossProfitRef, rounded.costRef),
  };
}

export function buildSalesByCategoryReport(
  range: MoneyReportRange,
  rows: readonly SalesByCategoryInput[],
): SalesByCategoryReport {
  const groups = new Map<string, SalesByCategoryInput>();
  const totals: SalesByCategoryMeasures = { costRef: 0, grossProfitRef: 0, revenueRef: 0, units: 0 };

  for (const row of rows) {
    const key = row.categoryId ?? "";
    const group = groups.get(key) ?? {
      categoryId: row.categoryId,
      categoryName: row.categoryName,
      costRef: 0,
      grossProfitRef: 0,
      revenueRef: 0,
      units: 0,
    };

    for (const target of [group, totals]) {
      target.costRef += row.costRef;
      target.grossProfitRef += row.grossProfitRef;
      target.revenueRef += row.revenueRef;
      target.units += row.units;
    }

    groups.set(key, group);
  }

  const items = [...groups.values()]
    .map(({ categoryId, categoryName, ...measures }) => ({
      categoryId,
      categoryName,
      ...withCategoryRatios(measures),
    }))
    .sort(
      (first, second) =>
        second.revenueRef - first.revenueRef ||
        first.categoryName.localeCompare(second.categoryName, "es") ||
        (first.categoryId ?? "").localeCompare(second.categoryId ?? ""),
    );

  return { items, range, totals: withCategoryRatios(totals) };
}

// ---------------------------------------------------------------------------
// 3 y 4. Cuentas por cobrar / por pagar con antigüedad
// ---------------------------------------------------------------------------

export const AGING_BUCKETS = ["0-7", "8-30", "30+"] as const;

export type AgingBucket = (typeof AGING_BUCKETS)[number];

/** `sale` = cuenta por cobrar; `purchase` = cuenta por pagar. */
export type AgingDocumentType = "purchase" | "sale";

/** Tramo de antigüedad de un documento con `days` días. */
export function resolveAgingBucket(days: number): AgingBucket {
  if (days <= 7) {
    return "0-7";
  }

  return days <= 30 ? "8-30" : "30+";
}

/** Días de calendario entre dos días `yyyy-mm-dd` (`to - from`), nunca negativo. */
export function isoDaysBetween(from: string, to: string) {
  return to <= from ? 0 : inclusiveIsoDayCount(from, to) - 1;
}

export function agingDocumentHref(type: AgingDocumentType, id: string) {
  return type === "sale" ? `/sales/${id}` : `/purchases/${id}`;
}

export type AgingDocumentRow = {
  bucket: AgingBucket;
  contact: { id: string; name: string } | null;
  /** Instante del documento (ISO). */
  createdAt: string;
  /** Día operativo Caracas del documento: de aquí se cuentan los días. */
  date: string;
  /** Días de calendario Caracas desde el documento hasta hoy. */
  days: number;
  document: {
    /** `/sales/<id>` o `/purchases/<id>`. */
    href: string;
    id: string;
    /** `invoice_number` o `purchase_number`, tal cual se guarda. */
    number: string;
    type: AgingDocumentType;
  };
  /** Ventas: `totalRef - pendingRef` (no se guarda lo cobrado en REF). */
  paidRef: number;
  paidVes: number;
  /** Ventas: saldo en Bs a la tasa del documento. Compras: `totalRef - paidRef`. */
  pendingRef: number;
  pendingVes: number;
  refRateVes: number;
  totalRef: number;
  totalVes: number;
};

export type AgingBucketSummary = {
  bucket: AgingBucket;
  documentsCount: number;
  pendingRef: number;
  pendingVes: number;
};

export type AgingSummary = {
  /** Siempre los tres tramos, en orden, con ceros. */
  buckets: AgingBucketSummary[];
  totals: Omit<AgingBucketSummary, "bucket">;
};

export type AgingReport = PaginatedList<AgingDocumentRow> & {
  /**
   * Calculado sobre todo el conjunto (respeta `contactId`, no `bucket`): no
   * depende de la página.
   */
  summary: AgingSummary;
};

export type AgingQuery = {
  bucket?: AgingBucket;
  contactId?: string;
  limit: number;
  skip: number;
};

const CONTACT_ID_MAX_LENGTH = 120;

/** `bucket` (0-7 | 8-30 | 30+), `contactId`, `skip` y `limit`. 400 si `bucket` no existe. */
export function parseAgingQuery(searchParams: URLSearchParams): AgingQuery {
  const bucket = blankToUndefined(searchParams.get("bucket"));
  const contactId = blankToUndefined(searchParams.get("contactId"));

  if (bucket !== undefined && !(AGING_BUCKETS as readonly string[]).includes(bucket)) {
    throw badRequest("El tramo de antigüedad no es válido. Usa 0-7, 8-30 o 30+.");
  }

  if (contactId !== undefined && contactId.length > CONTACT_ID_MAX_LENGTH) {
    throw badRequest("El contacto no es válido.");
  }

  return {
    ...parsePagination(searchParams),
    ...(bucket ? { bucket: bucket as AgingBucket } : {}),
    ...(contactId ? { contactId } : {}),
  };
}

export function buildAgingSummary(
  rows: ReadonlyArray<Omit<AgingBucketSummary, "bucket"> & { bucket: string }>,
): AgingSummary {
  const buckets = AGING_BUCKETS.map((bucket) => {
    const matching = rows.filter((row) => row.bucket === bucket);

    return {
      bucket,
      documentsCount: matching.reduce((sum, row) => sum + row.documentsCount, 0),
      pendingRef: roundMoney(matching.reduce((sum, row) => sum + row.pendingRef, 0)),
      pendingVes: roundMoney(matching.reduce((sum, row) => sum + row.pendingVes, 0)),
    };
  });

  return {
    buckets,
    totals: {
      documentsCount: buckets.reduce((sum, row) => sum + row.documentsCount, 0),
      pendingRef: roundMoney(buckets.reduce((sum, row) => sum + row.pendingRef, 0)),
      pendingVes: roundMoney(buckets.reduce((sum, row) => sum + row.pendingVes, 0)),
    },
  };
}

// ---------------------------------------------------------------------------
// 5. Diferencias de cierre de caja
// ---------------------------------------------------------------------------

/** Efectivo en Bs (`ves`) o en dólares (`ref`): lo único que se cuenta al cerrar. */
export const CASH_CLOSE_CURRENCIES = ["ves", "ref"] as const;

export type CashCloseCurrency = (typeof CASH_CLOSE_CURRENCIES)[number];

export type CashCloseDifferenceRow = {
  cashSessionId: string;
  /** Día operativo Caracas del cierre. */
  closeDate: string;
  closedAt: string;
  /** `manual`, o autocierre (`end_of_day` / `max_24h`: se cuenta el teórico). */
  closedReason: "end_of_day" | "manual" | "max_24h" | null;
  /** Lo contado al cerrar. */
  counted: number;
  currency: CashCloseCurrency;
  /** `counted - expected`: positivo = sobrante, negativo = faltante. */
  difference: number;
  /** Teórico guardado por el cierre. */
  expected: number;
  registerId: string;
  registerName: string | null;
  /**
   * Diferencia acumulada de esa moneda desde el primer cierre del rango hasta
   * este (en orden de cierre), sin importar la página.
   */
  runningDifference: number;
};

export type CashCloseCurrencyTotals = {
  counted: number;
  currency: CashCloseCurrency;
  difference: number;
  expected: number;
  /** Cierres del rango con esa moneda. */
  sessionsCount: number;
};

export type CashCloseDifferencesReport = PaginatedList<CashCloseDifferenceRow> & {
  range: { from: string | null; to: string | null };
  /** Totales del rango completo, una fila por moneda (`ves`, `ref`), con ceros. */
  totals: CashCloseCurrencyTotals[];
};

export type CashCloseDifferencesQuery = {
  currency?: CashCloseCurrency;
  from: string | null;
  limit: number;
  skip: number;
  to: string | null;
};

/** `from` / `to` opcionales (400 si son inválidos), `currency` (ves | ref), `skip` y `limit`. */
export function parseCashCloseDifferencesQuery(searchParams: URLSearchParams): CashCloseDifferencesQuery {
  const { from, to } = parseReportSeriesParams(searchParams);
  const currency = blankToUndefined(searchParams.get("currency"));

  if (currency !== undefined && !(CASH_CLOSE_CURRENCIES as readonly string[]).includes(currency)) {
    throw badRequest("La moneda no es válida. Usa ves o ref.");
  }

  return {
    ...parsePagination(searchParams),
    ...(currency ? { currency: currency as CashCloseCurrency } : {}),
    from,
    to,
  };
}

/** Un cierre × moneda con los acumulados de su tienda y moneda en orden de cierre. */
export type CashCloseLedgerRow = Omit<CashCloseDifferenceRow, "runningDifference"> & {
  runningCounted: number;
  runningDifference: number;
  runningExpected: number;
};

export type CashCloseRunning = { counted: number; difference: number; expected: number };

export type CashCloseCurrencyWindow = {
  /** Acumulados del último cierre ANTERIOR al rango; `null` si no hay. */
  baseline: CashCloseRunning | null;
  /** Acumulados del último cierre DEL rango; `null` si el rango no tiene cierres. */
  last: CashCloseRunning | null;
  sessionsCount: number;
};

export function buildCashCloseDifferencesReport(input: {
  page: readonly CashCloseLedgerRow[];
  query: CashCloseDifferencesQuery;
  total: number;
  windows: Record<CashCloseCurrency, CashCloseCurrencyWindow>;
}): CashCloseDifferencesReport {
  const { page, query, total, windows } = input;

  return {
    items: page.map((row) => ({
      cashSessionId: row.cashSessionId,
      closeDate: row.closeDate,
      closedAt: row.closedAt,
      closedReason: row.closedReason,
      counted: row.counted,
      currency: row.currency,
      difference: row.difference,
      expected: row.expected,
      registerId: row.registerId,
      registerName: row.registerName,
      runningDifference: roundMoney(
        row.runningDifference - (windows[row.currency].baseline?.difference ?? 0),
      ),
    })),
    limit: query.limit,
    range: { from: query.from, to: query.to },
    skip: query.skip,
    total,
    totals: CASH_CLOSE_CURRENCIES.map((currency) => {
      const { baseline, last, sessionsCount } = windows[currency];
      const delta = (key: keyof CashCloseRunning) =>
        last ? roundMoney(last[key] - (baseline?.[key] ?? 0)) : 0;

      return {
        counted: delta("counted"),
        currency,
        difference: delta("difference"),
        expected: delta("expected"),
        sessionsCount,
      };
    }),
  };
}
