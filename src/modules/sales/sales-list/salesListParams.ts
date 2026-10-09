import { z } from "zod";

import { listParams, type UrlListStateOf } from "@/shared/hooks/useUrlListState";
import type { SaleStatus } from "@/shared/mocks/erp-data";

import type { SalesFilters } from "../hooks/useSales";

export const SALE_STATUS_FILTER_VALUES = [
  "borrador",
  "pendiente_pago",
  "pagada",
  "cancelada",
  "devuelta",
] as const satisfies readonly SaleStatus[];

/**
 * Estado de `/sales` en la URL (regla 15). Sin parámetros = todas las ventas,
 * página 1.
 *
 * | Parámetro     | Valores                                                                  | Por defecto |
 * |---------------|--------------------------------------------------------------------------|-------------|
 * | `search`      | texto (con debounce)                                                     | `""`        |
 * | `status`      | `all` · `borrador` · `pendiente_pago` · `pagada` · `cancelada` · `devuelta` | `all`    |
 * | `from` / `to` | `YYYY-MM-DD`, día operativo Caracas                                      | `""`        |
 * | `page`        | base 1                                                                   | `1`         |
 * | `limit`       | tamaño de página                                                         | `10`        |
 */
export const salesListSchema = z.object({
  search: listParams.text(),
  status: listParams.oneOf(["all", ...SALE_STATUS_FILTER_VALUES], "all"),
  from: listParams.date(),
  to: listParams.date(),
  page: listParams.page(),
  limit: listParams.limit(),
});

export type SalesListState = UrlListStateOf<typeof salesListSchema.shape>;

export type SalesListFilterState = Pick<SalesListState, "from" | "search" | "status" | "to">;

/** Estado de la URL → filtros de `GET /api/sales`. `search` llega ya con su debounce. */
export function toSalesFilters(
  state: SalesListFilterState,
  search: string,
): Pick<SalesFilters, "from" | "search" | "status" | "to"> {
  return {
    from: state.from || undefined,
    search: search.trim() || undefined,
    status: state.status === "all" ? undefined : state.status,
    to: state.to || undefined,
  };
}
