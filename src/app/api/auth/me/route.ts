import { ApiError, toErrorResponse } from "@/lib/api/apiError";
import { jsonData } from "@/lib/api/jsonResponse";
import { resolveUserProfile } from "@/lib/api/requirePermission";
import {
  getEffectivePermissions,
  permissions,
  userRoles,
} from "@/shared/auth/permissions";

export async function GET(request: Request) {
  try {
    const profile = await resolveUserProfile(request);

    if (!profile) {
      throw new ApiError(401, "UNAUTHORIZED", "Debes iniciar sesion para continuar.");
    }

    return jsonData({
      deniedPermissions: profile.deniedPermissions ?? [],
      grantedPermissions: profile.grantedPermissions ?? [],
      permissionCatalog: permissions,
      permissions: getEffectivePermissions(profile),
      role: profile.role,
      roles: userRoles,
      user: {
        email: profile.email,
        id: profile.id,
        isActive: profile.isActive,
        name: profile.name,
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
