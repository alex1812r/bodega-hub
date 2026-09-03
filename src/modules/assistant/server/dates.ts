import { getCaracasIsoDate, shiftIsoDate } from "@/shared/utils/caracasBusinessDay";

import type { AssistantToolRange } from "../types";

export const assistantDatePresets = [
  "hoy",
  "ayer",
  "desde_ayer",
  "esta_semana",
  "semana_pasada",
  "este_mes",
  "mes_pasado",
  "ultimos_7_dias",
  "ultimos_30_dias",
  "ultimos_3_meses",
  "este_anio",
] as const;

export type AssistantDatePreset = (typeof assistantDatePresets)[number];

export type ResolveRangeInput = {
  from?: string | null;
  preset?: AssistantDatePreset | null;
  to?: string | null;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Valida forma y calendario real (rechaza 2026-02-30). */
export function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month! - 1 &&
    date.getUTCDate() === day
  );
}

function startOfMonth(isoDate: string) {
  return `${isoDate.slice(0, 7)}-01`;
}

function endOfMonth(isoDate: string) {
  const [year, month] = isoDate.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year!, month!, 0)).getUTCDate();

  return `${isoDate.slice(0, 7)}-${String(lastDay).padStart(2, "0")}`;
}

function shiftMonths(isoDate: string, months: number) {
  const [year, month] = isoDate.split("-").map(Number);
  const target = new Date(Date.UTC(year!, month! - 1 + months, 1));

  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

/** Lunes de la semana del dia dado (semana lunes-domingo). */
function startOfWeek(isoDate: string) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const weekday = new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay();
  const daysFromMonday = (weekday + 6) % 7;

  return shiftIsoDate(isoDate, -daysFromMonday);
}

function rangeForPreset(preset: AssistantDatePreset, today: string): AssistantToolRange {
  switch (preset) {
    case "hoy":
      return { from: today, to: today };
    case "ayer": {
      const yesterday = shiftIsoDate(today, -1);
      return { from: yesterday, to: yesterday };
    }
    case "desde_ayer":
      return { from: shiftIsoDate(today, -1), to: today };
    case "esta_semana":
      return { from: startOfWeek(today), to: today };
    case "semana_pasada": {
      const lastMonday = shiftIsoDate(startOfWeek(today), -7);
      return { from: lastMonday, to: shiftIsoDate(lastMonday, 6) };
    }
    case "este_mes":
      return { from: startOfMonth(today), to: today };
    case "mes_pasado": {
      const firstOfLastMonth = shiftMonths(today, -1);
      return { from: firstOfLastMonth, to: endOfMonth(firstOfLastMonth) };
    }
    case "ultimos_7_dias":
      return { from: shiftIsoDate(today, -6), to: today };
    case "ultimos_30_dias":
      return { from: shiftIsoDate(today, -29), to: today };
    case "ultimos_3_meses":
      return { from: shiftMonths(today, -2), to: today };
    case "este_anio":
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
  }
}

export class AssistantDateError extends Error {}

/**
 * Traduce `{from,to,preset}` a un rango ISO en dia operativo Caracas.
 * Sin ningun dato usa `defaultPreset`. Corrige rangos invertidos y recorta
 * fechas futuras al dia de hoy.
 */
export function resolveRange(
  input: ResolveRangeInput | undefined,
  today: string = getCaracasIsoDate(),
  defaultPreset: AssistantDatePreset = "ultimos_30_dias",
): AssistantToolRange {
  const rawFrom = input?.from?.trim() || null;
  const rawTo = input?.to?.trim() || null;

  if (rawFrom && !isValidIsoDate(rawFrom)) {
    throw new AssistantDateError(`La fecha de inicio "${rawFrom}" no existe en el calendario.`);
  }

  if (rawTo && !isValidIsoDate(rawTo)) {
    throw new AssistantDateError(`La fecha de fin "${rawTo}" no existe en el calendario.`);
  }

  if (!rawFrom && !rawTo) {
    return rangeForPreset(input?.preset ?? defaultPreset, today);
  }

  let from = rawFrom ?? rawTo!;
  let to = rawTo ?? rawFrom!;

  if (from > to) {
    [from, to] = [to, from];
  }

  // El futuro no tiene datos: recortamos para no prometer rangos vacios.
  if (to > today) {
    to = today;
  }

  if (from > to) {
    from = to;
  }

  return { from, to };
}

const WEEKDAYS = [
  "domingo",
  "lunes",
  "martes",
  "miercoles",
  "jueves",
  "viernes",
  "sabado",
] as const;

const MONTHS = [
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

/** "lunes 2 de septiembre de 2026" — para el system prompt. */
export function describeIsoDate(isoDate: string) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay()];

  return `${weekday} ${day} de ${MONTHS[month! - 1]} de ${year}`;
}
