import { ApiError } from "@/lib/api/apiError";

/**
 * Cuerpo JSON de la peticion. Un cuerpo vacio o malformado es culpa del cliente
 * (400), no un 500. Se mira `error.name` y no `instanceof SyntaxError`: el error
 * de `request.json()` puede venir de otro realm.
 */
export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch (error) {
    if ((error as { name?: unknown } | null)?.name === "SyntaxError") {
      throw new ApiError(400, "BAD_REQUEST", "El cuerpo de la solicitud no es un JSON valido.");
    }

    throw error;
  }
}
