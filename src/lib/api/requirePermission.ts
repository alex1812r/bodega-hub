import { ApiError } from "@/lib/api/apiError";
import { getAuthProfileFromSession } from "@/lib/supabase/auth/profile.server";
import {
  getEffectivePermissions,
  hasEffectivePermission,
  isUserRole,
  type Permission,
  type UserRole,
} from "@/shared/auth/permissions";
import { mockUserProfiles, type UserProfileMock } from "@/shared/mocks/erp-data";

export type ApiAuthContext = {
  permissions: readonly Permission[];
  role: UserRole;
  userId?: string;
};

export function isDemoAuthEnabled() {
  return process.env.ALLOW_DEMO_AUTH === "true";
}

export function getDemoRole(request: Request): UserRole {
  const role = request.headers.get("x-demo-role");

  return isUserRole(role) ? role : "admin";
}

export function getDemoUserProfile(request: Request): UserProfileMock {
  const userId = request.headers.get("x-demo-user-id");
  const user = userId
    ? mockUserProfiles.find((profile) => profile.id === userId)
    : undefined;

  if (user) {
    return user;
  }

  const role = getDemoRole(request);

  return {
    email: `${role}@example.com`,
    id: `user-${role}`,
    isActive: true,
    name: `Usuario ${role}`,
    role,
  };
}

function toPermissionProfile(profile: UserProfileMock | Awaited<ReturnType<typeof getAuthProfileFromSession>>) {
  if (!profile) {
    return null;
  }

  return {
    deniedPermissions: profile.deniedPermissions,
    grantedPermissions: profile.grantedPermissions,
    role: profile.role,
    isActive: profile.isActive,
    userId: profile.id,
  };
}

/** Sesion real primero; headers demo solo sin sesion (evita que localStorage admin pise al vendedor logueado). */
export async function resolveUserProfile(request: Request): Promise<UserProfileMock | null> {
  const sessionProfile = await getAuthProfileFromSession();

  if (sessionProfile) {
    return {
      deniedPermissions: sessionProfile.deniedPermissions,
      email: sessionProfile.email ?? "",
      grantedPermissions: sessionProfile.grantedPermissions,
      id: sessionProfile.id,
      isActive: sessionProfile.isActive,
      name: sessionProfile.name,
      role: sessionProfile.role,
    };
  }

  if (isDemoAuthEnabled()) {
    return getDemoUserProfile(request);
  }

  return null;
}

export async function resolveAuthProfile(request: Request) {
  return toPermissionProfile(await resolveUserProfile(request));
}

export async function requirePermission(
  request: Request,
  permission: Permission,
): Promise<ApiAuthContext> {
  const profile = await resolveAuthProfile(request);

  if (!profile) {
    throw new ApiError(401, "UNAUTHORIZED", "Debes iniciar sesion para continuar.");
  }

  if (!profile.isActive || !hasEffectivePermission(profile, permission)) {
    throw new ApiError(403, "FORBIDDEN", "No tienes permiso para realizar esta accion.");
  }

  return {
    permissions: getEffectivePermissions(profile),
    role: profile.role,
    userId: profile.userId,
  };
}
