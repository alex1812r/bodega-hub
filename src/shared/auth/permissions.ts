export const userRoles = ["superadmin", "admin", "vendedor", "almacen", "contador"] as const;

export type UserRole = (typeof userRoles)[number];

/** Roles que un admin de tienda puede asignar al crear/editar usuarios. */
export const storeUserRoles = ["admin", "vendedor", "almacen", "contador"] as const;

export type StoreUserRole = (typeof storeUserRoles)[number];

export const roleLabels: Record<UserRole, string> = {
  superadmin: "Superadmin",
  admin: "Administrador",
  vendedor: "Vendedor",
  almacen: "Almacen",
  contador: "Contador",
};

export function isStoreUserRole(value: unknown): value is StoreUserRole {
  return typeof value === "string" && storeUserRoles.includes(value as StoreUserRole);
}

export const permissions = [
  "dashboard.view",
  "sales.view",
  "sales.create",
  "purchases.view",
  "purchases.create",
  "inventory.view",
  "inventory.manage",
  "products.view",
  "products.manage",
  "contacts.view",
  "contacts.manage",
  "payments.view",
  "payments.manage",
  "cash.view",
  "cash.operate",
  "cash.manage",
  "vault.view",
  "vault.manage",
  "reports.view",
  "settings.view",
  "users.manage",
  "platform.stores.view",
  "platform.stores.manage",
  "platform.users.view",
  "platform.users.manage",
  "platform.reports.view",
  "platform.dashboard.view",
] as const;

export type Permission = (typeof permissions)[number];

export type PermissionProfile = {
  deniedPermissions?: readonly Permission[];
  grantedPermissions?: readonly Permission[];
  role: UserRole;
};

const storePermissions = permissions.filter(
  (permission) => !permission.startsWith("platform."),
) as Permission[];

const platformPermissions = permissions.filter((permission) =>
  permission.startsWith("platform."),
) as Permission[];

/**
 * Admin opera el comercio pero no vende en POS ni opera "Mi caja".
 * Los permisos siguen existiendo para reactivarlos por rol/overrides más adelante.
 */
const adminBlockedPermissions = new Set<Permission>(["sales.create", "cash.operate"]);

const adminStorePermissions = storePermissions.filter(
  (permission) => !adminBlockedPermissions.has(permission),
);

export const rolePermissions: Record<UserRole, readonly Permission[]> = {
  superadmin: platformPermissions,
  admin: adminStorePermissions,
  vendedor: [
    "dashboard.view",
    "sales.view",
    "sales.create",
    "products.view",
    "contacts.view",
    "payments.view",
    "cash.view",
    "cash.operate",
  ],
  almacen: [
    "dashboard.view",
    "purchases.view",
    "purchases.create",
    "inventory.view",
    "inventory.manage",
    "products.view",
    "products.manage",
  ],
  contador: [
    "dashboard.view",
    "sales.view",
    "purchases.view",
    "contacts.view",
    "payments.view",
    "payments.manage",
    "cash.view",
    "vault.view",
    "reports.view",
  ],
};

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && userRoles.includes(value as UserRole);
}

export function isPermission(value: unknown): value is Permission {
  return typeof value === "string" && permissions.includes(value as Permission);
}

export function getRolePermissions(role: UserRole) {
  return rolePermissions[role];
}

export function getEffectivePermissions(profile: PermissionProfile) {
  if (profile.role === "superadmin") {
    return [...rolePermissions.superadmin];
  }

  if (profile.role === "admin") {
    // Admin ignores per-user overrides; base role already excludes sales.create / cash.operate.
    return [...rolePermissions.admin];
  }

  const effectivePermissions = new Set<Permission>([
    ...getRolePermissions(profile.role),
    ...(profile.grantedPermissions ?? []),
  ]);

  for (const permission of profile.deniedPermissions ?? []) {
    effectivePermissions.delete(permission);
  }

  return permissions.filter((permission) => effectivePermissions.has(permission));
}

export function hasEffectivePermission(profile: PermissionProfile, permission: Permission) {
  return getEffectivePermissions(profile).includes(permission);
}

export function hasPermission(role: UserRole, permission: Permission) {
  return getRolePermissions(role).includes(permission);
}

export function isSuperadminRole(role: UserRole) {
  return role === "superadmin";
}

export function isPlatformPermission(permission: Permission) {
  return permission.startsWith("platform.");
}
