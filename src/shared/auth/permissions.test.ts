import {
  getEffectivePermissions,
  hasEffectivePermission,
  permissions,
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

  it("keeps admin with the full permission catalog", () => {
    expect(getEffectivePermissions({ deniedPermissions: ["users.manage"], role: "admin" })).toEqual(
      permissions,
    );
  });
});
