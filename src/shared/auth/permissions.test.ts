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

  it("gives admin all store permissions but not platform ones", () => {
    const effective = getEffectivePermissions({
      deniedPermissions: ["users.manage"],
      role: "admin",
    });

    expect(effective).toContain("products.view");
    expect(effective).toContain("users.manage");
    expect(effective).not.toContain("platform.stores.view");
    expect(effective).not.toContain("platform.stores.manage");
  });

  it("gives superadmin only platform permissions", () => {
    const effective = getEffectivePermissions({ role: "superadmin" });

    expect(effective).toEqual([
      "platform.stores.view",
      "platform.stores.manage",
      "platform.users.view",
      "platform.users.manage",
      "platform.reports.view",
      "platform.dashboard.view",
    ]);
  });
});
