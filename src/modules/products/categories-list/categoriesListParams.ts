import { z } from "zod";

import { listParams, type UrlListStateOf } from "@/shared/hooks/useUrlListState";

import type { CategoriesFilters } from "../hooks/useProducts";

export const CATEGORY_STATUS_FILTERS = ["all", "active", "inactive"] as const;

/**
 * Estado de `/products/categories` en la URL (regla 15). Sin parámetros = todas
 * las categorías (activas e inactivas), página 1.
 *
 * | Parámetro | Valores                       | Por defecto |
 * |-----------|-------------------------------|-------------|
 * | `search`  | texto (con debounce)          | `""`        |
 * | `status`  | `all` · `active` · `inactive` | `all`       |
 * | `page`    | base 1                        | `1`         |
 * | `limit`   | tamaño de página              | `10`        |
 */
export const categoriesListSchema = z.object({
  search: listParams.text(),
  status: listParams.oneOf(CATEGORY_STATUS_FILTERS, "all"),
  page: listParams.page(),
  limit: listParams.limit(),
});

export type CategoriesListState = UrlListStateOf<typeof categoriesListSchema.shape>;

export type CategoriesListFilterState = Pick<CategoriesListState, "search" | "status">;

/**
 * Estado de la URL → filtros de `GET /api/categories`. `search` llega ya con su
 * debounce. "Todos" viaja como `isActive=all`: sin él la API solo da las activas.
 */
export function toCategoriesFilters(
  state: CategoriesListFilterState,
  search: string,
): Pick<CategoriesFilters, "isActive" | "search"> {
  return {
    isActive: state.status === "all" ? "all" : state.status === "active",
    search: search.trim() || undefined,
  };
}
