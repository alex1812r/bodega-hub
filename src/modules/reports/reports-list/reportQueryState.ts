import { ClientApiError } from "@/shared/api/apiFetch";

/** Texto para cualquier fallo que no sea un error de negocio del servidor. */
export const REPORT_GENERIC_ERROR_MESSAGE = "No pudimos cargar el reporte.";

/** Sin red: la consulta queda en pausa y se reanuda sola al volver la conexión. */
export const REPORT_OFFLINE_MESSAGE = "Sin conexión. Reintentaremos al volver la red.";

/** La consulta está en pausa por falta de red y no hay datos de ESTA consulta que pintar. */
export class ReportOfflineError extends Error {
  constructor() {
    super(REPORT_OFFLINE_MESSAGE);
    this.name = "ReportOfflineError";
  }
}

/** Lo que se lee de un resultado de `useQuery` (o de su doble en un test). */
type ReportQueryLike = {
  data?: unknown;
  error?: unknown;
  isPaused?: boolean;
  isPlaceholderData?: boolean;
};

/**
 * Mensaje que se puede enseñar. Solo los errores de negocio del servidor
 * (`ClientApiError`, con su mensaje ya en español) se muestran tal cual: el
 * resto (fallos de red, de la librería de consultas, de JavaScript) trae texto
 * interno, como la clave de la consulta, y se sustituye por uno genérico.
 */
export function toReportErrorMessage(error: unknown, fallback = REPORT_GENERIC_ERROR_MESSAGE) {
  if (error instanceof ClientApiError || error instanceof ReportOfflineError) {
    return error.message;
  }

  return fallback;
}

/**
 * Sin red, React Query deja la consulta en pausa: ni carga ni falla. Sin esta
 * comprobación el panel la toma por un resultado vacío.
 */
export function isReportQueryOffline(query: ReportQueryLike) {
  return Boolean(query.isPaused) && (query.data === undefined || Boolean(query.isPlaceholderData));
}

/**
 * Error que el panel debe pintar, o `null`: el de negocio tal cual (conserva el
 * 403), cualquier otro con el texto genérico, y la pausa por falta de red como
 * `ReportOfflineError`.
 */
export function getReportQueryError(query: ReportQueryLike): Error | null {
  if (query.error) {
    return query.error instanceof ClientApiError
      ? query.error
      : new Error(REPORT_GENERIC_ERROR_MESSAGE);
  }

  return isReportQueryOffline(query) ? new ReportOfflineError() : null;
}

/** Número pintable: lo que no sea un número finito (null, texto, NaN) vale 0. */
export function toFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
