import type { Permission, UserRole } from "@bodega/core/permissions";

/** Forma de `GET /api/auth/me` en el BFF. */
export type AuthProfile = {
  deniedPermissions: Permission[];
  grantedPermissions: Permission[];
  permissionCatalog: readonly Permission[];
  permissions: Permission[];
  role: UserRole;
  roles: readonly UserRole[];
  storeId: string | null;
  user: {
    email?: string;
    id: string;
    isActive: boolean;
    name: string;
  };
};
