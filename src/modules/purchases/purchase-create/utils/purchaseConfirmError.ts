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

/** Inicio de los mensajes por defecto de zod, en inglés (como en RegisterPaymentModal): no se enseñan. */
const DEFAULT_ISSUE_MESSAGE = /^(Invalid|Too (big|small)|Unrecognized|Required|Expected)\b/;

/**
 * REP13-02 (M-p14B-1, D60(b)): un 400 de validación trae el motivo en `issues` y un mensaje
 * genérico («La solicitud no tiene un formato válido.»). Se juntan los mensajes distintos de
 * los issues, sin los de zod en inglés; sin ninguno, `undefined`.
 */
function issueMessages(error: Error) {
  if (!(error instanceof ClientApiError) || error.status !== 400 || !Array.isArray(error.issues)) {
    return undefined;
  }

  const messages = new Set<string>();

  for (const issue of error.issues as unknown[]) {
    if (typeof issue === "object" && issue !== null && "message" in issue && typeof issue.message === "string") {
      const message = issue.message.trim();

      if (message && !DEFAULT_ISSUE_MESSAGE.test(message)) {
        messages.add(message);
      }
    }
  }

  return messages.size > 0 ? [...messages].join(" ") : undefined;
}

/**
 * Motivo por el que el servidor no registró la compra. Un 5xx trae un mensaje técnico (o
 * ninguno): se cambia por uno propio. Un 4xx es una regla de negocio y se muestra tal cual,
 * salvo un 400 con `issues`, que muestra sus motivos.
 */
export function describeConfirmError(error: Error) {
  return error instanceof ClientApiError && error.status >= 500
    ? PURCHASE_SERVER_ERROR_MESSAGE
    : (issueMessages(error) ?? describePurchaseRequestError(error));
}
