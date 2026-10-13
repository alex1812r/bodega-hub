import { ApiError } from "@/lib/api/apiError";

const INVALID_JSON_BODY_MESSAGE = "El cuerpo de la solicitud no es un JSON válido.";

/**
 * Cuerpo JSON de la petición. Un cuerpo vacío o malformado es culpa del cliente
 * (400), no un 500. Se mira `error.name` y no `instanceof SyntaxError`: el error
 * de `request.json()` puede venir de otro realm.
 */
export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch (error) {
    if ((error as { name?: unknown } | null)?.name === "SyntaxError") {
      throw new ApiError(400, "BAD_REQUEST", INVALID_JSON_BODY_MESSAGE);
    }

    throw error;
  }
}

/**
 * Cuerpo JSON opcional: sin cuerpo (o solo espacios) vale `{}`. Uno que no es
 * JSON sigue siendo un 400.
 */
export async function readOptionalJsonBody(request: Request): Promise<unknown> {
  const text = await request.text();

  if (text.trim() === "") {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiError(400, "BAD_REQUEST", INVALID_JSON_BODY_MESSAGE);
  }
}
