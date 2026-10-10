/**
 * Clasificación de los errores de `supabase.auth.getUser()` (auth-js).
 *
 * "No hay sesión válida" (→ 401) frente a "Supabase falló" (→ 5xx). Se decide
 * por tipo (`name`), código (`code`) y estado HTTP del error, no por su texto.
 */

/** Códigos de GoTrue que significan que la credencial ya no sirve. */
const SESSION_ERROR_CODES = new Set([
  "bad_jwt",
  "invalid_jwt",
  "no_authorization",
  "refresh_token_already_used",
  "refresh_token_not_found",
  "session_expired",
  "session_not_found",
  "user_banned",
  "user_not_found",
]);

/** Errores que auth-js crea en el cliente, sin respuesta del servidor. */
const SESSION_ERROR_NAMES = new Set([
  "AuthInvalidJwtError",
  "AuthRefreshDiscardedError",
  "AuthSessionMissingError",
]);

/**
 * GoTrue anterior a los códigos de error rechaza el refresh con 400
 * `invalid_grant` y solo este texto ("Invalid Refresh Token: Refresh Token Not
 * Found", "…: Already Used"). Único caso que se decide por mensaje, y solo
 * para un 400 sin `code`.
 */
const LEGACY_REFRESH_MESSAGE = /^invalid refresh token\b/i;
/** Textos de JWT de respuestas sin `code` (GoTrue antiguo), con 400. */
const LEGACY_JWT_MESSAGE = /^(?:invalid jwt\b|auth session missing\b)|\b(?:jwt|token is) expired\b/i;

type AuthErrorShape = {
  code: string | null;
  message: string;
  name: string;
  status: number | null;
};

function readAuthError(error: unknown): AuthErrorShape | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }

  const candidate = error as { code?: unknown; message?: unknown; name?: unknown; status?: unknown };

  return {
    code: typeof candidate.code === "string" ? candidate.code : null,
    message: typeof candidate.message === "string" ? candidate.message : "",
    name: typeof candidate.name === "string" ? candidate.name : "",
    status: typeof candidate.status === "number" ? candidate.status : null,
  };
}

/**
 * `true` si Supabase no llegó a decidir: sin red (`AuthRetryableFetchError`,
 * estado 0) o servicio caído (5xx). Nunca es un 401.
 */
export function isAuthServiceFailure(error: unknown): boolean {
  const shape = readAuthError(error);

  if (!shape) {
    return false;
  }

  return (
    shape.name === "AuthRetryableFetchError" ||
    shape.status === 0 ||
    (shape.status !== null && shape.status >= 500)
  );
}

/**
 * `true` si el error dice que la petición no trae una sesión válida: sin
 * cookie, access token caducado con refresh token inválido, revocado o ya
 * usado, sesión cerrada en otro dispositivo, JWT caducado o manipulado (cookies
 * y Bearer). El BFF responde 401 y el cliente vuelve a iniciar sesión.
 */
export function isSessionAuthError(error: unknown): boolean {
  const shape = readAuthError(error);

  if (!shape || isAuthServiceFailure(error)) {
    return false;
  }

  if (
    shape.status === 401 ||
    shape.status === 403 ||
    SESSION_ERROR_NAMES.has(shape.name) ||
    (shape.code !== null && SESSION_ERROR_CODES.has(shape.code))
  ) {
    return true;
  }

  return (
    shape.code === null &&
    (shape.status === 400 || shape.status === null) &&
    (LEGACY_REFRESH_MESSAGE.test(shape.message) || LEGACY_JWT_MESSAGE.test(shape.message))
  );
}
