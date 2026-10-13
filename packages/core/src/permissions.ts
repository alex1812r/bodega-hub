export const userRoles = ["superadmin", "admin", "vendedor", "almacen", "contador"] as const;

export type UserRole = (typeof userRoles)[number];

/** Roles que un admin de tienda puede asignar al crear/editar usuarios. */
export const storeUserRoles = ["admin", "vendedor", "almacen", "contador"] as const;

export type StoreUserRole = (typeof storeUserRoles)[number];

export const roleLabels: Record<UserRole, string> = {
  superadmin: "Superadmin",
  admin: "Administrador",
  vendedor: "Vendedor",
  almacen: "Almacén",
  contador: "Contador",
};

export function isStoreUserRole(value: unknown): value is StoreUserRole {
  return typeof value === "string" && storeUserRoles.includes(value as StoreUserRole);
}

export const permissions = [
  "dashboard.view",
  "sales.view",
  "sales.create",
  "sales.cancel",
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
  "payroll.manage",
  "payroll.view_own",
  "reports.view",
  "assistant.use",
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
 * Anular y devolver ventas (DEC-02): `sales.cancel`, aparte de vender
 * (`sales.create`). Lo tienen por defecto el admin (siempre, sin el interruptor
 * «El administrador puede vender»: corrige ventas aunque no venda) y el
 * vendedor. Regla de arrastre para las excepciones por usuario: quien tiene
 * `sales.create` DENEGADO tampoco recibe `sales.cancel` del rol; solo lo
 * conserva si se le concede `sales.cancel` explícitamente (y un
 * `sales.cancel` denegado manda sobre todo, como cualquier otro permiso).
 * Así, un usuario al que se le quitó vender antes de existir este permiso no
 * gana la anulación de rebote. Las RPC `cancel_sale` / `return_sale` siguen
 * aceptando solo los roles admin y vendedor.
 */
export const saleCancelPermission = "sales.cancel" as const satisfies Permission;

/**
 * Admin opera el comercio pero no vende en POS ni opera "Mi caja".
 * Tampoco cobra nómina: es el dueño y sus retiros salen del baúl, así que no
 * necesita "Mis recibos" (`payroll.view_own`).
 * Vender y operar caja se pueden conceder a un admin con `adminSellPermissions`
 * (interruptor «El administrador puede vender» de Configuración).
 */
const adminBlockedPermissions = new Set<Permission>([
  "sales.create",
  "cash.operate",
  "payroll.view_own",
]);

/**
 * Lo único que un admin puede recibir por `grantedPermissions`: vender en el POS
 * y operar su caja. Lo concede o retira, a todos los admin de la tienda, el
 * interruptor «El administrador puede vender» (POS-02, docs/auth-permissions.md).
 */
export const adminSellPermissions = [
  "sales.create",
  "cash.operate",
] as const satisfies readonly Permission[];

const adminStorePermissions = storePermissions.filter(
  (permission) => !adminBlockedPermissions.has(permission),
);

/**
 * El asistente es transversal: no lleva prefijo `platform.` pero el superadmin
 * tambien lo usa (en modo plataforma), asi que se agrega explicitamente.
 */
const superadminPermissions: Permission[] = [...platformPermissions, "assistant.use"];

export const rolePermissions: Record<UserRole, readonly Permission[]> = {
  superadmin: superadminPermissions,
  admin: adminStorePermissions,
  vendedor: [
    "dashboard.view",
    "sales.view",
    "sales.create",
    "sales.cancel",
    "products.view",
    "contacts.view",
    "payments.view",
    "cash.view",
    "cash.operate",
    "payroll.view_own",
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
    // El admin ignora las excepciones por usuario, salvo `adminSellPermissions` concedidos.
    const granted = profile.grantedPermissions ?? [];
    const effectiveAdmin = new Set<Permission>([
      ...rolePermissions.admin,
      ...adminSellPermissions.filter((permission) => granted.includes(permission)),
    ]);

    return permissions.filter((permission) => effectiveAdmin.has(permission));
  }

  const granted = profile.grantedPermissions ?? [];
  const denied = profile.deniedPermissions ?? [];
  const effectivePermissions = new Set<Permission>([
    ...getRolePermissions(profile.role),
    ...granted,
  ]);

  for (const permission of denied) {
    effectivePermissions.delete(permission);
  }

  // Ver `saleCancelPermission`: sin vender por denegación, tampoco anula salvo concesión explícita.
  if (denied.includes("sales.create") && !granted.includes(saleCancelPermission)) {
    effectivePermissions.delete(saleCancelPermission);
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
