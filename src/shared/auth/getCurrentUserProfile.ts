import { type User } from "@supabase/supabase-js";

import { createBrowserSupabaseClient } from "@/lib/supabase/browser-client";
import { isUserRole, type UserRole } from "@/shared/auth/permissions";

export type CurrentUserProfile = {
  email?: string;
  fullName: string;
  id: string;
  role: UserRole;
};

type ProfileRow = {
  full_name: string | null;
  id: string;
  is_active: boolean | null;
  role: string | null;
};

function getDisplayName(profile: ProfileRow, user: User) {
  return profile.full_name ?? user.email ?? "Usuario";
}

export async function getCurrentUserProfile(): Promise<CurrentUserProfile | null> {
  const supabase = createBrowserSupabaseClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError) {
    throw userError;
  }

  if (!userData.user) {
    return null;
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, full_name, role, is_active")
    .eq("id", userData.user.id)
    .maybeSingle<ProfileRow>();

  if (profileError) {
    throw profileError;
  }

  if (!profile) {
    throw new Error("Tu usuario no tiene un perfil asignado.");
  }

  if (profile.is_active === false) {
    throw new Error("Tu usuario esta inactivo.");
  }

  if (!isUserRole(profile.role)) {
    throw new Error("Tu usuario no tiene un rol valido.");
  }

  return {
    email: userData.user.email,
    fullName: getDisplayName(profile, userData.user),
    id: userData.user.id,
    role: profile.role,
  };
}
