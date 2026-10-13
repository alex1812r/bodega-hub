import { ApiError } from "@/lib/api/apiError";
import { INVALID_DATA_MESSAGE } from "@/lib/supabase/errors";
import { isExactFilterValue } from "@/modules/products/services/listFilterParams";

/**
 * Ids de producto de un ajuste o de una conversión: ni desmedidos ni con
 * caracteres de control (el criterio de los filtros exactos de los listados).
 * Un uuid válido seguido de NUL pasaba la comprobación de tienda y llegaba a la
 * RPC, que respondía 500. No exige formato uuid: los ids del mock no lo son.
 * Igual en BFF real y mock, con el mensaje que ya da la base a un id inválido.
 */
export function assertStockEntityIds(ids: readonly (string | undefined)[]) {
  if (ids.some((id) => id !== undefined && !isExactFilterValue(id))) {
    throw new ApiError(400, "BAD_REQUEST", INVALID_DATA_MESSAGE);
  }
}
