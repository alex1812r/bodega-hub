import { getCaracasIsoDate, shiftIsoDate } from "@bodega/core";

/**
 * Quincenas de nómina.
 *
 * Q1 = día 1 al 15, Q2 = día 16 al último día del mes, siempre en día operativo
 * America/Caracas (`[T04:00Z, siguiente T04:00Z)`). La clave `YYYY-MM-Qx` es el
 * identificador estable que viaja por la API y por `payroll_periods.period_key`.
 */

export type PayrollHalf = 1 | 2;

export type PayrollPeriodRange = {
  fromDate: string;
  half: PayrollHalf;
  month: number;
  periodKey: string;
  toDate: string;
  year: number;
};

const PERIOD_KEY_PATTERN = /^(\d{4})-(\d{2})-Q([12])$/;

/** Último día del mes (1-12) sin depender de la zona horaria local. */
export function lastDayOfMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0, 12, 0, 0)).getUTCDate();
}

function buildPeriodKey(year: number, month: number, half: PayrollHalf) {
  return `${String(year)}-${String(month).padStart(2, "0")}-Q${String(half)}`;
}

function buildRange(year: number, month: number, half: PayrollHalf): PayrollPeriodRange {
  const monthKey = `${String(year)}-${String(month).padStart(2, "0")}`;
  const fromDay = half === 1 ? 1 : 16;
  const toDay = half === 1 ? 15 : lastDayOfMonth(year, month);

  return {
    fromDate: `${monthKey}-${String(fromDay).padStart(2, "0")}`,
    half,
    month,
    periodKey: buildPeriodKey(year, month, half),
    toDate: `${monthKey}-${String(toDay).padStart(2, "0")}`,
    year,
  };
}

/** `2026-09-Q1` → rango de fechas. Devuelve `null` si la clave no es válida. */
export function parsePeriodKey(periodKey: string): PayrollPeriodRange | null {
  const match = PERIOD_KEY_PATTERN.exec(periodKey.trim());

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const half = Number(match[3]) as PayrollHalf;

  if (month < 1 || month > 12) {
    return null;
  }

  return buildRange(year, month, half);
}

export function isPayrollPeriodKey(value: unknown): value is string {
  return typeof value === "string" && parsePeriodKey(value) !== null;
}

/** Quincena a la que pertenece un día calendario `YYYY-MM-DD` de Caracas. */
export function periodKeyForDate(isoDate: string) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const half: PayrollHalf = (day ?? 1) <= 15 ? 1 : 2;

  return buildPeriodKey(year ?? 0, month ?? 1, half);
}

export function periodRangeForDate(isoDate: string) {
  const range = parsePeriodKey(periodKeyForDate(isoDate));

  if (!range) {
    throw new Error(`Fecha de quincena inválida: ${isoDate}`);
  }

  return range;
}

/** Quincena en curso según el día operativo Caracas. */
export function currentPeriodKey(now: Date = new Date()) {
  return periodKeyForDate(getCaracasIsoDate(now));
}

/** Quincena anterior a la clave dada; cruza mes y año. */
export function previousPeriodKey(periodKey: string) {
  const range = parsePeriodKey(periodKey);

  if (!range) {
    return null;
  }

  if (range.half === 2) {
    return buildPeriodKey(range.year, range.month, 1);
  }

  const previousMonth = range.month === 1 ? 12 : range.month - 1;
  const previousYear = range.month === 1 ? range.year - 1 : range.year;

  return buildPeriodKey(previousYear, previousMonth, 2);
}

export function nextPeriodKey(periodKey: string) {
  const range = parsePeriodKey(periodKey);

  if (!range) {
    return null;
  }

  if (range.half === 1) {
    return buildPeriodKey(range.year, range.month, 2);
  }

  const nextMonth = range.month === 12 ? 1 : range.month + 1;
  const nextYear = range.month === 12 ? range.year + 1 : range.year;

  return buildPeriodKey(nextYear, nextMonth, 1);
}

/**
 * Una quincena solo se puede calcular cuando ya terminó: su último día tiene que
 * haber pasado en Caracas. La quincena en curso solo admite estimación.
 */
export function isPeriodClosed(periodKey: string, now: Date = new Date()) {
  const range = parsePeriodKey(periodKey);

  if (!range) {
    return false;
  }

  return range.toDate < getCaracasIsoDate(now);
}

/** Límites UTC `[inicio, fin)` de la quincena, en día operativo Caracas. */
export function periodUtcBounds(periodKey: string) {
  const range = parsePeriodKey(periodKey);

  if (!range) {
    return null;
  }

  return {
    endUtcExclusive: `${shiftIsoDate(range.toDate, 1)}T04:00:00.000Z`,
    startUtc: `${range.fromDate}T04:00:00.000Z`,
  };
}

/** Etiqueta corta para la UI: `1ª quincena de septiembre 2026`. */
const MONTH_LABELS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

export function formatPeriodLabel(periodKey: string) {
  const range = parsePeriodKey(periodKey);

  if (!range) {
    return periodKey;
  }

  const month = MONTH_LABELS[range.month - 1] ?? "";

  return `${range.half === 1 ? "1ª" : "2ª"} quincena de ${month} ${String(range.year)}`;
}

/** Las `count` quincenas anteriores a la actual, de la más reciente a la más vieja. */
export function recentPeriodKeys(count: number, now: Date = new Date()) {
  const keys: string[] = [];
  let key = previousPeriodKey(currentPeriodKey(now));

  while (key && keys.length < count) {
    keys.push(key);
    key = previousPeriodKey(key);
  }

  return keys;
}
