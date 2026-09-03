import type { Permission } from "@bodega/core/permissions";

/**
 * Tabs por rol. La tabla de `docs/agent-prompts/mobile-app-gtm.md` §4.3 es la
 * guia, pero lo que manda son los **permisos efectivos** de `/api/auth/me`: una
 * tab sin permiso simplemente no se muestra.
 */
export type TabKey =
  | "inicio"
  | "pos"
  | "ventas"
  | "productos"
  | "inventario"
  | "tiendas"
  | "reportes"
  | "mas";

export type TabDefinition = {
  key: TabKey;
  label: string;
  /** Ruta dentro del grupo. */
  route: string;
  /** Permiso necesario. `null` = siempre visible. */
  permission: Permission | null;
};

const storeTabs: TabDefinition[] = [
  { key: "inicio", label: "Inicio", route: "inicio", permission: "dashboard.view" },
  { key: "pos", label: "POS", route: "pos", permission: "sales.create" },
  { key: "ventas", label: "Ventas", route: "ventas", permission: "sales.view" },
  { key: "productos", label: "Productos", route: "productos", permission: "products.view" },
  { key: "inventario", label: "Inventario", route: "inventario", permission: "inventory.view" },
  { key: "mas", label: "Mas", route: "mas", permission: null },
];

const platformTabs: TabDefinition[] = [
  { key: "inicio", label: "Inicio", route: "inicio", permission: "platform.dashboard.view" },
  { key: "tiendas", label: "Tiendas", route: "tiendas", permission: "platform.stores.view" },
  { key: "reportes", label: "Reportes", route: "reportes", permission: "platform.reports.view" },
  { key: "mas", label: "Mas", route: "mas", permission: null },
];

/**
 * Orden preferido por rol. Se filtra por permisos y se recorta a 4 tabs; el
 * resto de pantallas vive en "Mas".
 */
const preferredOrder: Record<string, TabKey[]> = {
  admin: ["inicio", "ventas", "productos", "mas"],
  vendedor: ["inicio", "pos", "ventas", "mas"],
  almacen: ["inicio", "productos", "inventario", "mas"],
  contador: ["inicio", "ventas", "mas"],
  superadmin: ["inicio", "tiendas", "reportes", "mas"],
};

export const maxTabs = 4;

export function getTabsForProfile(
  role: string,
  permissions: readonly Permission[],
): TabDefinition[] {
  const isPlatform = role === "superadmin";
  const catalog = isPlatform ? platformTabs : storeTabs;
  const order = preferredOrder[role] ?? ["inicio", "ventas", "productos", "mas"];

  const allowed = catalog.filter(
    (tab) => tab.permission === null || permissions.includes(tab.permission),
  );

  const ordered = order
    .map((key) => allowed.find((tab) => tab.key === key))
    .filter((tab): tab is TabDefinition => Boolean(tab));

  // Rellena con lo que quede permitido si el rol tiene menos tabs de las esperadas.
  for (const tab of allowed) {
    if (ordered.length >= maxTabs) break;
    if (!ordered.some((existing) => existing.key === tab.key)) {
      ordered.push(tab);
    }
  }

  const mas = ordered.find((tab) => tab.key === "mas");
  const withoutMas = ordered.filter((tab) => tab.key !== "mas").slice(0, maxTabs - 1);

  return mas ? [...withoutMas, mas] : withoutMas;
}

export function isPlatformRole(role: string) {
  return role === "superadmin";
}
