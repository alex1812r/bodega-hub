import { adminSellPermissions, type Permission } from "@/shared/auth/permissions";

/**
 * «El administrador puede vender» (POS-02). No hay ajuste de tienda: el estado
 * son los `grantedPermissions` de los perfiles `admin` de la tienda. Encendido =
 * TODOS los administradores activos tienen `sales.create` y `cash.operate`.
 */
export type AdminCanSellAdmin = {
  /** Tiene los dos permisos concedidos. */
  canSell: boolean;
  id: string;
  name: string;
};

export type AdminCanSellState = {
  /** Administradores ACTIVOS de la tienda, por nombre. */
  admins: AdminCanSellAdmin[];
  /** Todos los administradores activos pueden vender y operar caja. */
  enabled: boolean;
};

/** Perfil `admin` de una tienda, tal como lo necesitan el interruptor y su herencia. */
export type StoreAdminGrants = {
  grantedPermissions: readonly Permission[];
  id: string;
  isActive: boolean;
  name: string;
};

const sellPermissions: readonly Permission[] = adminSellPermissions;

/** Los dos permisos están concedidos (uno solo no basta para vender). */
export function hasAdminSellGrants(granted: readonly Permission[] | undefined) {
  return sellPermissions.every((permission) => (granted ?? []).includes(permission));
}

/** `granted` con los dos permisos puestos o quitados; el resto de excepciones no se toca. */
export function withAdminSellGrants(
  granted: readonly Permission[] | undefined,
  enabled: boolean,
): Permission[] {
  const others = (granted ?? []).filter((permission) => !sellPermissions.includes(permission));

  return enabled ? [...others, ...sellPermissions] : others;
}

/** `granted` ya es exactamente lo que dejaría `withAdminSellGrants`. */
export function matchesAdminSellGrants(
  granted: readonly Permission[] | undefined,
  enabled: boolean,
) {
  const sellGrants = sellPermissions.filter((permission) => (granted ?? []).includes(permission));

  return sellGrants.length === (enabled ? sellPermissions.length : 0);
}

export function buildAdminCanSellState(admins: readonly StoreAdminGrants[]): AdminCanSellState {
  const active = admins
    .filter((admin) => admin.isActive)
    .map((admin) => ({
      canSell: hasAdminSellGrants(admin.grantedPermissions),
      id: admin.id,
      name: admin.name,
    }))
    .sort((left, right) => left.name.localeCompare(right.name, "es"));

  return {
    admins: active,
    enabled: active.length > 0 && active.every((admin) => admin.canSell),
  };
}

/**
 * Herencia al cambiar de rol sin tocar las excepciones a mano: quien pasa a
 * `admin` queda como el resto de administradores de la tienda, y quien deja de
 * serlo pierde los dos permisos (no se quedan colgados en un contador o almacén).
 * `undefined` = no hay nada que escribir en `granted_permissions`.
 */
export function resolveAdminSellGrantsOnRoleChange(change: {
  currentRole: string;
  granted: readonly Permission[] | undefined;
  nextRole: string;
  /** Estado del interruptor entre los DEMÁS administradores activos de la tienda. */
  storeEnabled: boolean;
}): Permission[] | undefined {
  if (change.currentRole === change.nextRole) {
    return undefined;
  }

  const becomesAdmin = change.nextRole === "admin";

  if (!becomesAdmin && change.currentRole !== "admin") {
    return undefined;
  }

  const enabled = becomesAdmin && change.storeEnabled;

  return matchesAdminSellGrants(change.granted, enabled)
    ? undefined
    : withAdminSellGrants(change.granted, enabled);
}
