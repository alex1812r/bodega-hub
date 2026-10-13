import { ApiError } from "@/lib/api/apiError";
import { getCaracasIsoDate } from "@/shared/utils/caracasBusinessDay";

/**
 * Validación de entrada común de las rutas de Reportes y del dashboard
 * (REP-F7). Un parámetro AUSENTE o vacío nunca se rechaza: solo se valida lo
 * que llega.
 */

/**
 * Primer año que acepta un reporte. El sistema no tiene datos anteriores y un
 * año de 4 cifras dentro de `[REPORT_MIN_YEAR, año actual + 1]` garantiza que
 * ninguna aritmética de fechas (periodo anterior, `shiftIsoDate`) se salga del
 * formato `yyyy-mm-dd`, que es lo que permite compararlas como texto.
 */
export const REPORT_MIN_YEAR = 2000;

/** Último año que acepta un reporte: el año operativo actual más uno. */
export function reportMaxYear(today: string = getCaracasIsoDate()) {
  return Number(today.slice(0, 4)) + 1;
}

/** Tope de longitud de un identificador recibido por la URL. */
export const REPORT_ID_MAX_LENGTH = 64;

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const REPORT_ID = /^[A-Za-z0-9_-]+$/;
const MS_PER_DAY = 86_400_000;

function badRequest(message: string) {
  return new ApiError(400, "BAD_REQUEST", message);
}

/**
 * Nº de día (días desde 1970-01-01) de un `yyyy-mm-dd` que además es una fecha
 * real del calendario; `null` en cualquier otro caso (`2026-02-30`,
 * `10000-01-01`, `abc`). Sirve para comparar y contar días sin depender del
 * orden de las fechas como texto.
 */
export function isoDayNumber(value: string): number | null {
  const match = ISO_DAY.exec(value);

  if (!match) {
    return null;
  }

  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(0);
  // `setUTCFullYear` no aplica el desplazamiento de siglo de `Date.UTC` a los años 0–99.
  date.setUTCFullYear(year, month - 1, day);

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return Math.round(date.getTime() / MS_PER_DAY);
}

/** `yyyy-mm-dd` que además es una fecha real del calendario. */
export function isIsoDay(value: string) {
  return isoDayNumber(value) !== null;
}

/** Fecha real del calendario cuyo año está en `[REPORT_MIN_YEAR, reportMaxYear()]`. */
export function isReportDay(value: string, today?: string) {
  if (!isIsoDay(value)) {
    return false;
  }

  const year = Number(value.slice(0, 4));

  return year >= REPORT_MIN_YEAR && year <= reportMaxYear(today);
}

/**
 * Lanza `ApiError` 400 en español si `value` no es una fecha `yyyy-mm-dd` real
 * o su año está fuera de `[REPORT_MIN_YEAR, año actual + 1]`. `label` es el
 * nombre del campo de cara al usuario ("desde", "hasta").
 */
export function assertReportDay(value: string, label: string) {
  if (!isIsoDay(value)) {
    throw badRequest(`La fecha "${label}" no es válida. Usa el formato AAAA-MM-DD.`);
  }

  if (!isReportDay(value)) {
    throw badRequest(
      `La fecha "${label}" no es válida. El año debe estar entre ${REPORT_MIN_YEAR} y ${reportMaxYear()}.`,
    );
  }
}

/**
 * Lee un parámetro de fecha de la URL. Ausente o vacío → `null` (no se
 * valida). Si llega, debe ser exactamente un día válido (`assertReportDay`):
 * NO se recorta, así que ` 2026-01-01` o `2026-01-01%0a` responden 400 en
 * todas las rutas. Es el único lector de fechas de Reportes y del dashboard:
 * antes las rutas con serie recortaban y aceptaban lo que las demás rechazaban.
 */
export function readReportDayParam(searchParams: URLSearchParams, name: string, label: string) {
  const value = searchParams.get(name);

  if (value === null || value === "") {
    return null;
  }

  assertReportDay(value, label);

  return value;
}

function isTruthyParam(value: string | null) {
  const normalized = value?.trim().toLowerCase() ?? "";
  return normalized !== "" && normalized !== "0" && normalized !== "false";
}

const DATE_PARAM_LABELS = { date: "día", from: "desde", to: "hasta" } as const;

/**
 * Validación de fechas de las rutas que pasan `from` / `to` (/ `date`) tal cual
 * al servicio: cada una, si llega, debe ser un día válido (`assertReportDay`),
 * y `from` no puede ser posterior a `to`. Con `fromStart` el `from` se ignora,
 * igual que en los servicios. Un parámetro ausente o vacío no se valida.
 */
export function assertReportDateParams(searchParams: URLSearchParams) {
  const fromStart = isTruthyParam(searchParams.get("fromStart"));
  const read = (name: keyof typeof DATE_PARAM_LABELS) =>
    name === "from" && fromStart
      ? null
      : readReportDayParam(searchParams, name, DATE_PARAM_LABELS[name]);

  const from = read("from");
  const to = read("to");
  read("date");

  if (from !== null && to !== null && from > to) {
    throw badRequest('La fecha "desde" no puede ser posterior a la fecha "hasta".');
  }
}

/**
 * Forma y longitud de los identificadores que llegan por la URL (uuid en la
 * base, `prod-cable` en el mock): letras, números, guion y guion bajo, hasta
 * `REPORT_ID_MAX_LENGTH`. `params` asocia el nombre del parámetro con el
 * sujeto del mensaje ("El producto"). Un parámetro ausente o vacío no se valida.
 */
export function assertReportIdParams(
  searchParams: URLSearchParams,
  params: Readonly<Record<string, string>>,
) {
  for (const [name, subject] of Object.entries(params)) {
    const value = searchParams.get(name);

    if (value === null || value === "") {
      continue;
    }

    if (value.length > REPORT_ID_MAX_LENGTH || !REPORT_ID.test(value)) {
      throw badRequest(`${subject} no es válido.`);
    }
  }
}
