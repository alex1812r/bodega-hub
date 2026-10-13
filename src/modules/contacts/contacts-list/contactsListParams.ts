import { z } from "zod";

import { listParams, type UrlListStateOf } from "@/shared/hooks/useUrlListState";
import type { ContactType } from "@/shared/mocks/erp-data";

import type { ContactsFilters } from "../hooks/useContacts";

export const CONTACT_TYPE_FILTER_VALUES = [
  "cliente",
  "proveedor",
  "ambos",
] as const satisfies readonly ContactType[];

export const CONTACT_STATUS_FILTERS = ["all", "active", "inactive"] as const;

/**
 * Estado de `/contacts` en la URL (regla 15). Sin parámetros = todos los
 * contactos, página 1.
 *
 * | Parámetro | Valores                                   | Por defecto |
 * |-----------|-------------------------------------------|-------------|
 * | `search`  | texto (con debounce)                      | `""`        |
 * | `type`    | `all` · `cliente` · `proveedor` · `ambos` | `all`       |
 * | `status`  | `all` · `active` · `inactive`             | `all`       |
 * | `page`    | base 1                                    | `1`         |
 * | `limit`   | tamaño de página                          | `10`        |
 */
export const contactsListSchema = z.object({
  search: listParams.text(),
  type: listParams.oneOf(["all", ...CONTACT_TYPE_FILTER_VALUES], "all"),
  status: listParams.oneOf(CONTACT_STATUS_FILTERS, "all"),
  page: listParams.page(),
  limit: listParams.limit(),
});

export type ContactsListState = UrlListStateOf<typeof contactsListSchema.shape>;

export type ContactsListFilterState = Pick<ContactsListState, "search" | "status" | "type">;

/**
 * Estado de la URL → filtros de `GET /api/contacts`. `search` llega ya con su
 * debounce. Con `customersOnly` (rol que no ve proveedores) el tipo no viaja,
 * venga lo que venga en la URL.
 */
export function toContactsFilters(
  state: ContactsListFilterState,
  search: string,
  customersOnly: boolean,
): Pick<ContactsFilters, "isActive" | "search" | "type"> {
  return {
    isActive: state.status === "all" ? undefined : state.status === "active",
    search: search.trim() || undefined,
    type: customersOnly || state.type === "all" ? undefined : state.type,
  };
}
