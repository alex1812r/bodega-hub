export const userRoles = ["admin", "vendedor", "almacen", "contador"] as const;

export type UserRole = (typeof userRoles)[number];

export const roleLabels: Record<UserRole, string> = {
  admin: "Administrador",
  vendedor: "Vendedor",
  almacen: "Almacen",
  contador: "Contador",
};

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
  "reports.view",
  "settings.view",
  "users.manage",
] as const;

export type Permission = (typeof permissions)[number];

export type PermissionProfile = {
  deniedPermissions?: readonly Permission[];
  grantedPermissions?: readonly Permission[];
  role: UserRole;
};

export const rolePermissions: Record<UserRole, readonly Permission[]> = {
  admin: permissions,
  vendedor: [
    "dashboard.view",
    "sales.view",
    "sales.create",
    "products.view",
    "contacts.view",
    "payments.view",
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
  if (profile.role === "admin") {
    return permissions;
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
