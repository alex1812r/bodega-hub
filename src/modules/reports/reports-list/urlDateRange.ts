import { isValidIsoDate } from "@/shared/components/DateRangeField";

/** Primer año que la interfaz acepta en una fecha de la URL. */
const URL_DATE_MIN_YEAR = 2000;

/**
 * Fecha de la URL que se puede pedir al servidor: un `YYYY-MM-DD` real con el
 * año entre 2000 y el siguiente al del día operativo. Un `9999-12-31` es una
 * fecha válida de calendario, pero no un rango que tenga sentido consultar.
 */
export function isUsableUrlDate(value: string, today: string) {
  if (!isValidIsoDate(value)) {
    return false;
  }

  const year = Number(value.slice(0, 4));

  return year >= URL_DATE_MIN_YEAR && year <= Number(today.slice(0, 4)) + 1;
}

export type SanitizedUrlRange = {
  from: string;
  to: string;
  /** La URL traía un rango que no se puede usar: se descartó y hay que avisar. */
  wasInvalid: boolean;
};

/**
 * Rango `from` / `to` del estado de la lista → rango que se puede usar. Si la
 * URL lo trae invertido, con el año fuera de rango o mal formado, se descartan
 * LAS DOS fechas (la pantalla cae a su rango por defecto y nada de eso viaja al
 * servidor) y se marca `wasInvalid` para avisar.
 *
 * `state` es lo que entrega `useUrlListState` (una fecha mal formada ya llega
 * como `""`); `raw`, los parámetros tal cual están en la URL, que es la única
 * forma de saber que había una fecha mal formada. Solo cuenta mientras el
 * estado sigue sin esa fecha: si el usuario ya eligió otro rango, manda él.
 */
export function sanitizeUrlRange(
  state: { from: string; to: string },
  raw: { from: string | null; to: string | null },
  today: string,
): SanitizedUrlRange {
  const isMalformed = (rawValue: string | null, stateValue: string) =>
    Boolean(rawValue) && !isValidIsoDate(rawValue) && stateValue === "";
  const isOutOfRange = (value: string) => value !== "" && !isUsableUrlDate(value, today);
  const isInverted = state.from !== "" && state.to !== "" && state.from > state.to;
  const wasInvalid =
    isMalformed(raw.from, state.from) ||
    isMalformed(raw.to, state.to) ||
    isOutOfRange(state.from) ||
    isOutOfRange(state.to) ||
    isInverted;

  return wasInvalid
    ? { from: "", to: "", wasInvalid: true }
    : { from: state.from, to: state.to, wasInvalid: false };
}
