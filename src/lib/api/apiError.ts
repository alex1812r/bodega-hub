import { ZodError } from "zod";

export type ApiErrorCode =
  | "ASSISTANT_LIMIT_REACHED"
  | "ASSISTANT_PROVIDER_ERROR"
  | "BAD_REQUEST"
  | "CONFLICT"
  | "FORBIDDEN"
  | "INSUFFICIENT_VAULT_BALANCE"
  | "INTERNAL_ERROR"
  | "NOT_FOUND"
  | "UNAUTHORIZED";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ApiErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const UNAUTHENTICATED_MESSAGE = "Debes iniciar sesión para continuar.";

/**
 * 401 único del BFF para "no hay sesión válida": sin credencial, access token
 * caducado, refresh token inválido o revocado, JWT manipulado. La UI lo usa
 * para volver al login (`apiFetch`); la app móvil, para refrescar su token.
 */
export function unauthenticatedError() {
  return new ApiError(401, "UNAUTHORIZED", UNAUTHENTICATED_MESSAGE);
}

export function toErrorResponse(error: unknown) {
  if (error instanceof ApiError) {
    return Response.json(
      {
        error: {
          code: error.code,
          ...(error.details === undefined ? {} : { details: error.details }),
          message: error.message,
        },
      },
      { status: error.status },
    );
  }

  if (error instanceof ZodError) {
    return Response.json(
      {
        error: {
          code: "BAD_REQUEST",
          message: "La solicitud no tiene un formato valido.",
          issues: error.issues,
        },
      },
      { status: 400 },
    );
  }

  return Response.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "Ocurrio un error inesperado.",
      },
    },
    { status: 500 },
  );
}
