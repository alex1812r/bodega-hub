import type { SupabaseClient } from "@supabase/supabase-js";

import { throwIfSupabaseError } from "@/lib/supabase/errors";
import { mapPermissionList } from "@/lib/supabase/mappers";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import type { Permission } from "@/shared/auth/permissions";

import {
  buildAdminCanSellState,
  matchesAdminSellGrants,
  withAdminSellGrants,
  type AdminCanSellState,
  type StoreAdminGrants,
} from "./adminCanSell";

type ProfilesClient = Pick<SupabaseClient, "from">;

type AdminGrantsRow = {
  full_name: string | null;
  granted_permissions: unknown;
  id: string;
  is_active: boolean;
};

/** Perfiles `admin` de la tienda (activos e inactivos) con sus permisos concedidos. */
export async function loadStoreAdminGrants(
  supabase: ProfilesClient,
  storeId: string,
): Promise<StoreAdminGrants[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, is_active, granted_permissions")
    .eq("store_id", storeId)
    .eq("role", "admin");

  throwIfSupabaseError(error);

  return ((data ?? []) as AdminGrantsRow[]).map((row) => ({
    grantedPermissions: mapPermissionList(row.granted_permissions),
    id: row.id,
    isActive: row.is_active,
    name: row.full_name ?? "Administrador",
  }));
}

export async function getAdminCanSell(storeId: string): Promise<AdminCanSellState> {
  const supabase = await createRouteSupabaseClient();

  return buildAdminCanSellState(await loadStoreAdminGrants(supabase, storeId));
}

/**
 * Concede o retira `sales.create` + `cash.operate` a TODOS los perfiles `admin`
 * de la tienda (también los inactivos, para que al reactivarlos no desentonen).
 * Idempotente: sin nada que cambiar no escribe. Los administradores con las
 * mismas excepciones se escriben en una sola sentencia (lo habitual: una); con
 * excepciones distintas hay una por grupo y no es atómico entre grupos: si una
 * falla se devuelve el error y repetir la operación termina el cambio.
 */
export async function setAdminCanSell(
  enabled: boolean,
  storeId: string,
): Promise<AdminCanSellState> {
  const supabase = await createRouteSupabaseClient();
  const admins = await loadStoreAdminGrants(supabase, storeId);
  const groups = new Map<string, { granted: Permission[]; ids: string[] }>();

  for (const admin of admins) {
    if (matchesAdminSellGrants(admin.grantedPermissions, enabled)) {
      continue;
    }

    const granted = withAdminSellGrants(admin.grantedPermissions, enabled);
    const key = JSON.stringify(granted);
    const group = groups.get(key) ?? { granted, ids: [] };

    group.ids.push(admin.id);
    groups.set(key, group);
  }

  for (const { granted, ids } of groups.values()) {
    const { error } = await supabase
      .from("profiles")
      .update({ granted_permissions: granted })
      .eq("store_id", storeId)
      .eq("role", "admin")
      .in("id", ids);

    throwIfSupabaseError(error);
  }

  return buildAdminCanSellState(
    admins.map((admin) => ({
      ...admin,
      grantedPermissions: withAdminSellGrants(admin.grantedPermissions, enabled),
    })),
  );
}
