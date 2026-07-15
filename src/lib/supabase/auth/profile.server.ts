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
};

type ProfileRow = {
  denied_permissions: unknown;
  full_name: string | null;
  granted_permissions: unknown;
  id: string;
  is_active: boolean;
  role: string;
};

export async function getAuthProfileFromSession(): Promise<ServerAuthProfile | null> {
  const supabase = await createRouteSupabaseClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  // Sin cookie/sesión, getUser puede devolver AuthSessionMissingError (no es fallo de servidor).
  if (userError) {
    const message = userError.message?.toLowerCase() ?? "";
    const code = "code" in userError ? String(userError.code ?? "") : "";
    if (
      message.includes("auth session missing") ||
      code === "session_not_found" ||
      code === "AuthSessionMissingError"
    ) {
      return null;
    }
    throwIfSupabaseError(userError);
  }

  if (!user) {
    return null;
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, full_name, role, is_active, granted_permissions, denied_permissions")
    .eq("id", user.id)
    .maybeSingle<ProfileRow>();

  throwIfSupabaseError(profileError);

  if (!profile || !isUserRole(profile.role)) {
    return null;
  }

  return {
    deniedPermissions: mapPermissionList(profile.denied_permissions),
    email: user.email,
    grantedPermissions: mapPermissionList(profile.granted_permissions),
    id: profile.id,
    isActive: profile.is_active,
    name: profile.full_name ?? user.email ?? "Usuario",
    role: profile.role,
  };
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
  const supabase = await createRouteSupabaseClient();
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, full_name, role, is_active, granted_permissions, denied_permissions")
    .eq("id", userId)
    .maybeSingle<ProfileRow>();

  throwIfSupabaseError(profileError);

  if (!profile || !isUserRole(profile.role)) {
    return null;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return {
    deniedPermissions: mapPermissionList(profile.denied_permissions),
    email: user?.email,
    grantedPermissions: mapPermissionList(profile.granted_permissions),
    id: profile.id,
    isActive: profile.is_active,
    name: profile.full_name ?? user?.email ?? "Usuario",
    role: profile.role,
  };
}
