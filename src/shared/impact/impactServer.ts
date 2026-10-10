import { ApiError } from "@/lib/api/apiError";
import { jsonData } from "@/lib/api/jsonResponse";
import { INVALID_DATA_MESSAGE } from "@/lib/supabase/errors";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Lee y valida `?action=` de un endpoint de impact. Ausente, repetida con otro
 * valor o fuera de `allowed` → 400.
 */
export function parseImpactAction<TAction extends string>(
  request: Request,
  allowed: readonly TAction[],
): TAction {
  const values = new URL(request.url).searchParams.getAll("action");
  const action = values[0];

  if (values.length !== 1 || !allowed.includes(action as TAction)) {
    throw new ApiError(
      400,
      "BAD_REQUEST",
      `El parámetro action es obligatorio y debe ser uno de: ${allowed.join(", ")}.`,
    );
  }

  return action as TAction;
}

/** Id de documento con forma de uuid; si no, 400 como el resto de rutas contra Supabase. */
export function assertImpactDocumentId(id: string) {
  if (!UUID_PATTERN.test(id)) {
    throw new ApiError(400, "BAD_REQUEST", INVALID_DATA_MESSAGE);
  }
}

/** Respuesta `{ data }` de un impact: nunca se cachea, el efecto se recalcula en cada petición. */
export function impactJson<T>(data: T) {
  return jsonData(data, { headers: { "Cache-Control": "no-store" } });
}
