import { inclusiveIsoDayCount } from "@bodega/core/dashboard";
import { shiftIsoDate } from "@bodega/core/dates";

import { ApiError } from "@/lib/api/apiError";
import type { TimeSeriesPoint } from "@/shared/components/TimeSeriesChart";
import { roundMoney } from "@/shared/utils/currency";

/**
 * Serie agrupada de un reporte (REP-05): lógica pura, la misma para el
 * servidor (Supabase) y el mock.
 *
 * Todas las fechas son claves `yyyy-mm-dd` de día operativo de Caracas ya
 * calculadas por quien llama; aquí solo hay aritmética de calendario.
 */

export const REPORT_GROUP_BY_VALUES = ["day", "week", "month"] as const;

export type ReportGroupBy = (typeof REPORT_GROUP_BY_VALUES)[number];

/** Valor de `groupBy` que pide la agrupación automática (igual que no mandarlo). */
export const REPORT_GROUP_BY_AUTO = "auto";

/** Hasta este nº de días la agrupación automática es por día. */
export const REPORT_AUTO_DAY_MAX_DAYS = 62;
/** Hasta este nº de días la agrupación automática es por semana; más, por mes. */
export const REPORT_AUTO_WEEK_MAX_DAYS = 370;
/** Rango máximo de una serie: 10 años. Más allá la ruta responde 400. */
export const REPORT_SERIES_MAX_DAYS = 3660;

export type ReportSeriesRange = { from: string; to: string };

/** Medidas sumables de un reporte (`totalRef`, `count`…). */
export type ReportSeriesMeasures = Record<string, number>;

export type ReportSeriesBucket<M extends ReportSeriesMeasures> = M & {
  /** Primer día del periodo (`yyyy-mm-dd`), ya recortado al rango pedido. */
  key: string;
  /** `08/10` (un día), `06/10–12/10` (varios) u `oct 2026` (mes completo). */
  label: string;
  /** Primer y último día del periodo, ambos incluidos. */
  from: string;
  to: string;
};

export type ReportSeries<M extends ReportSeriesMeasures> = {
  /** Agrupación efectiva (la pedida, o la automática según el nº de días). */
  groupBy: ReportGroupBy;
  range: ReportSeriesRange;
  /** Mismo nº de días inmediatamente antes de `range.from`; `null` sin `compare`. */
  previousRange: ReportSeriesRange | null;
  /** Un periodo por posición, sin huecos: los periodos sin datos van en 0. */
  current: ReportSeriesBucket<M>[];
  /**
   * Periodo anterior alineado por posición: `previous[i]` es la ventana de
   * `current[i]` desplazada hacia atrás el nº de días del rango. `null` sin
   * `compare`.
   */
  previous: ReportSeriesBucket<M>[] | null;
  totals: {
    current: M;
    previous: M | null;
    /**
     * Variación % de la medida principal del reporte. `null` si no hay periodo
     * anterior o su total es 0 (la UI muestra "—").
     */
    deltaPct: number | null;
  };
};

/** Una fila de datos ya ubicada en su día operativo. Puede haber varias por día. */
export type ReportSeriesDayRow<M extends ReportSeriesMeasures> = {
  day: string;
  values: M;
};

export type ReportSeriesRequest = {
  groupBy: ReportGroupBy;
  range: ReportSeriesRange;
  previousRange: ReportSeriesRange | null;
};

export type ReportSeriesParams = {
  compare: boolean;
  /** `from` validado; `null` si no llegó (o llegó `fromStart`). */
  from: string | null;
  to: string | null;
  /** `null` = automática. */
  groupBy: ReportGroupBy | null;
  /** Llegó `groupBy` o `compare`: el cliente pide la serie / la comparación. */
  requested: boolean;
};

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

const MONTH_LABELS = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
] as const;

function blankToNull(value: string | null) {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function isTruthyParam(value: string | null) {
  const normalized = value?.trim().toLowerCase() ?? "";
  return normalized !== "" && normalized !== "0" && normalized !== "false";
}

function badRequest(message: string) {
  return new ApiError(400, "BAD_REQUEST", message);
}

/** `yyyy-mm-dd` que además es una fecha real del calendario. */
export function isIsoDay(value: string) {
  const match = ISO_DAY.exec(value);

  if (!match) {
    return false;
  }

  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function parseDayParam(searchParams: URLSearchParams, name: "from" | "to") {
  const value = blankToNull(searchParams.get(name));

  if (value !== null && !isIsoDay(value)) {
    throw badRequest(
      `La fecha "${name === "from" ? "desde" : "hasta"}" no es válida. Usa el formato AAAA-MM-DD.`,
    );
  }

  return value;
}

/**
 * Lee y valida `from`, `to`, `groupBy` y `compare`. Lanza `ApiError` 400 con
 * mensaje en español si una fecha está mal formada, `from > to` o `groupBy` no
 * se reconoce. Con `fromStart` el `from` se ignora ("desde el inicio").
 */
export function parseReportSeriesParams(searchParams: URLSearchParams): ReportSeriesParams {
  const fromStart = isTruthyParam(searchParams.get("fromStart"));
  const from = fromStart ? null : parseDayParam(searchParams, "from");
  const to = parseDayParam(searchParams, "to");

  if (from !== null && to !== null && from > to) {
    throw badRequest('La fecha "desde" no puede ser posterior a la fecha "hasta".');
  }

  const rawGroupBy = blankToNull(searchParams.get("groupBy"));
  let groupBy: ReportGroupBy | null = null;

  if (rawGroupBy !== null && rawGroupBy !== REPORT_GROUP_BY_AUTO) {
    if (!(REPORT_GROUP_BY_VALUES as readonly string[]).includes(rawGroupBy)) {
      throw badRequest("La agrupación no es válida. Usa day, week, month o auto.");
    }

    groupBy = rawGroupBy as ReportGroupBy;
  }

  const compare = isTruthyParam(searchParams.get("compare"));

  return { compare, from, groupBy, requested: rawGroupBy !== null || compare, to };
}

/** ≤ 62 días → día; ≤ 370 → semana; más → mes. */
export function resolveAutoGroupBy(dayCount: number): ReportGroupBy {
  if (dayCount <= REPORT_AUTO_DAY_MAX_DAYS) {
    return "day";
  }

  return dayCount <= REPORT_AUTO_WEEK_MAX_DAYS ? "week" : "month";
}

/** Mismo nº de días inmediatamente antes de `range.from`. */
export function resolvePreviousRange(range: ReportSeriesRange): ReportSeriesRange {
  const length = inclusiveIsoDayCount(range.from, range.to);

  return { from: shiftIsoDate(range.from, -length), to: shiftIsoDate(range.from, -1) };
}

/**
 * Qué serie hay que calcular, o `null` si no se pidió (`groupBy`/`compare`
 * ausentes) o falta `from` o `to`: en ese caso el reporte responde como antes.
 */
export function resolveReportSeriesRequest(params: ReportSeriesParams): ReportSeriesRequest | null {
  if (!params.requested || params.from === null || params.to === null) {
    return null;
  }

  const range = { from: params.from, to: params.to };
  const dayCount = inclusiveIsoDayCount(range.from, range.to);

  if (dayCount > REPORT_SERIES_MAX_DAYS) {
    throw badRequest("El rango de fechas no puede superar 10 años.");
  }

  return {
    groupBy: params.groupBy ?? resolveAutoGroupBy(dayCount),
    previousRange: params.compare ? resolvePreviousRange(range) : null,
    range,
  };
}

/** Rango que hay que leer de la base: el actual más, si se compara, el anterior. */
export function seriesFetchRange(request: ReportSeriesRequest): ReportSeriesRange {
  return { from: request.previousRange?.from ?? request.range.from, to: request.range.to };
}

function mondayOf(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, date)).getUTCDay();

  return shiftIsoDate(day, -((weekday + 6) % 7));
}

function firstDayOfMonth(day: string) {
  return `${day.slice(0, 8)}01`;
}

function lastDayOfMonth(day: string) {
  const [year, month] = day.split("-").map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();

  return `${day.slice(0, 8)}${String(last).padStart(2, "0")}`;
}

function minDay(first: string, second: string) {
  return first < second ? first : second;
}

/**
 * Ventanas consecutivas que cubren `range` sin huecos. Semana = lunes a domingo;
 * la semana o el mes parciales de los extremos se recortan al rango.
 */
export function buildBucketWindows(
  range: ReportSeriesRange,
  groupBy: ReportGroupBy,
): ReportSeriesRange[] {
  const windows: ReportSeriesRange[] = [];
  let start = range.from;

  while (start <= range.to) {
    const naturalEnd =
      groupBy === "day"
        ? start
        : groupBy === "week"
          ? shiftIsoDate(mondayOf(start), 6)
          : lastDayOfMonth(start);
    const end = minDay(naturalEnd, range.to);

    windows.push({ from: start, to: end });
    start = shiftIsoDate(end, 1);
  }

  return windows;
}

function shortDay(day: string) {
  return `${day.slice(8, 10)}/${day.slice(5, 7)}`;
}

function longDay(day: string) {
  return `${shortDay(day)}/${day.slice(0, 4)}`;
}

/** `08/10` (un día), `oct 2026` (mes de calendario completo) o `06/10–12/10`. */
export function formatBucketLabel(window: ReportSeriesRange) {
  if (window.from === window.to) {
    return shortDay(window.from);
  }

  if (window.from === firstDayOfMonth(window.from) && window.to === lastDayOfMonth(window.from)) {
    return `${MONTH_LABELS[Number(window.from.slice(5, 7)) - 1]} ${window.from.slice(0, 4)}`;
  }

  return `${shortDay(window.from)}–${shortDay(window.to)}`;
}

/**
 * Variación % de `current` respecto de `previous`, con 2 decimales. `null` si
 * no hay anterior, es 0 o algún valor no es un número finito: nunca NaN ni
 * Infinity. Se divide entre |anterior| para que el signo siga a la dirección
 * del cambio aunque el anterior sea negativo (una ganancia bruta en pérdida).
 */
export function computeDeltaPct(current: number, previous: number | null | undefined) {
  if (previous == null || previous === 0 || !Number.isFinite(previous) || !Number.isFinite(current)) {
    return null;
  }

  const delta = ((current - previous) / Math.abs(previous)) * 100;

  return Number.isFinite(delta) ? roundMoney(delta) : null;
}

function finiteOrZero(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function emptyMeasures<M extends ReportSeriesMeasures>(measures: readonly (keyof M & string)[]) {
  return Object.fromEntries(measures.map((measure) => [measure, 0])) as M;
}

function sumByDay<M extends ReportSeriesMeasures>(
  rows: readonly ReportSeriesDayRow<M>[],
  measures: readonly (keyof M & string)[],
) {
  const byDay = new Map<string, Record<string, number>>();

  for (const row of rows) {
    const totals = byDay.get(row.day) ?? emptyMeasures<ReportSeriesMeasures>(measures);

    for (const measure of measures) {
      totals[measure] = (totals[measure] ?? 0) + finiteOrZero(row.values[measure]);
    }

    byDay.set(row.day, totals);
  }

  return byDay;
}

function buildBuckets<M extends ReportSeriesMeasures>(
  windows: readonly ReportSeriesRange[],
  byDay: Map<string, Record<string, number>>,
  measures: readonly (keyof M & string)[],
): ReportSeriesBucket<M>[] {
  return windows.map((window) => {
    const totals = emptyMeasures<ReportSeriesMeasures>(measures);

    for (let day = window.from; day <= window.to; day = shiftIsoDate(day, 1)) {
      const dayTotals = byDay.get(day);

      if (dayTotals) {
        for (const measure of measures) {
          totals[measure] += dayTotals[measure] ?? 0;
        }
      }
    }

    for (const measure of measures) {
      totals[measure] = roundMoney(totals[measure]);
    }

    return {
      ...(totals as M),
      from: window.from,
      key: window.from,
      label: formatBucketLabel(window),
      to: window.to,
    };
  });
}

/** Suma de los periodos ya redondeados: el total cuadra con lo que se dibuja. */
function sumBuckets<M extends ReportSeriesMeasures>(
  buckets: readonly ReportSeriesBucket<M>[],
  measures: readonly (keyof M & string)[],
) {
  const totals = emptyMeasures<ReportSeriesMeasures>(measures);

  for (const bucket of buckets) {
    for (const measure of measures) {
      totals[measure] = roundMoney(totals[measure] + bucket[measure]);
    }
  }

  return totals as M;
}

/**
 * Agrupa filas diarias en la serie pedida. `rows` trae juntas las del rango
 * actual y las del anterior (las de fuera de ambos se ignoran).
 */
export function buildReportSeries<M extends ReportSeriesMeasures>(input: {
  /** Medidas que se suman; el resto de campos de `values` se ignora. */
  measures: readonly (keyof M & string)[];
  /** Medida sobre la que se calcula `totals.deltaPct`. */
  primaryMeasure: keyof M & string;
  request: ReportSeriesRequest;
  rows: readonly ReportSeriesDayRow<M>[];
}): ReportSeries<M> {
  const { measures, primaryMeasure, request, rows } = input;
  const byDay = sumByDay(rows, measures);
  const windows = buildBucketWindows(request.range, request.groupBy);
  const current = buildBuckets<M>(windows, byDay, measures);
  const currentTotals = sumBuckets(current, measures);

  if (!request.previousRange) {
    return {
      current,
      groupBy: request.groupBy,
      previous: null,
      previousRange: null,
      range: request.range,
      totals: { current: currentTotals, deltaPct: null, previous: null },
    };
  }

  const shift = -inclusiveIsoDayCount(request.range.from, request.range.to);
  const previous = buildBuckets<M>(
    windows.map((window) => ({
      from: shiftIsoDate(window.from, shift),
      to: shiftIsoDate(window.to, shift),
    })),
    byDay,
    measures,
  );
  const previousTotals = sumBuckets(previous, measures);

  return {
    current,
    groupBy: request.groupBy,
    previous,
    previousRange: request.previousRange,
    range: request.range,
    totals: {
      current: currentTotals,
      deltaPct: computeDeltaPct(currentTotals[primaryMeasure], previousTotals[primaryMeasure]),
      previous: previousTotals,
    },
  };
}

/**
 * Periodos de una serie como puntos de `TimeSeriesChart`. Un periodo de un solo
 * día deja el título al gráfico (fecha larga en español); el de varios días
 * lleva "Del dd/mm/aaaa al dd/mm/aaaa".
 */
export function toTimeSeriesPoints<M extends ReportSeriesMeasures>(
  buckets: readonly ReportSeriesBucket<M>[] | null | undefined,
  fields: { count?: keyof M & string; valueRef: keyof M & string; valueVes?: keyof M & string },
): TimeSeriesPoint[] {
  return (buckets ?? []).map((bucket) => ({
    count: fields.count ? bucket[fields.count] : undefined,
    key: bucket.key,
    label: bucket.label,
    title:
      bucket.from === bucket.to
        ? undefined
        : `Del ${longDay(bucket.from)} al ${longDay(bucket.to)}`,
    valueRef: bucket[fields.valueRef],
    valueVes: fields.valueVes ? bucket[fields.valueVes] : undefined,
  }));
}

export type DailySalesSeriesMeasures = {
  /** Nº de ventas. */
  count: number;
  paidVes: number;
  totalRef: number;
  totalVes: number;
};

export type GrossProfitSeriesMeasures = {
  costRef: number;
  grossProfitRef: number;
  revenueRef: number;
};

export type PurchasesSeriesMeasures = {
  /** Nº de compras. */
  count: number;
  totalRef: number;
  totalVes: number;
};

export type DailySalesSeries = ReportSeries<DailySalesSeriesMeasures>;
export type GrossProfitSeries = ReportSeries<GrossProfitSeriesMeasures>;
export type PurchasesSeries = ReportSeries<PurchasesSeriesMeasures>;

export function buildDailySalesSeries(
  request: ReportSeriesRequest,
  rows: readonly ReportSeriesDayRow<DailySalesSeriesMeasures>[],
): DailySalesSeries {
  return buildReportSeries({
    measures: ["count", "paidVes", "totalRef", "totalVes"],
    primaryMeasure: "totalRef",
    request,
    rows,
  });
}

export function buildGrossProfitSeries(
  request: ReportSeriesRequest,
  rows: readonly ReportSeriesDayRow<GrossProfitSeriesMeasures>[],
): GrossProfitSeries {
  return buildReportSeries({
    measures: ["costRef", "grossProfitRef", "revenueRef"],
    primaryMeasure: "grossProfitRef",
    request,
    rows,
  });
}

export function buildPurchasesSeries(
  request: ReportSeriesRequest,
  rows: readonly ReportSeriesDayRow<PurchasesSeriesMeasures>[],
): PurchasesSeries {
  return buildReportSeries({
    measures: ["count", "totalRef", "totalVes"],
    primaryMeasure: "totalRef",
    request,
    rows,
  });
}

/** Estados que no cuentan como venta ni como compra en las series (igual que las vistas SQL). */
export const SERIES_EXCLUDED_SALE_STATUSES = ["cancelada", "devuelta"] as const;
export const SERIES_EXCLUDED_PURCHASE_STATUSES = ["cancelado", "devuelto"] as const;

/**
 * Validación de entrada de las rutas de reportes de serie: lanza `ApiError` 400
 * si `from`/`to`/`groupBy` no son válidos o el rango de la serie es excesivo.
 */
export function assertReportSeriesParams(searchParams: URLSearchParams) {
  resolveReportSeriesRequest(parseReportSeriesParams(searchParams));
}
