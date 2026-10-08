import { ApiError } from "@/lib/api/apiError";

import { stripControlChars } from "./productText";

/**
 * Largo máximo de un filtro exacto de listado (id, SKU, código de barras).
 * Holgado para un uuid o un id del mock (`cat-…`) y para cualquier SKU o código
 * de barras real.
 */
export const LIST_FILTER_MAX_LENGTH = 200;

/**
 * Rechaza con 400 los filtros exactos que no pueden casar con nada: más largos
 * que `LIST_FILTER_MAX_LENGTH` o con caracteres de control. Viajaban enteros a
 * PostgREST y la petición salía como 500 ("URI too long").
 */
export function assertListFilterParams(searchParams: URLSearchParams, names: readonly string[]) {
  for (const name of names) {
    const value = searchParams.get(name);

    if (value === null) {
      continue;
    }

    if (value.length > LIST_FILTER_MAX_LENGTH || stripControlChars(value) !== value) {
      throw new ApiError(400, "BAD_REQUEST", `El filtro "${name}" no es válido.`);
    }
  }
}
