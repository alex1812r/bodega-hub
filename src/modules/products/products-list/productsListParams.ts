import { z } from "zod";

import { listParams, type UrlListStateOf } from "@/shared/hooks/useUrlListState";

import type { ProductsFilters } from "../hooks/useProducts";
import { PRODUCT_MARGIN_FILTERS } from "../services/productMargin";
import {
  PRODUCT_SORT_COLUMNS,
  PRODUCT_SORT_CONFIG,
  type ProductSortBy,
} from "../services/productSort";

export const PRODUCT_STATUS_FILTERS = ["all", "active", "inactive"] as const;
/** `all` = sin filtro; el resto son los valores de `?margin=` de `/api/products`. */
export const PRODUCT_MARGIN_FILTER_OPTIONS = ["all", ...PRODUCT_MARGIN_FILTERS] as const;
/** `""` = la lista de siempre; `"1"` = solo productos en "Por revisar" (`?review=1`). */
export const PRODUCT_REVIEW_FILTERS = ["", "1"] as const;

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
 * | `review`   | `1` = solo "Por revisar" (PRO-11)         | ausente     |
 */
export const productsListSchema = z.object({
  search: listParams.text(),
  category: listParams.text(64),
  status: listParams.oneOf(PRODUCT_STATUS_FILTERS, "all"),
  margin: listParams.oneOf(PRODUCT_MARGIN_FILTER_OPTIONS, "all"),
  review: listParams.oneOf(PRODUCT_REVIEW_FILTERS, ""),
  sort: listParams.sort(PRODUCT_SORT_COLUMNS, PRODUCT_SORT_CONFIG.defaultSortBy),
  dir: listParams.dir(),
  page: listParams.page(),
  limit: listParams.limit(),
});

export type ProductsListState = UrlListStateOf<typeof productsListSchema.shape>;

export type ProductsListFilterState = Pick<
  ProductsListState,
  "category" | "dir" | "margin" | "review" | "search" | "sort" | "status"
>;

type ProductSortChoice = Pick<ProductsListState, "dir" | "sort"> & { label: string; value: string };

/** Etiquetas [ascendente, descendente] de cada columna, en el orden del selector. */
const PRODUCT_SORT_LABELS: Record<ProductSortBy, readonly [string, string]> = {
  name: ["Nombre: A a Z", "Nombre: Z a A"],
  marginPct: ["Ganancia: menor a mayor", "Ganancia: mayor a menor"],
  salePriceRef: ["PVP: menor a mayor", "PVP: mayor a menor"],
  currentCostRef: ["Costo: menor a mayor", "Costo: mayor a menor"],
  currentStock: ["Stock: menor a mayor", "Stock: mayor a menor"],
  category: ["Categoría: A a Z", "Categoría: Z a A"],
  sku: ["SKU: A a Z", "SKU: Z a A"],
  status: ["Estado: inactivos primero", "Estado: activos primero"],
};

/** `sort` + `dir` como un solo valor de `<select>`. */
export function productSortChoiceValue({ dir, sort }: Pick<ProductsListState, "dir" | "sort">) {
  return `${sort}:${dir}`;
}

/**
 * Opciones del selector "Orden" (tarjetas y tabla sin columna "Ganancia"). Cubre
 * todas las columnas ordenables: el orden que llega por la URL siempre tiene opción.
 */
export const PRODUCT_SORT_CHOICES: readonly ProductSortChoice[] = (
  Object.keys(PRODUCT_SORT_LABELS) as ProductSortBy[]
).flatMap((sort) =>
  (["asc", "desc"] as const).map((dir, index) => ({
    dir,
    label: PRODUCT_SORT_LABELS[sort][index],
    sort,
    value: productSortChoiceValue({ dir, sort }),
  })),
);

/** Estado de la URL → filtros de `GET /api/products`. `search` llega ya con su debounce. */
export function toProductsFilters(
  state: ProductsListState,
  search: string,
): Pick<
  ProductsFilters,
  "categoryId" | "isActive" | "margin" | "review" | "search" | "sortBy" | "sortOrder"
> {
  return {
    categoryId: state.category || undefined,
    isActive: state.status === "all" ? undefined : state.status === "active",
    margin: state.margin === "all" ? undefined : state.margin,
    review: state.review === "1" ? "1" : undefined,
    search: search.trim() || undefined,
    sortBy: state.sort,
    sortOrder: state.dir,
  };
}
