import {
  getEffectivePermissions,
  type Permission,
  type PermissionProfile,
  type StoreUserRole,
} from "@/shared/auth/permissions";

export const permissionAreas = [
  "ventas",
  "caja",
  "pagos",
  "baul",
  "compras",
  "inventario",
  "productos",
  "contactos",
  "nomina",
  "reportes",
  "administracion",
  "plataforma",
] as const;

export type PermissionArea = (typeof permissionAreas)[number];

export const permissionAreaLabels: Record<PermissionArea, string> = {
  administracion: "Administración",
  baul: "Baúl",
  caja: "Caja",
  compras: "Compras",
  contactos: "Contactos",
  inventario: "Inventario",
  nomina: "Nómina",
  pagos: "Pagos",
  plataforma: "Plataforma",
  productos: "Productos",
  reportes: "Reportes",
  ventas: "Ventas",
};

/**
 * Etiqueta legible y área de cada permiso. Es exhaustivo respecto a
 * `Permission`: un permiso nuevo sin etiqueta rompe el typecheck.
 */
export const permissionLabels: Record<Permission, { area: PermissionArea; label: string }> = {
  "assistant.use": { area: "reportes", label: "Usar el asistente de consultas" },
  "cash.manage": { area: "caja", label: "Administrar cajas y cierres" },
  "cash.operate": { area: "caja", label: "Operar su caja (abrir, cobrar y cerrar)" },
  "cash.view": { area: "caja", label: "Ver cajas" },
  "contacts.manage": { area: "contactos", label: "Crear y editar clientes y proveedores" },
  "contacts.view": { area: "contactos", label: "Ver clientes y proveedores" },
  "dashboard.view": { area: "reportes", label: "Ver el panel de inicio" },
  "inventory.manage": { area: "inventario", label: "Ajustar stock y convertir empaques" },
  "inventory.view": { area: "inventario", label: "Ver inventario" },
  "payments.manage": { area: "pagos", label: "Registrar y anular pagos" },
  "payments.view": { area: "pagos", label: "Ver pagos" },
  "payroll.manage": { area: "nomina", label: "Administrar nómina" },
  "payroll.view_own": { area: "nomina", label: "Ver sus recibos de nómina" },
  "platform.dashboard.view": { area: "plataforma", label: "Ver el panel de plataforma" },
  "platform.reports.view": { area: "plataforma", label: "Ver reportes de plataforma" },
  "platform.stores.manage": { area: "plataforma", label: "Administrar tiendas" },
  "platform.stores.view": { area: "plataforma", label: "Ver tiendas" },
  "platform.users.manage": { area: "plataforma", label: "Administrar usuarios de plataforma" },
  "platform.users.view": { area: "plataforma", label: "Ver usuarios de plataforma" },
  "products.manage": { area: "productos", label: "Crear y editar productos y precios" },
  "products.view": { area: "productos", label: "Ver productos" },
  "purchases.create": { area: "compras", label: "Registrar y recibir compras" },
  "purchases.view": { area: "compras", label: "Ver compras" },
  "reports.view": { area: "reportes", label: "Ver reportes" },
  "sales.create": { area: "ventas", label: "Vender en el POS" },
  "sales.view": { area: "ventas", label: "Ver ventas" },
  "settings.view": { area: "administracion", label: "Ver la configuración de la tienda" },
  "users.manage": {
    area: "administracion",
    label: "Administrar usuarios y guardar la configuración",
  },
  "vault.manage": { area: "baul", label: "Mover dinero del baúl" },
  "vault.view": { area: "baul", label: "Ver el baúl" },
};

/** Permisos cuya pérdida se trata como quitar la administración de la tienda. */
const administrationPermissions: readonly Permission[] = ["users.manage", "settings.view"];

export type PermissionAreaGroup = {
  area: PermissionArea;
  areaLabel: string;
  labels: string[];
  permissions: Permission[];
};

export type RoleChangeEffect = {
  gained: PermissionAreaGroup[];
  gainedCount: number;
  lost: PermissionAreaGroup[];
  lostCount: number;
  /** Pierde `users.manage` o `settings.view`: deja de administrar la tienda. */
  losesAdministration: boolean;
};

/** Perfil de permisos de un usuario de tienda (rol + excepciones propias). */
export type RoleChangeProfile = Pick<
  PermissionProfile,
  "deniedPermissions" | "grantedPermissions" | "role"
>;

export function groupPermissionsByArea(list: readonly Permission[]): PermissionAreaGroup[] {
  return permissionAreas.flatMap((area) => {
    const inArea = list.filter((permission) => permissionLabels[permission].area === area);

    return inArea.length > 0
      ? [
          {
            area,
            areaLabel: permissionAreaLabels[area],
            labels: inArea.map((permission) => permissionLabels[permission].label),
            permissions: inArea,
          },
        ]
      : [];
  });
}

/**
 * Qué gana y qué pierde un usuario al pasar a `nextRole`. Compara los permisos
 * EFECTIVOS como los calcula el sistema (`getEffectivePermissions`): rol +
 * concedidos − bloqueados, y el administrador ignora las excepciones por usuario.
 */
export function computeRoleChangeEffect(
  profile: RoleChangeProfile,
  nextRole: StoreUserRole,
): RoleChangeEffect {
  const before = getEffectivePermissions(profile);
  const after = getEffectivePermissions({ ...profile, role: nextRole });
  const gained = after.filter((permission) => !before.includes(permission));
  const lost = before.filter((permission) => !after.includes(permission));

  return {
    gained: groupPermissionsByArea(gained),
    gainedCount: gained.length,
    losesAdministration: lost.some((permission) => administrationPermissions.includes(permission)),
    lost: groupPermissionsByArea(lost),
    lostCount: lost.length,
  };
}
