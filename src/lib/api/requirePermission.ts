import { ApiError, unauthenticatedError } from "@/lib/api/apiError";
import { getAuthProfileFromSession } from "@/lib/supabase/auth/profile.server";
import {
  getEffectivePermissions,
  hasEffectivePermission,
  isPlatformPermission,
  isSuperadminRole,
  isUserRole,
  type Permission,
  type UserRole,
} from "@/shared/auth/permissions";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";
import { mockUserProfiles, type UserProfileMock } from "@/shared/mocks/erp-data";

import {
  SUPERADMIN_ERP_FORBIDDEN_MESSAGE,
  requireStoreId,
  toStoreAuthContext,
  type StoreAuthContext,
} from "./storeAccess";

export type ApiAuthContext = {
  isSuperadmin: boolean;
  permissions: readonly Permission[];
  role: UserRole;
  storeId: string | null;
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
  const storeHeader = request.headers.get("x-demo-store-id");
  const demoStoreId = role === "superadmin" ? null : (storeHeader ?? DEFAULT_STORE_ID);
  // El perfil demo por rol hereda las excepciones del perfil mock con su mismo id
  // y tienda (hoy solo `user-admin`): asi «El administrador puede vender» surte efecto.
  const stored = mockUserProfiles.find(
    (profile) => profile.id === `user-${role}` && (profile.storeId ?? null) === demoStoreId,
  );

  return {
    deniedPermissions: stored?.deniedPermissions,
    email: `${role}@example.com`,
    grantedPermissions: stored?.grantedPermissions,
    id: `user-${role}`,
    isActive: true,
    name: `Usuario ${role}`,
    role,
    storeId: demoStoreId,
  };
}

function toPermissionProfile(
  profile: UserProfileMock | Awaited<ReturnType<typeof getAuthProfileFromSession>>,
) {
  if (!profile) {
    return null;
  }

  return {
    deniedPermissions: profile.deniedPermissions,
    grantedPermissions: profile.grantedPermissions,
    role: profile.role,
    isActive: profile.isActive,
    storeId: profile.storeId ?? null,
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
      storeId: sessionProfile.storeId,
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
    throw unauthenticatedError();
  }

  if (!profile.isActive || !hasEffectivePermission(profile, permission)) {
    throw new ApiError(403, "FORBIDDEN", "No tienes permiso para realizar esta acción.");
  }

  const isSuperadmin = isSuperadminRole(profile.role);

  if (isSuperadmin && !isPlatformPermission(permission)) {
    throw new ApiError(403, "FORBIDDEN", SUPERADMIN_ERP_FORBIDDEN_MESSAGE);
  }

  if (!isSuperadmin && isPlatformPermission(permission)) {
    throw new ApiError(403, "FORBIDDEN", "No tienes permiso para realizar esta acción.");
  }

  return {
    isSuperadmin,
    permissions: getEffectivePermissions(profile),
    role: profile.role,
    storeId: profile.storeId ?? null,
    userId: profile.userId,
  };
}

/** Permiso de modulo ERP + storeId obligatorio (bloquea superadmin). */
export async function requireStorePermission(
  request: Request,
  permission: Permission,
): Promise<StoreAuthContext> {
  const auth = await requirePermission(request, permission);
  return toStoreAuthContext(auth);
}

/** Al menos uno de los permisos ERP + storeId obligatorio. */
export async function requireStoreAnyPermission(
  request: Request,
  permissions: readonly Permission[],
): Promise<StoreAuthContext> {
  if (permissions.length === 0) {
    throw new ApiError(500, "INTERNAL_ERROR", "Se requiere al menos un permiso.");
  }

  const profile = await resolveAuthProfile(request);

  if (!profile) {
    throw unauthenticatedError();
  }

  const allowed = permissions.some((permission) =>
    hasEffectivePermission(profile, permission),
  );

  if (!profile.isActive || !allowed) {
    throw new ApiError(403, "FORBIDDEN", "No tienes permiso para realizar esta acción.");
  }

  const isSuperadmin = isSuperadminRole(profile.role);

  if (isSuperadmin) {
    throw new ApiError(403, "FORBIDDEN", SUPERADMIN_ERP_FORBIDDEN_MESSAGE);
  }

  return toStoreAuthContext({
    isSuperadmin,
    permissions: getEffectivePermissions(profile),
    role: profile.role,
    storeId: profile.storeId ?? null,
    userId: profile.userId,
  });
}

export { requireStoreId, toStoreAuthContext };
export type { StoreAuthContext };
