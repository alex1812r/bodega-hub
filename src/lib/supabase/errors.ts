import { ApiError, type ApiErrorCode } from "@/lib/api/apiError";

type SupabaseLikeError = {
  code?: string;
  details?: string;
  hint?: string;
  message?: string;
};

function isSupabaseLikeError(error: unknown): error is SupabaseLikeError {
  return typeof error === "object" && error !== null && "message" in error;
}

export const INVALID_DATA_MESSAGE ="Los datos enviados no son validos.";
const RETRYABLE_CONFLICT_MESSAGE =
  "La operacion choco con otra en curso y no se aplico. Intenta de nuevo.";

// SQLSTATE que lanzan las RPC para rechazos de negocio (`errcode = 'PT4xx'`):
// PostgREST responde con ese HTTP y el mensaje ya viene redactado para el usuario.
const BUSINESS_REJECTIONS: Record<string, { code: ApiErrorCode; fallback: string; status: number }> = {
  PT400: { code: "BAD_REQUEST", fallback: INVALID_DATA_MESSAGE, status: 400 },
  PT403: { code: "FORBIDDEN", fallback: "No autorizado para esta operacion.", status: 403 },
  PT404: { code: "NOT_FOUND", fallback: "Recurso no encontrado.", status: 404 },
  PT409: { code: "CONFLICT", fallback: "La operacion no es valida en el estado actual.", status: 409 },
};

export function getSupabaseErrorMessage(error: unknown) {
  if (isSupabaseLikeError(error) && error.message) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unexpected Supabase error.";
}

/**
 * Mapeo por SQLSTATE / codigo de PostgREST, sin mirar el mensaje. Devuelve `null`
 * si el codigo no decide nada (sin codigo, `P0001`, desconocido).
 *
 * Los mapeadores propios de un modulo (`throwIfRpcError` de pagos y ventas) lo
 * llaman ANTES de sus reglas por mensaje: asi un error crudo de Postgres nunca
 * llega al cliente por coincidir con un marcador ("invalid", "permission denied").
 */
export function mapSupabaseErrorByCode(error: unknown): ApiError | null {
  if (!isSupabaseLikeError(error) || typeof error.code !== "string") {
    return null;
  }

  const rejection = BUSINESS_REJECTIONS[error.code];

  if (rejection) {
    return new ApiError(rejection.status, rejection.code, error.message || rejection.fallback);
  }

  switch (error.code) {
    case "23505":
      return new ApiError(409, "CONFLICT", "El recurso ya existe.");
    case "PGRST116":
      return new ApiError(404, "NOT_FOUND", "Recurso no encontrado.");
    case "23503":
      return new ApiError(400, "BAD_REQUEST", "Referencia invalida.");
    // El texto de estos errores es de Postgres (columnas, relaciones, tipos, nombres
    // de constraint, el valor enviado): no se reenvia.
    case "23514":
    case "22P02":
    case "23502":
    case "22003":
    case "22007":
    case "22008":
      return new ApiError(400, "BAD_REQUEST", INVALID_DATA_MESSAGE);
    // Deadlock y fallo de serializacion: la transaccion se deshizo entera, basta reintentar.
    case "40P01":
    case "40001":
      return new ApiError(409, "CONFLICT", RETRYABLE_CONFLICT_MESSAGE, { retryable: true });
    case "42501":
      return new ApiError(403, "FORBIDDEN", "No autorizado para esta operacion.");
    default:
      return null;
  }
}

export function mapSupabaseError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  const mappedByCode = mapSupabaseErrorByCode(error);

  if (mappedByCode) {
    return mappedByCode;
  }

  if (isSupabaseLikeError(error)) {
    const message = error.message?.toLowerCase() ?? "";

    if (message.includes("invalid login credentials")) {
      return new ApiError(401, "UNAUTHORIZED", "Credenciales invalidas.");
    }

    if (message.includes("email not confirmed")) {
      return new ApiError(401, "UNAUTHORIZED", "Debes confirmar tu correo antes de ingresar.");
    }

    if (message.includes("stock insuficiente")) {
      return new ApiError(400, "BAD_REQUEST", "El ajuste no puede dejar stock negativo.");
    }

    if (message.includes("producto no encontrado")) {
      return new ApiError(404, "NOT_FOUND", "Producto no encontrado.");
    }

    if (message.includes("ya tiene codigo de barras")) {
      return new ApiError(
        400,
        "BAD_REQUEST",
        "El producto ya tiene codigo de barras; no se puede modificar desde esta accion.",
      );
    }

    if (message.includes("ya existe un producto con este codigo de barras")) {
      return new ApiError(409, "CONFLICT", "Ya existe un producto con este codigo de barras.");
    }

    if (message.includes("no autorizado para agregar codigo de barras")) {
      return new ApiError(403, "FORBIDDEN", "No autorizado para agregar codigo de barras.");
    }

    if (message.includes("el codigo de barras es obligatorio")) {
      return new ApiError(400, "BAD_REQUEST", "El codigo de barras es obligatorio.");
    }

    if (message.includes("ajuste de stock no puede ser cero")) {
      return new ApiError(400, "BAD_REQUEST", "El ajuste no puede ser cero.");
    }

    // `raise exception` sin errcode: regla de negocio de una RPC, redactada para el usuario.
    if (error.code === "P0001" && error.message) {
      return new ApiError(400, "BAD_REQUEST", error.message);
    }
  }

  return new ApiError(500, "INTERNAL_ERROR", getSupabaseErrorMessage(error));
}

export function throwIfSupabaseError(error: unknown): void {
  if (error) {
    throw mapSupabaseError(error);
  }
}
