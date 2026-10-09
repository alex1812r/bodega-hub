import { z } from "zod";

import { listParams, type UrlListStateOf } from "@/shared/hooks/useUrlListState";
import type { PurchaseStatus } from "@/shared/mocks/erp-data";

import type { PurchasesFilters } from "../../hooks/usePurchases";

export const PURCHASE_STATUS_FILTER_VALUES = [
  "pedido",
  "recibido",
  "cancelado",
  "devuelto",
] as const satisfies readonly PurchaseStatus[];

/**
 * Estado de `/purchases` en la URL (regla 15). Sin parámetros = todas las
 * compras, la más reciente primero, página 1.
 *
 * | Parámetro        | Valores                                              | Por defecto |
 * |------------------|------------------------------------------------------|-------------|
 * | `search`         | texto (con debounce)                                 | `""`        |
 * | `status`         | `all` · `pedido` · `recibido` · `cancelado` · `devuelto` | `all`   |
 * | `pendingBalance` | `1` = solo compras con saldo pendiente               | ausente     |
 * | `from` / `to`    | `YYYY-MM-DD`, día operativo Caracas                  | `""`        |
 * | `page`           | base 1                                               | `1`         |
 * | `limit`          | tamaño de página                                     | `10`        |
 */
export const purchasesListSchema = z.object({
  search: listParams.text(),
  status: listParams.oneOf(["all", ...PURCHASE_STATUS_FILTER_VALUES], "all"),
  pendingBalance: listParams.oneOf(["", "1"], ""),
  from: listParams.date(),
  to: listParams.date(),
  page: listParams.page(),
  limit: listParams.limit(),
});

export type PurchasesListState = UrlListStateOf<typeof purchasesListSchema.shape>;

export type PurchasesListFilterState = Pick<
  PurchasesListState,
  "from" | "pendingBalance" | "search" | "status" | "to"
>;

/** Patch que deja la lista sin filtros (no toca el tamaño de página). */
export const CLEARED_PURCHASES_FILTERS = {
  from: "",
  pendingBalance: "",
  search: "",
  status: "all",
  to: "",
} as const satisfies PurchasesListFilterState;

/** Estado de la URL → filtros de `GET /api/purchases`. `search` llega ya con su debounce. */
export function toPurchasesFilters(
  state: PurchasesListFilterState,
  search: string,
): Pick<PurchasesFilters, "from" | "pendingBalance" | "search" | "status" | "to"> {
  return {
    from: state.from || undefined,
    pendingBalance: state.pendingBalance === "1" ? "1" : undefined,
    search: search.trim() || undefined,
    status: state.status === "all" ? undefined : state.status,
    to: state.to || undefined,
  };
}

/** `true` si hay algún filtro que "Limpiar filtros" pueda quitar. */
export function hasActivePurchasesFilters(state: PurchasesListFilterState) {
  return Boolean(
    state.search.trim() ||
      state.from ||
      state.to ||
      state.pendingBalance === "1" ||
      state.status !== "all",
  );
}
