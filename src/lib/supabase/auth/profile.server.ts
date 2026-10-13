import { isSessionAuthError } from "@/lib/supabase/auth/sessionErrors";
import { getBearerToken } from "@/lib/supabase/bearer";
import { mapPermissionList } from "@/lib/supabase/mappers";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { throwIfSupabaseError } from "@/lib/supabase/errors";
import {
  getDefaultHomePathForRole,
} from "@/shared/auth/defaultHomePath";
import {
  isUserRole,
  type Permission,
  type UserRole,
} from "@/shared/auth/permissions";
import type { SupabaseClient } from "@supabase/supabase-js";

export type ServerAuthProfile = {
  deniedPermissions: Permission[];
  email?: string;
  grantedPermissions: Permission[];
  id: string;
  isActive: boolean;
  name: string;
  role: UserRole;
  storeId: string | null;
};

type ProfileRow = {
  denied_permissions: unknown;
  full_name: string | null;
  granted_permissions: unknown;
  id: string;
  is_active: boolean;
  role: string;
  store_id: string | null;
};

function mapProfileRow(
  profile: ProfileRow,
  email?: string | null,
): ServerAuthProfile | null {
  if (!isUserRole(profile.role)) {
    return null;
  }

  return {
    deniedPermissions: mapPermissionList(profile.denied_permissions),
    email: email ?? undefined,
    grantedPermissions: mapPermissionList(profile.granted_permissions),
    id: profile.id,
    isActive: profile.is_active,
    name: profile.full_name ?? email ?? "Usuario",
    role: profile.role,
    storeId: profile.store_id,
  };
}

/**
 * Perfil de la sesion de la peticion (cookies o Bearer), o `null` si no hay
 * sesion valida: sin credencial, access token caducado con refresh token invalido
 * o revocado, JWT manipulado (`isSessionAuthError`). `requirePermission` convierte
 * ese `null` en 401. Solo un fallo real de Supabase (red, 5xx) escala a 5xx.
 */
export async function getAuthProfileFromSession(): Promise<ServerAuthProfile | null> {
  // El token del header manda cuando existe: `getUser()` sin argumento lee la
  // sesion de cookies y con Bearer devolveria "Auth session missing" -> 401.
  const bearerToken = await getBearerToken();
  const supabase = await createRouteSupabaseClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(bearerToken ?? undefined);

  if (userError) {
    if (isSessionAuthError(userError)) {
      return null;
    }
    throwIfSupabaseError(userError);
  }

  if (!user) {
    return null;
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, full_name, role, is_active, granted_permissions, denied_permissions, store_id")
    .eq("id", user.id)
    .maybeSingle<ProfileRow>();

  throwIfSupabaseError(profileError);

  if (!profile) {
    return null;
  }

  return mapProfileRow(profile, user.email);
}

export async function getDefaultHomePathForAuthUserId(
  supabase: SupabaseClient,
  userId: string,
): Promise<string> {
  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle<{ role: string }>();

  if (error) {
    return "/dashboard";
  }

  if (data?.role && isUserRole(data.role)) {
    return getDefaultHomePathForRole(data.role);
  }

  return "/dashboard";
}

export async function getProfileByUserId(userId: string): Promise<ServerAuthProfile | null> {
  const bearerToken = await getBearerToken();
  const supabase = await createRouteSupabaseClient();
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, full_name, role, is_active, granted_permissions, denied_permissions, store_id")
    .eq("id", userId)
    .maybeSingle<ProfileRow>();

  throwIfSupabaseError(profileError);

  if (!profile) {
    return null;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser(bearerToken ?? undefined);

  return mapProfileRow(profile, user?.email);
}
