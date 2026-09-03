import { rolePermissions } from "@bodega/core/permissions";

import { getTabsForProfile, isPlatformRole, maxTabs } from "./roleTabs";

const tabKeys = (role: keyof typeof rolePermissions) =>
  getTabsForProfile(role, rolePermissions[role]).map((tab) => tab.key);

describe("getTabsForProfile", () => {
  it("gives the vendedor the POS as a first-class tab", () => {
    expect(tabKeys("vendedor")).toEqual(["inicio", "pos", "ventas", "mas"]);
  });

  it("never shows the POS to an admin, who has no sales.create", () => {
    // Regla de negocio de la web: admin opera el comercio pero no vende.
    expect(rolePermissions.admin).not.toContain("sales.create");
    expect(tabKeys("admin")).not.toContain("pos");
    expect(tabKeys("admin")).toEqual(["inicio", "ventas", "productos", "mas"]);
  });

  it("gives almacen the stock tabs and no sales", () => {
    const keys = tabKeys("almacen");

    expect(keys).toContain("productos");
    expect(keys).toContain("inventario");
    expect(keys).not.toContain("ventas");
    expect(keys).not.toContain("pos");
  });

  it("gives contador read-only tabs without inventory", () => {
    const keys = tabKeys("contador");

    expect(keys).toContain("ventas");
    expect(keys).not.toContain("pos");
    expect(keys).not.toContain("inventario");
  });

  it("switches the superadmin to the platform catalog", () => {
    expect(isPlatformRole("superadmin")).toBe(true);
    expect(tabKeys("superadmin")).toEqual(["inicio", "tiendas", "reportes", "mas"]);
  });

  it("keeps every role within the tab bar budget and always ends in Mas", () => {
    for (const role of Object.keys(rolePermissions) as (keyof typeof rolePermissions)[]) {
      const keys = tabKeys(role);

      expect(keys.length).toBeGreaterThan(0);
      expect(keys.length).toBeLessThanOrEqual(maxTabs);
      expect(keys.at(-1)).toBe("mas");
    }
  });

  it("drops a tab when the permission is revoked by an override", () => {
    const withoutSales = rolePermissions.vendedor.filter(
      (permission) => permission !== "sales.create",
    );

    expect(getTabsForProfile("vendedor", withoutSales).map((tab) => tab.key)).not.toContain(
      "pos",
    );
  });

  it("still returns Mas for a profile with no permissions at all", () => {
    expect(getTabsForProfile("vendedor", []).map((tab) => tab.key)).toEqual(["mas"]);
  });
});
