import {
  getEffectivePermissions,
  hasEffectivePermission,
} from "./permissions";

describe("permissions", () => {
  it("uses role permissions when no overrides are present", () => {
    expect(getEffectivePermissions({ role: "vendedor" })).toEqual(
      expect.arrayContaining(["sales.view", "contacts.view"]),
    );
    expect(getEffectivePermissions({ role: "vendedor" })).not.toContain("contacts.manage");
  });

  it("adds granted permissions and removes denied permissions", () => {
    const profile = {
      deniedPermissions: ["payments.view"],
      grantedPermissions: ["contacts.manage"],
      role: "vendedor",
    } as const;

    expect(hasEffectivePermission(profile, "contacts.manage")).toBe(true);
    expect(hasEffectivePermission(profile, "payments.view")).toBe(false);
  });

  it("gives admin store permissions except sales.create and cash.operate", () => {
    const effective = getEffectivePermissions({
      deniedPermissions: ["users.manage"],
      role: "admin",
    });

    expect(effective).toContain("products.view");
    expect(effective).toContain("users.manage");
    expect(effective).toContain("cash.manage");
    expect(effective).toContain("vault.manage");
    expect(effective).toContain("sales.view");
    expect(effective).not.toContain("sales.create");
    expect(effective).not.toContain("cash.operate");
    expect(effective).not.toContain("platform.stores.view");
    expect(effective).not.toContain("platform.stores.manage");
  });

  it("gives superadmin platform permissions plus the assistant", () => {
    const effective = getEffectivePermissions({ role: "superadmin" });

    expect(effective).toEqual([
      "platform.stores.view",
      "platform.stores.manage",
      "platform.users.view",
      "platform.users.manage",
      "platform.reports.view",
      "platform.dashboard.view",
      "assistant.use",
    ]);
  });

  it("splits payroll between the owner and the cashier", () => {
    expect(hasEffectivePermission({ role: "admin" }, "payroll.manage")).toBe(true);
    // El dueño no cobra nómina: no necesita "Mis recibos".
    expect(hasEffectivePermission({ role: "admin" }, "payroll.view_own")).toBe(false);

    expect(hasEffectivePermission({ role: "vendedor" }, "payroll.view_own")).toBe(true);
    expect(hasEffectivePermission({ role: "vendedor" }, "payroll.manage")).toBe(false);

    for (const role of ["almacen", "contador", "superadmin"] as const) {
      expect(hasEffectivePermission({ role }, "payroll.manage")).toBe(false);
      expect(hasEffectivePermission({ role }, "payroll.view_own")).toBe(false);
    }
  });

  it("grants assistant.use to admin and superadmin only", () => {
    expect(hasEffectivePermission({ role: "admin" }, "assistant.use")).toBe(true);
    expect(hasEffectivePermission({ role: "superadmin" }, "assistant.use")).toBe(true);

    for (const role of ["vendedor", "almacen", "contador"] as const) {
      expect(hasEffectivePermission({ role }, "assistant.use")).toBe(false);
    }
  });
});
