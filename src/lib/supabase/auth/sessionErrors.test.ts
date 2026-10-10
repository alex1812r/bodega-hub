import {
  AuthApiError,
  AuthInvalidJwtError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
  AuthUnknownError,
} from "@supabase/supabase-js";

import { isAuthServiceFailure, isSessionAuthError } from "./sessionErrors";

describe("isSessionAuthError", () => {
  it.each([
    ["refresh token inexistente o revocado", new AuthApiError("Invalid Refresh Token: Refresh Token Not Found", 400, "refresh_token_not_found")],
    ["refresh token ya usado", new AuthApiError("Invalid Refresh Token: Already Used", 400, "refresh_token_already_used")],
    ["refresh inválido de un GoTrue sin códigos", new AuthApiError("Invalid Refresh Token: Refresh Token Not Found", 400, undefined)],
    ["sesión revocada", new AuthApiError("Session from session_id claim in JWT does not exist", 403, "session_not_found")],
    ["sesión expirada por inactividad", new AuthApiError("Session expired", 400, "session_expired")],
    ["JWT caducado", new AuthApiError("invalid JWT: token is expired", 403, "bad_jwt")],
    ["JWT manipulado", new AuthApiError("invalid JWT: signature is invalid", 401, "bad_jwt")],
    ["JWT mal formado detectado en el cliente", new AuthInvalidJwtError("Invalid JWT structure")],
    ["petición sin Authorization", new AuthApiError("This endpoint requires a Bearer token", 401, "no_authorization")],
    ["usuario del token borrado", new AuthApiError("User from sub claim in JWT does not exist", 403, "user_not_found")],
    ["usuario bloqueado", new AuthApiError("User is banned", 403, "user_banned")],
    ["sin cookie de sesión", new AuthSessionMissingError()],
    ["401 de auth sin código", new AuthApiError("Unauthorized", 401, undefined)],
    ["objeto plano con código de sesión", { code: "session_not_found", message: "Auth session missing!" }],
    // POS-F2: formas exactas de GoTrue ante un refresh token mal formado.
    ["refresh token mal formado", new AuthApiError("Refresh token is not valid", 400, "validation_failed")],
    [
      "refresh token que no es texto",
      new AuthApiError(
        "Could not parse request body as JSON: json: cannot unmarshal number into Go struct field RefreshTokenGrantParams.refresh_token of type string",
        400,
        "bad_json",
      ),
    ],
    ["refresh rechazado como grant inválido", new AuthApiError("Invalid grant", 400, "invalid_grant")],
    ["credencial rechazada", new AuthApiError("Invalid login credentials", 400, "invalid_credentials")],
    ["400 sin código y con otro texto", new AuthApiError("Something about a refresh token", 400, undefined)],
    ["404 del servidor de auth", new AuthApiError("User not found", 404, undefined)],
    ["422 del servidor de auth", new AuthApiError("Unprocessable", 422, undefined)],
  ])("%s → sesión no válida (401)", (_label, error) => {
    expect(isSessionAuthError(error)).toBe(true);
    expect(isAuthServiceFailure(error)).toBe(false);
  });

  it.each([
    ["sin red", new AuthRetryableFetchError("fetch failed", 0)],
    ["gateway caído", new AuthRetryableFetchError("Bad Gateway", 502)],
    ["servicio no disponible", new AuthRetryableFetchError("Service Unavailable", 503)],
    ["fallo interno de GoTrue", new AuthApiError("Database is unavailable", 500, "unexpected_failure")],
    ["5xx cuyo texto habla del refresh token", new AuthApiError("Invalid Refresh Token: upstream timeout", 503, undefined)],
  ])("%s → fallo del servicio, nunca 401", (_label, error) => {
    expect(isSessionAuthError(error)).toBe(false);
    expect(isAuthServiceFailure(error)).toBe(true);
  });

  it.each([
    ["respuesta que no es JSON", new AuthUnknownError("Unexpected token <", new Error("boom"))],
    ["límite de peticiones", new AuthApiError("Too many requests", 429, "over_request_rate_limit")],
    ["límite de peticiones sin código", new AuthApiError("Too many requests", 429, undefined)],
    ["error sin estado ni código con otro texto", new AuthUnknownError("Refresh token is not valid", null)],
    ["TypeError de red sin envolver", new TypeError("fetch failed")],
    ["null", null],
    ["texto", "refresh_token_not_found"],
  ])("%s → no es un 401", (_label, error) => {
    expect(isSessionAuthError(error)).toBe(false);
  });
});
