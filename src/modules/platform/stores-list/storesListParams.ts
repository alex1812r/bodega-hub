import { z } from "zod";

import { listParams, type UrlListStateOf } from "@/shared/hooks/useUrlListState";

import type { StoresFilters } from "../hooks/useStores";
import type { StoreStatus } from "../types/stores";

export const STORE_STATUS_FILTER_VALUES = [
  "active",
  "paused",
] as const satisfies readonly StoreStatus[];

/**
 * Estado de `/platform/stores` en la URL (regla 15). Sin parámetros = todas las
 * tiendas, página 1. La pantalla no ordena: no hay `sort`.
 *
 * | Parámetro | Valores                       | Por defecto |
 * |-----------|-------------------------------|-------------|
 * | `search`  | texto (con debounce)          | `""`        |
 * | `status`  | `all` · `active` · `paused`   | `all`       |
 * | `page`    | base 1                        | `1`         |
 * | `limit`   | tamaño de página              | `10`        |
 */
export const storesListSchema = z.object({
  search: listParams.text(),
  status: listParams.oneOf(["all", ...STORE_STATUS_FILTER_VALUES], "all"),
  page: listParams.page(),
  limit: listParams.limit(),
});

export type StoresListState = UrlListStateOf<typeof storesListSchema.shape>;

/** Estado de la URL → filtros de `GET /api/platform/stores`. `search` llega ya con su debounce. */
export function toStoresFilters(
  state: Pick<StoresListState, "status">,
  search: string,
): Pick<StoresFilters, "search" | "status"> {
  return {
    search: search.trim() || undefined,
    status: state.status === "all" ? undefined : state.status,
  };
}
