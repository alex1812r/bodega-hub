import {
  getRolePermissions,
  userRoles,
  type Permission,
  type UserRole,
} from "@/shared/auth/permissions";

import { appNavItems, buildAppNavGroups, findActiveNavGroupId } from "./appShellNav";

/** Menú plano anterior a los grupos (POS-04): ninguna ruta puede perderse. */
const legacyNavEntries: ReadonlyArray<{ href: string; permission: Permission }> = [
  { href: "/platform/dashboard", permission: "platform.dashboard.view" },
  { href: "/platform/stores", permission: "platform.stores.view" },
  { href: "/platform/users", permission: "platform.users.view" },
  { href: "/platform/reports", permission: "platform.reports.view" },
  { href: "/dashboard", permission: "dashboard.view" },
  { href: "/sales", permission: "sales.view" },
  { href: "/cash", permission: "cash.operate" },
  { href: "/cash/registers", permission: "cash.manage" },
  { href: "/vault", permission: "vault.view" },
  { href: "/payroll", permission: "payroll.manage" },
  { href: "/payroll/mine", permission: "payroll.view_own" },
  { href: "/purchases", permission: "purchases.view" },
  { href: "/inventory", permission: "inventory.view" },
  { href: "/products", permission: "products.view" },
  { href: "/contacts", permission: "contacts.view" },
  { href: "/payments", permission: "payments.view" },
  { href: "/reports", permission: "reports.view" },
  { href: "/assistant", permission: "assistant.use" },
  { href: "/settings", permission: "settings.view" },
];

function groupsForRole(role: UserRole) {
  return buildAppNavGroups({ permissions: getRolePermissions(role), role });
}

function describeGroups(role: UserRole) {
  return groupsForRole(role).map((group) => ({
    hrefs: group.items.map((item) => item.href),
    label: group.label,
    open: group.defaultOpen,
  }));
}

function labelsOf(role: UserRole) {
  return groupsForRole(role).flatMap((group) => group.items.map((item) => item.label));
}

describe("appShellNav", () => {
  it("keeps every previous route with the same permission", () => {
    const current = appNavItems.map((item) => `${item.href} ${item.permission}`).sort();
    const legacy = legacyNavEntries.map((entry) => `${entry.href} ${entry.permission}`).sort();

    expect(current).toEqual(legacy);
  });

  it.each(userRoles)("shows %s the same routes as the flat menu did", (role) => {
    const rolePermissions = getRolePermissions(role);
    const legacyHrefs = legacyNavEntries
      .filter((entry) => rolePermissions.includes(entry.permission))
      .map((entry) => entry.href)
      .sort();
    const groupedHrefs = groupsForRole(role)
      .flatMap((group) => group.items.map((item) => item.href))
      .sort();

    expect(groupedHrefs).toEqual(legacyHrefs);
  });

  it("writes the menu labels with accents", () => {
    const labels = appNavItems.map((item) => item.label);

    expect(labels).toEqual(expect.arrayContaining(["Baúl", "Nómina", "Configuración"]));
    expect(labels).not.toContain("Baul");
    expect(labels).not.toContain("Nomina");
    expect(labels).not.toContain("Configuracion");
  });

  it("gives the admin the default order with operation and money open", () => {
    expect(describeGroups("admin")).toEqual([
      {
        hrefs: ["/dashboard", "/sales", "/purchases", "/inventory", "/products", "/contacts"],
        label: "Operación",
        open: true,
      },
      {
        hrefs: ["/cash/registers", "/vault", "/payments", "/payroll"],
        label: "Dinero",
        open: true,
      },
      { hrefs: ["/reports", "/assistant"], label: "Análisis", open: false },
      { hrefs: ["/settings"], label: "Configuración", open: false },
    ]);
  });

  it("puts sales and the cash register first for the seller", () => {
    expect(describeGroups("vendedor")).toEqual([
      {
        hrefs: ["/sales", "/cash", "/dashboard", "/products", "/contacts"],
        label: "Operación",
        open: true,
      },
      { hrefs: ["/payments", "/payroll/mine"], label: "Dinero", open: false },
    ]);
  });

  it("puts inventory and purchases first for the warehouse role", () => {
    expect(describeGroups("almacen")).toEqual([
      {
        hrefs: ["/inventory", "/purchases", "/dashboard", "/products"],
        label: "Operación",
        open: true,
      },
    ]);
  });

  it("puts money and analysis first and open for the accountant", () => {
    expect(describeGroups("contador")).toEqual([
      { hrefs: ["/vault", "/payments"], label: "Dinero", open: true },
      { hrefs: ["/reports"], label: "Análisis", open: true },
      {
        hrefs: ["/dashboard", "/sales", "/purchases", "/contacts"],
        label: "Operación",
        open: false,
      },
    ]);
  });

  it("groups the platform entries for the superadmin", () => {
    expect(describeGroups("superadmin")).toEqual([
      { hrefs: ["/platform/dashboard"], label: "Operación", open: true },
      { hrefs: ["/platform/reports", "/assistant"], label: "Análisis", open: true },
      { hrefs: ["/platform/stores", "/platform/users"], label: "Configuración", open: true },
    ]);
  });

  it("shows Mis recibos only to the seller among the base roles", () => {
    const rolesWithReceipts = userRoles.filter((role) => labelsOf(role).includes("Mis recibos"));

    expect(rolesWithReceipts).toEqual(["vendedor"]);
  });

  it("keeps Mis recibos for a user who was granted payroll.view_own explicitly", () => {
    const groups = buildAppNavGroups({
      permissions: [...getRolePermissions("almacen"), "payroll.view_own"],
      role: "almacen",
    });

    expect(groups.map((group) => group.label)).toEqual(["Operación", "Dinero"]);
    expect(groups[1].items.map((item) => item.href)).toEqual(["/payroll/mine"]);
  });

  it("drops groups without visible entries and uses the default order without role", () => {
    const groups = buildAppNavGroups({ permissions: ["reports.view", "dashboard.view"] });

    expect(groups.map((group) => [group.label, group.defaultOpen])).toEqual([
      ["Operación", true],
      ["Análisis", false],
    ]);
    expect(buildAppNavGroups({ permissions: [] })).toEqual([]);
  });

  it("finds the group of the active route, including nested routes", () => {
    const groups = groupsForRole("admin");

    expect(findActiveNavGroupId(groups, "/vault")).toBe("money");
    expect(findActiveNavGroupId(groups, "/cash/registers")).toBe("money");
    expect(findActiveNavGroupId(groups, "/cash/registers/abc")).toBe("money");
    expect(findActiveNavGroupId(groups, "/sales/create")).toBe("operation");
    expect(findActiveNavGroupId(groups, "/settings")).toBe("settings");
    expect(findActiveNavGroupId(groups, "/salesforce")).toBeNull();
    expect(findActiveNavGroupId(groupsForRole("vendedor"), "/cash/registers")).toBe("operation");
  });
});
