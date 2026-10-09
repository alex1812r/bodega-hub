import { shiftIsoDate } from "@bodega/core/dates";

/** Identificadores estables de preset: son los que viajan en la URL (`?preset=`). */
export const DATE_RANGE_PRESETS = [
  "today",
  "yesterday",
  "this_week",
  "last_week",
  "this_month",
  "last_month",
  "last_30_days",
  "custom",
] as const;

export type DateRangePreset = (typeof DATE_RANGE_PRESETS)[number];

/** Presets cuyo rango depende del día de hoy (todos menos `custom`). */
export type RelativeDateRangePreset = Exclude<DateRangePreset, "custom">;

export const RELATIVE_DATE_RANGE_PRESETS: readonly RelativeDateRangePreset[] =
  DATE_RANGE_PRESETS.filter((preset): preset is RelativeDateRangePreset => preset !== "custom");

export const DATE_RANGE_PRESET_LABELS: Record<DateRangePreset, string> = {
  custom: "Personalizado",
  last_30_days: "Últimos 30 días",
  last_month: "Mes pasado",
  last_week: "Semana pasada",
  this_month: "Este mes",
  this_week: "Esta semana",
  today: "Hoy",
  yesterday: "Ayer",
};

/** Rango de días de calendario `YYYY-MM-DD`, ambos extremos incluidos. */
export type DateRange = { from: string; to: string };

/** Valor de `DateRangeField`. Sin `from` ni `to` = sin rango. */
export type DateRangeValue = { from?: string; to?: string; preset?: DateRangePreset };

/** Lo que emite `DateRangeField`: siempre las tres claves, para usarlo como patch. */
export type DateRangeChange = {
  from: string | undefined;
  to: string | undefined;
  preset: DateRangePreset | undefined;
};

export const MONTH_NAMES = [
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
] as const;

const MONTH_SHORT_NAMES = [
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

/** Lunes primero: la semana del negocio va de lunes a domingo. */
export const WEEKDAY_NAMES = [
  "lunes",
  "martes",
  "miércoles",
  "jueves",
  "viernes",
  "sábado",
  "domingo",
] as const;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const EN_DASH = "–";

type IsoDateParts = { day: number; month: number; year: number };

function pad(value: number, length = 2) {
  return String(value).padStart(length, "0");
}

function toIsoDate(year: number, month: number, day: number) {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

/** Partes de un `YYYY-MM-DD` ya validado (`month` 1–12). */
export function isoDateParts(isoDate: string): IsoDateParts {
  const [year, month, day] = isoDate.split("-").map(Number);

  return { day, month, year };
}

export function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** `true` solo para un `YYYY-MM-DD` que existe en el calendario. */
export function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  const match = ISO_DATE.exec(value);

  if (!match) {
    return false;
  }

  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];

  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

export function isDateRangePreset(value: unknown): value is DateRangePreset {
  return DATE_RANGE_PRESETS.some((preset) => preset === value);
}

/** Día de la semana con lunes = 0 … domingo = 6. Aritmética UTC: no depende de la zona del navegador. */
export function isoWeekdayIndex(isoDate: string) {
  const { day, month, year } = isoDateParts(isoDate);

  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
}

export function startOfIsoWeek(isoDate: string) {
  return shiftIsoDate(isoDate, -isoWeekdayIndex(isoDate));
}

export function startOfIsoMonth(isoDate: string) {
  return `${isoDate.slice(0, 8)}01`;
}

/** Mismo día en otro mes; si el mes destino es más corto, su último día. */
export function shiftIsoMonth(isoDate: string, months: number) {
  const { day, month, year } = isoDateParts(isoDate);
  const monthIndex = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(monthIndex / 12);
  const targetMonth = (monthIndex % 12) + 1;

  return toIsoDate(targetYear, targetMonth, Math.min(day, daysInMonth(targetYear, targetMonth)));
}

/** Ordena los extremos: un fin anterior al inicio se intercambia. */
export function normalizeDateRange(first: string, second: string): DateRange {
  return first <= second ? { from: first, to: second } : { from: second, to: first };
}

/**
 * Rango de un preset relativo, con extremos incluidos.
 *
 * `today` es el día operativo (Caracas) en `YYYY-MM-DD` y lo aporta quien
 * llama: aquí no se lee el reloj ni la zona del navegador.
 *
 * - `this_week` y `this_month` van hasta hoy (periodo en curso, sin días futuros).
 * - La semana va de lunes a domingo.
 * - `last_30_days` son 30 días contando hoy.
 */
export function resolveDateRangePreset(preset: RelativeDateRangePreset, today: string): DateRange {
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const yesterday = shiftIsoDate(today, -1);

      return { from: yesterday, to: yesterday };
    }
    case "this_week":
      return { from: startOfIsoWeek(today), to: today };
    case "last_week": {
      const monday = shiftIsoDate(startOfIsoWeek(today), -7);

      return { from: monday, to: shiftIsoDate(monday, 6) };
    }
    case "this_month":
      return { from: startOfIsoMonth(today), to: today };
    case "last_month": {
      const lastDay = shiftIsoDate(startOfIsoMonth(today), -1);

      return { from: startOfIsoMonth(lastDay), to: lastDay };
    }
    case "last_30_days":
      return { from: shiftIsoDate(today, -29), to: today };
  }
}

/** Primer preset relativo cuyo rango de hoy es exactamente `from`–`to`. */
export function findMatchingRelativePreset(
  from: string | undefined,
  to: string | undefined,
  today: string,
  candidates: readonly DateRangePreset[] = RELATIVE_DATE_RANGE_PRESETS,
): RelativeDateRangePreset | undefined {
  if (!from || !to) {
    return undefined;
  }

  return RELATIVE_DATE_RANGE_PRESETS.find((preset) => {
    if (!candidates.includes(preset)) {
      return false;
    }

    const range = resolveDateRangePreset(preset, today);

    return range.from === from && range.to === to;
  });
}

function formatDay(isoDate: string, withMonth: boolean, withYear: boolean) {
  const { day, month, year } = isoDateParts(isoDate);

  return [String(day), withMonth ? MONTH_SHORT_NAMES[month - 1] : null, withYear ? String(year) : null]
    .filter((part) => part !== null)
    .join(" ");
}

/** "9 de octubre de 2026". */
export function formatLongIsoDate(isoDate: string) {
  const { day, month, year } = isoDateParts(isoDate);

  return `${day} de ${MONTH_NAMES[month - 1]} de ${year}`;
}

/**
 * Rango en texto corto: "1–30 sep 2026", "28 sep – 4 oct 2026",
 * "28 dic 2025 – 3 ene 2026", "9 oct 2026". Con un solo extremo, "Desde …" o
 * "Hasta …"; sin ninguno, "Todas las fechas".
 */
export function formatDateRangeLabel(from?: string, to?: string) {
  if (!from && !to) {
    return "Todas las fechas";
  }

  if (!to) {
    return `Desde ${formatDay(from ?? "", true, true)}`;
  }

  if (!from) {
    return `Hasta ${formatDay(to, true, true)}`;
  }

  if (from === to) {
    return formatDay(from, true, true);
  }

  const start = isoDateParts(from);
  const end = isoDateParts(to);

  if (start.year !== end.year) {
    return `${formatDay(from, true, true)} ${EN_DASH} ${formatDay(to, true, true)}`;
  }

  if (start.month !== end.month) {
    return `${formatDay(from, true, false)} ${EN_DASH} ${formatDay(to, true, true)}`;
  }

  return `${start.day}${EN_DASH}${formatDay(to, true, true)}`;
}
