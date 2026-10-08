import { z } from "zod";

import { listParams, type UrlListStateOf } from "@/shared/hooks/useUrlListState";

import type { ProductsFilters } from "../hooks/useProducts";
import { PRODUCT_MARGIN_FILTERS } from "../services/productMargin";
import { PRODUCT_SORT_COLUMNS, PRODUCT_SORT_CONFIG } from "../services/productSort";

export const PRODUCT_STATUS_FILTERS = ["all", "active", "inactive"] as const;
/** `all` = sin filtro; el resto son los valores de `?margin=` de `/api/products`. */
export const PRODUCT_MARGIN_FILTER_OPTIONS = ["all", ...PRODUCT_MARGIN_FILTERS] as const;

/**
 * Estado de `/products` en la URL (regla 15). Sin parámetros = lista completa
 * por nombre ascendente, página 1.
 *
 * | Parámetro  | Valores                                   | Por defecto |
 * |------------|-------------------------------------------|-------------|
 * | `search`   | texto (con debounce)                      | `""`        |
 * | `category` | id de categoría                           | `""`        |
 * | `status`   | `all` · `active` · `inactive`             | `all`       |
 * | `margin`   | `all` · `low` · `mid` · `high` · `none`   | `all`       |
 * | `sort`     | columnas de `PRODUCT_SORT_COLUMNS`        | `name`      |
 * | `dir`      | `asc` · `desc`                            | `asc`       |
 * | `page`     | base 1                                    | `1`         |
 * | `limit`    | tamaño de página                          | `10`        |
 *
 * RESERVADO: `review` es el parámetro de "Por revisar" (PRO-11). No lo uses
 * para otra cosa; cuando llegue, se declara aquí.
 */
export const productsListSchema = z.object({
  search: listParams.text(),
  category: listParams.text(64),
  status: listParams.oneOf(PRODUCT_STATUS_FILTERS, "all"),
  margin: listParams.oneOf(PRODUCT_MARGIN_FILTER_OPTIONS, "all"),
  sort: listParams.sort(PRODUCT_SORT_COLUMNS, PRODUCT_SORT_CONFIG.defaultSortBy),
  dir: listParams.dir(),
  page: listParams.page(),
  limit: listParams.limit(),
});

export type ProductsListState = UrlListStateOf<typeof productsListSchema.shape>;

export type ProductsListFilterState = Pick<
  ProductsListState,
  "category" | "margin" | "search" | "status"
>;

/** Estado de la URL → filtros de `GET /api/products`. `search` llega ya con su debounce. */
export function toProductsFilters(
  state: ProductsListState,
  search: string,
): Pick<ProductsFilters, "categoryId" | "isActive" | "margin" | "search" | "sortBy" | "sortOrder"> {
  return {
    categoryId: state.category || undefined,
    isActive: state.status === "all" ? undefined : state.status === "active",
    margin: state.margin === "all" ? undefined : state.margin,
    search: search.trim() || undefined,
    sortBy: state.sort,
    sortOrder: state.dir,
  };
}
