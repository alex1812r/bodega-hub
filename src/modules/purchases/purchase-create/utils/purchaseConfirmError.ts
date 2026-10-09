import { ClientApiError } from "@/shared/api/apiFetch";

export const PURCHASE_NETWORK_ERROR_MESSAGE =
  "No pudimos conectar con el servidor. Revisa tu conexión y vuelve a intentar; no se duplicará la compra.";

export const PURCHASE_SERVER_ERROR_MESSAGE =
  "No pudimos registrar la compra. Inténtalo de nuevo; no se duplicará.";

/**
 * Un `fetch` que no llega a tener respuesta rechaza con `TypeError` («Failed to fetch»):
 * eso se dice en español. Lo que contesta el servidor se muestra tal cual. Sirve a todo
 * envío de compras que viaja con clave de idempotencia (confirmar, recibir).
 */
export function describePurchaseRequestError(error: Error) {
  return error instanceof TypeError ? PURCHASE_NETWORK_ERROR_MESSAGE : error.message;
}

/**
 * Motivo por el que el servidor no registró la compra. Un 5xx trae un mensaje técnico (o
 * ninguno): se cambia por uno propio. Un 4xx es una regla de negocio y se muestra tal cual.
 */
export function describeConfirmError(error: Error) {
  return error instanceof ClientApiError && error.status >= 500
    ? PURCHASE_SERVER_ERROR_MESSAGE
    : describePurchaseRequestError(error);
}
