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

  it("lets an admin sell and operate cash only through the two granted sell permissions", () => {
    const effective = getEffectivePermissions({
      grantedPermissions: ["sales.create", "cash.operate", "payroll.view_own"],
      role: "admin",
    });

    expect(effective).toContain("sales.create");
    expect(effective).toContain("cash.operate");
    expect(effective).not.toContain("payroll.view_own");
    expect(hasEffectivePermission({ grantedPermissions: ["sales.create"], role: "admin" }, "cash.operate")).toBe(false);
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

  // DEC-02: anular y devolver ventas es un permiso propio; el admin no necesita
  // «El administrador puede vender» para corregir una venta.
  describe("sales.cancel", () => {
    it("admin always has it, with the sell switch off or on, and still cannot sell with it off", () => {
      expect(hasEffectivePermission({ role: "admin" }, "sales.cancel")).toBe(true);
      expect(hasEffectivePermission({ role: "admin" }, "sales.create")).toBe(false);
      expect(hasEffectivePermission({ role: "admin" }, "cash.operate")).toBe(false);
      expect(
        hasEffectivePermission(
          { grantedPermissions: ["sales.create", "cash.operate"], role: "admin" },
          "sales.cancel",
        ),
      ).toBe(true);
      // El admin ignora las excepciones por usuario.
      expect(
        hasEffectivePermission({ deniedPermissions: ["sales.cancel"], role: "admin" }, "sales.cancel"),
      ).toBe(true);
    });

    it("vendedor has it by default; contador, almacen and superadmin do not", () => {
      expect(hasEffectivePermission({ role: "vendedor" }, "sales.cancel")).toBe(true);

      for (const role of ["almacen", "contador", "superadmin"] as const) {
        expect(hasEffectivePermission({ role }, "sales.cancel")).toBe(false);
      }
    });

    it("a user whose sales.create was denied does not gain sales.cancel as a side effect", () => {
      const denied = { deniedPermissions: ["sales.create"], role: "vendedor" } as const;

      expect(hasEffectivePermission(denied, "sales.create")).toBe(false);
      expect(hasEffectivePermission(denied, "sales.cancel")).toBe(false);
    });

    it("an explicit grant of sales.cancel wins over a denied sales.create", () => {
      const profile = {
        deniedPermissions: ["sales.create"],
        grantedPermissions: ["sales.cancel"],
        role: "vendedor",
      } as const;

      expect(hasEffectivePermission(profile, "sales.create")).toBe(false);
      expect(hasEffectivePermission(profile, "sales.cancel")).toBe(true);
    });

    it("denying sales.cancel removes only that permission", () => {
      const profile = { deniedPermissions: ["sales.cancel"], role: "vendedor" } as const;

      expect(hasEffectivePermission(profile, "sales.cancel")).toBe(false);
      expect(hasEffectivePermission(profile, "sales.create")).toBe(true);
    });

    it("an explicit deny of sales.cancel wins over its explicit grant, like any other permission", () => {
      const profile = {
        deniedPermissions: ["sales.cancel"],
        grantedPermissions: ["sales.cancel"],
        role: "vendedor",
      } as const;

      expect(hasEffectivePermission(profile, "sales.cancel")).toBe(false);
    });

    it("is additive: every permission that existed keeps its order and sales.create is untouched", () => {
      expect(getEffectivePermissions({ role: "vendedor" })).toEqual([
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
      ]);
    });
  });
});
