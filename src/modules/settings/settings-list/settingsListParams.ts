import { z } from "zod";

import { listParams } from "@/shared/hooks/useUrlListState";

/** Parámetro de la URL con la pestaña activa de Configuración (sin parámetro = General). */
export const SETTINGS_TAB_PARAM = "tab";

export const SETTINGS_TABS = ["general", "impuestos", "precios", "usuarios", "tasas"] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number];

export const DEFAULT_SETTINGS_TAB: SettingsTab = "general";

/** Pestaña que corresponde a `?tab=`: una desconocida (o ninguna) es la inicial. */
export function resolveSettingsTab(value: string | null): SettingsTab {
  return SETTINGS_TABS.find((tab) => tab === value) ?? DEFAULT_SETTINGS_TAB;
}

/**
 * Estado de `/settings` en la URL (regla 15). La pantalla tiene dos listas
 * paginadas, así que cada una usa sus propios parámetros.
 *
 * | Parámetro    | Valores                                                    | Por defecto |
 * |--------------|------------------------------------------------------------|-------------|
 * | `tab`        | `general` · `impuestos` · `precios` · `usuarios` · `tasas` | `general`   |
 * | `usersPage`  | página (base 1) de «Usuarios del negocio»                  | `1`         |
 * | `usersLimit` | tamaño de página de «Usuarios del negocio»                 | `10`        |
 * | `ratesPage`  | página (base 1) de «Historial de tasas»                    | `1`         |
 * | `ratesLimit` | tamaño de página de «Historial de tasas»                   | `10`        |
 */
export const settingsUsersListSchema = z.object({
  usersPage: listParams.page(),
  usersLimit: listParams.limit(),
});

export const settingsRatesListSchema = z.object({
  ratesPage: listParams.page(),
  ratesLimit: listParams.limit(),
});
