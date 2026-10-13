import { z } from "zod";

import { listParams, type UrlListStateOf } from "@/shared/hooks/useUrlListState";

import type { InventoryFilters } from "../hooks/useInventory";
import { serializeStockStatusFilter } from "../utils/inventoryStockStatus";

/** Estados de stock en el orden en que se muestran y se envían al servidor. */
export const INVENTORY_STOCK_STATUS_FILTERS = ["ok", "low", "out"] as const;

/** Precio de referencia más alto que acepta el filtro de rango. */
export const INVENTORY_MAX_PRICE_FILTER = 999_999_999;

/** Un `product` más largo no es un id: se ignora (el servidor rechaza ids de más de 200). */
const INVENTORY_PRODUCT_PARAM_MAX_LENGTH = 64;

/** Extremo del rango de precio: `null` = sin límite. */
const priceParam = () =>
  z.number().min(0).max(INVENTORY_MAX_PRICE_FILTER).nullable().default(null);

/**
 * Estado de `/inventory` en la URL (regla 15). Sin parámetros = todos los
 * productos activos, página 1.
 *
 * | Parámetro  | Valores                                              | Por defecto |
 * |------------|------------------------------------------------------|-------------|
 * | `search`   | texto (con debounce)                                 | `""`        |
 * | `category` | id de categoría                                      | `""`        |
 * | `status`   | `ok` · `low` · `out`, repetible (`?status=low&status=out`) | ninguno = todos |
 * | `lowStock` | `true` = solo stock bajo o agotado                   | `false`     |
 * | `minPrice` | precio de venta mínimo (REF), con debounce           | ausente     |
 * | `maxPrice` | precio de venta máximo (REF), con debounce           | ausente     |
 * | `page`     | base 1                                               | `1`         |
 * | `limit`    | tamaño de página                                     | `10`        |
 * | `product`  | id del producto con los movimientos abiertos (uno)   | `""`        |
 *
 * `product` no es un filtro: cambiar filtros, página o tamaño lo conserva, y
 * "Limpiar filtros" también. Si el producto deja de estar en la página visible,
 * la lista lo muestra fijado encima de la tabla. Es el enlace profundo que usa
 * `/products` (`/inventory?product=<id>`).
 */
export const inventoryListSchema = z.object({
  search: listParams.text(),
  category: listParams.text(64),
  status: listParams.manyOf(INVENTORY_STOCK_STATUS_FILTERS),
  lowStock: listParams.boolean(),
  minPrice: priceParam(),
  maxPrice: priceParam(),
  page: listParams.page(),
  limit: listParams.limit(),
  product: listParams.text(INVENTORY_PRODUCT_PARAM_MAX_LENGTH),
});

export type InventoryListState = UrlListStateOf<typeof inventoryListSchema.shape>;

export type InventoryListFilterState = Pick<
  InventoryListState,
  "category" | "lowStock" | "maxPrice" | "minPrice" | "search" | "status"
>;

/** Campos que se escriben en la URL con debounce (los que se teclean). */
export const INVENTORY_LIST_TEXT_FIELDS = ["search", "minPrice", "maxPrice"] as const;

/** Los filtros en su valor por defecto; `page` y `limit` no son filtros. */
export const INVENTORY_LIST_NO_FILTERS: InventoryListFilterState = {
  category: "",
  lowStock: false,
  maxPrice: null,
  minPrice: null,
  search: "",
  status: [],
};

export function hasInventoryListFilters(state: InventoryListFilterState) {
  return (
    state.search.trim() !== "" ||
    state.category !== "" ||
    state.status.length > 0 ||
    state.lowStock ||
    state.minPrice !== null ||
    state.maxPrice !== null
  );
}

/** Estado de la URL → filtros de `GET /api/inventory`. Los campos tecleados llegan ya con su debounce. */
export function toInventoryFilters(
  state: Pick<InventoryListState, "category" | "lowStock" | "status">,
  typed: Pick<InventoryListState, "maxPrice" | "minPrice" | "search">,
): Pick<
  InventoryFilters,
  "categoryId" | "lowStock" | "maxPriceRef" | "minPriceRef" | "search" | "stockStatus"
> {
  return {
    categoryId: state.category || undefined,
    lowStock: state.lowStock ? true : undefined,
    maxPriceRef: typed.maxPrice ?? undefined,
    minPriceRef: typed.minPrice ?? undefined,
    search: typed.search.trim() || undefined,
    stockStatus: serializeStockStatusFilter(
      INVENTORY_STOCK_STATUS_FILTERS.filter((status) => state.status.includes(status)),
    ),
  };
}
