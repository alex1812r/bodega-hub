import {
  BarChart3,
  Boxes,
  Building2,
  CreditCard,
  HandCoins,
  Home,
  Landmark,
  MessageSquare,
  Package,
  Receipt,
  Settings,
  ShoppingCart,
  UserCog,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import { type Permission, type UserRole } from "@/shared/auth/permissions";

export type AppNavGroupId = "operation" | "money" | "analysis" | "settings";

export type AppNavItem = {
  group: AppNavGroupId;
  href: string;
  icon: LucideIcon;
  label: string;
  permission: Permission;
};

export type AppNavGroup = {
  /** Abierto si el usuario aún no lo ha plegado/desplegado (o si no hay almacenamiento). */
  defaultOpen: boolean;
  id: AppNavGroupId;
  items: AppNavItem[];
  label: string;
};

type AppNavRoleLayout = {
  /** Entradas que suben al principio de su grupo, en este orden. */
  firstHrefs: readonly string[];
  /** Orden de los grupos: el que más usa el rol va primero. */
  groupOrder: readonly AppNavGroupId[];
  /** Grupos abiertos de entrada. */
  openGroups: readonly AppNavGroupId[];
};

const appNavGroupLabels: Record<AppNavGroupId, string> = {
  operation: "Operación",
  money: "Dinero",
  analysis: "Análisis",
  settings: "Configuración",
};

/**
 * Orden por defecto de las entradas dentro de cada grupo. La visibilidad de
 * cada una la decide solo su permiso (p. ej. "Mis recibos" exige
 * `payroll.view_own`, que de base solo tiene el vendedor).
 */
export const appNavItems: AppNavItem[] = [
  { group: "operation", href: "/platform/dashboard", icon: Home, label: "Inicio", permission: "platform.dashboard.view" },
  { group: "operation", href: "/dashboard", icon: Home, label: "Inicio", permission: "dashboard.view" },
  { group: "operation", href: "/sales", icon: Receipt, label: "Ventas", permission: "sales.view" },
  { group: "operation", href: "/cash", icon: Wallet, label: "Mi caja", permission: "cash.operate" },
  { group: "operation", href: "/purchases", icon: ShoppingCart, label: "Compras", permission: "purchases.view" },
  { group: "operation", href: "/inventory", icon: Boxes, label: "Inventario", permission: "inventory.view" },
  { group: "operation", href: "/products", icon: Package, label: "Productos", permission: "products.view" },
  { group: "operation", href: "/contacts", icon: Users, label: "Contactos", permission: "contacts.view" },
  { group: "money", href: "/cash/registers", icon: Wallet, label: "Cajas", permission: "cash.manage" },
  { group: "money", href: "/vault", icon: Landmark, label: "Baúl", permission: "vault.view" },
  { group: "money", href: "/payments", icon: CreditCard, label: "Pagos", permission: "payments.view" },
  { group: "money", href: "/payroll", icon: HandCoins, label: "Nómina", permission: "payroll.manage" },
  { group: "money", href: "/payroll/mine", icon: HandCoins, label: "Mis recibos", permission: "payroll.view_own" },
  { group: "analysis", href: "/platform/reports", icon: BarChart3, label: "Reportes", permission: "platform.reports.view" },
  { group: "analysis", href: "/reports", icon: BarChart3, label: "Reportes", permission: "reports.view" },
  { group: "analysis", href: "/assistant", icon: MessageSquare, label: "Asistente", permission: "assistant.use" },
  { group: "settings", href: "/settings", icon: Settings, label: "Configuración", permission: "settings.view" },
  { group: "settings", href: "/platform/stores", icon: Building2, label: "Tiendas", permission: "platform.stores.view" },
  { group: "settings", href: "/platform/users", icon: UserCog, label: "Usuarios", permission: "platform.users.view" },
];

const defaultGroupOrder: readonly AppNavGroupId[] = ["operation", "money", "analysis", "settings"];

const defaultNavLayout: AppNavRoleLayout = {
  firstHrefs: [],
  groupOrder: defaultGroupOrder,
  openGroups: ["operation"],
};

/** Regla de orden y apertura del menú por rol. Sin rol se usa `defaultNavLayout`. */
const appNavRoleLayouts: Record<UserRole, AppNavRoleLayout> = {
  superadmin: {
    firstHrefs: [],
    groupOrder: defaultGroupOrder,
    openGroups: defaultGroupOrder,
  },
  admin: {
    firstHrefs: [],
    groupOrder: defaultGroupOrder,
    openGroups: ["operation", "money"],
  },
  vendedor: {
    firstHrefs: ["/sales", "/cash"],
    groupOrder: defaultGroupOrder,
    openGroups: ["operation"],
  },
  almacen: {
    firstHrefs: ["/inventory", "/purchases"],
    groupOrder: defaultGroupOrder,
    openGroups: ["operation"],
  },
  contador: {
    firstHrefs: [],
    groupOrder: ["money", "analysis", "operation", "settings"],
    openGroups: ["money", "analysis"],
  },
};

function sortByFirstHrefs(items: AppNavItem[], firstHrefs: readonly string[]) {
  const rank = (item: AppNavItem) => {
    const index = firstHrefs.indexOf(item.href);

    return index === -1 ? firstHrefs.length : index;
  };

  // `sort` es estable: las entradas sin prioridad conservan el orden por defecto.
  return [...items].sort((left, right) => rank(left) - rank(right));
}

/**
 * Grupos del menú que ve un usuario: filtra cada entrada por su permiso,
 * descarta los grupos vacíos y aplica el orden del rol.
 */
export function buildAppNavGroups({
  permissions,
  role,
}: {
  permissions: readonly Permission[];
  role?: UserRole;
}): AppNavGroup[] {
  const layout = role ? appNavRoleLayouts[role] : defaultNavLayout;
  const visibleItems = appNavItems.filter((item) => permissions.includes(item.permission));

  return layout.groupOrder
    .map((groupId) => ({
      defaultOpen: layout.openGroups.includes(groupId),
      id: groupId,
      items: sortByFirstHrefs(
        visibleItems.filter((item) => item.group === groupId),
        layout.firstHrefs,
      ),
      label: appNavGroupLabels[groupId],
    }))
    .filter((group) => group.items.length > 0);
}

function matchesPath(href: string, currentPath: string) {
  return currentPath === href || currentPath.startsWith(`${href}/`);
}

/**
 * Grupo al que pertenece la ruta actual: la entrada cuyo `href` coincide o, si
 * es una subruta (p. ej. un detalle), la de `href` más largo que la contiene.
 */
export function findActiveNavGroupId(
  groups: readonly AppNavGroup[],
  currentPath: string,
): AppNavGroupId | null {
  let best: { groupId: AppNavGroupId; length: number } | null = null;

  for (const group of groups) {
    for (const item of group.items) {
      if (matchesPath(item.href, currentPath) && (!best || item.href.length > best.length)) {
        best = { groupId: group.id, length: item.href.length };
      }
    }
  }

  return best ? best.groupId : null;
}

export function getAppNavGroupStorageKey(groupId: AppNavGroupId) {
  return `bodega-hub:nav-group:${groupId}`;
}
