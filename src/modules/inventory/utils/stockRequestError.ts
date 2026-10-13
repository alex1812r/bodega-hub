import { ClientApiError } from "@/shared/api/apiFetch";

/**
 * Aviso de un envío que mueve stock y cuyo resultado no se pudo confirmar. El
 * movimiento pudo haberse registrado, y un envío con otro contenido o tras
 * cerrar el formulario viaja con otra clave de idempotencia (ver
 * `RequestAttempt`), así que el usuario debe revisarlo antes de repetir.
 */
export const UNCERTAIN_STOCK_REQUEST_MESSAGE =
  "No pudimos confirmar si el movimiento se registró. Revisa los movimientos del producto antes de volver a intentarlo.";

/**
 * Texto para el usuario del error de un envío que mueve stock (ajuste,
 * conversión de empaque).
 *
 * - Sin respuesta del servidor (red caída, petición abortada), 5xx o 408: el
 *   resultado es incierto y se muestra `UNCERTAIN_STOCK_REQUEST_MESSAGE`; nunca
 *   el mensaje del navegador ("Failed to fetch").
 * - Resto de respuestas 4xx (también 409): `error.message` del servidor, tal cual.
 */
export function describeStockRequestError(error: unknown): string {
  if (error instanceof ClientApiError && error.status < 500 && error.status !== 408) {
    return error.message;
  }

  return UNCERTAIN_STOCK_REQUEST_MESSAGE;
}
