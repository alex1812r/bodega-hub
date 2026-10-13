import { z } from "zod";

import { listParams, type UrlListStateOf } from "@/shared/hooks/useUrlListState";

import type { PlatformUsersFilters } from "../hooks/useUsers";

/** Roles que ofrece el filtro de la pantalla (el superadmin no pertenece a una tienda). */
export const PLATFORM_USER_ROLE_FILTER_VALUES = [
  "admin",
  "vendedor",
  "almacen",
  "contador",
] as const;

/** Un id de tienda es un UUID; cualquier otra cosa en la URL se ignora y no viaja al servidor. */
const STORE_ID_PARAM = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Estado de `/platform/users` en la URL (regla 15). Sin parámetros = todos los
 * usuarios, página 1. La pantalla no ordena: no hay `sort`.
 *
 * | Parámetro | Valores                                               | Por defecto |
 * |-----------|-------------------------------------------------------|-------------|
 * | `search`  | texto (con debounce)                                  | `""`        |
 * | `store`   | id (UUID) de la tienda; vacío = todas                 | `""`        |
 * | `role`    | `all` · `admin` · `vendedor` · `almacen` · `contador` | `all`       |
 * | `page`    | base 1                                                | `1`         |
 * | `limit`   | tamaño de página                                      | `10`        |
 */
export const platformUsersListSchema = z.object({
  search: listParams.text(),
  store: z
    .string()
    .refine((value) => value === "" || STORE_ID_PARAM.test(value))
    .default(""),
  role: listParams.oneOf(["all", ...PLATFORM_USER_ROLE_FILTER_VALUES], "all"),
  page: listParams.page(),
  limit: listParams.limit(),
});

export type PlatformUsersListState = UrlListStateOf<typeof platformUsersListSchema.shape>;

/** Estado de la URL → filtros de `GET /api/platform/users`. `search` llega ya con su debounce. */
export function toPlatformUsersFilters(
  state: Pick<PlatformUsersListState, "role" | "store">,
  search: string,
): Pick<PlatformUsersFilters, "role" | "search" | "storeId"> {
  return {
    role: state.role === "all" ? undefined : state.role,
    search: search.trim() || undefined,
    storeId: state.store || undefined,
  };
}
