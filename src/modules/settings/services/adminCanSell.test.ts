/** POS-02 · «El administrador puede vender»: reglas puras y permisos efectivos. */
import {
  adminSellPermissions,
  getEffectivePermissions,
  hasEffectivePermission,
  rolePermissions,
} from "@/shared/auth/permissions";

import {
  buildAdminCanSellState,
  hasAdminSellGrants,
  matchesAdminSellGrants,
  resolveAdminSellGrantsOnRoleChange,
  withAdminSellGrants,
  type StoreAdminGrants,
} from "./adminCanSell";

function admin(id: string, overrides: Partial<StoreAdminGrants> = {}): StoreAdminGrants {
  return { grantedPermissions: [], id, isActive: true, name: id, ...overrides };
}

describe("permisos efectivos del administrador (POS-02)", () => {
  it("sin concesiones el admin no vende ni opera caja", () => {
    expect(getEffectivePermissions({ role: "admin" })).toEqual([...rolePermissions.admin]);
    expect(hasEffectivePermission({ role: "admin" }, "sales.create")).toBe(false);
    expect(hasEffectivePermission({ role: "admin" }, "cash.operate")).toBe(false);
  });

  it("con los dos permisos concedidos vende y opera caja, sin perder nada", () => {
    const effective = getEffectivePermissions({
      grantedPermissions: [...adminSellPermissions],
      role: "admin",
    });

    expect(effective).toEqual(expect.arrayContaining([...rolePermissions.admin]));
    expect(effective).toContain("sales.create");
    expect(effective).toContain("cash.operate");
    expect(effective).toHaveLength(rolePermissions.admin.length + 2);
  });

  it("el admin sigue ignorando el resto de excepciones", () => {
    const effective = getEffectivePermissions({
      deniedPermissions: ["users.manage", "sales.create"],
      grantedPermissions: ["payroll.view_own", "platform.stores.manage", "sales.create"],
      role: "admin",
    });

    expect(effective).toContain("users.manage");
    expect(effective).toContain("sales.create");
    expect(effective).not.toContain("cash.operate");
    expect(effective).not.toContain("payroll.view_own");
    expect(effective).not.toContain("platform.stores.manage");
  });
});

describe("adminCanSell · reglas (POS-02)", () => {
  it("concede y retira los dos permisos sin tocar otras excepciones", () => {
    expect(withAdminSellGrants(["contacts.manage"], true)).toEqual([
      "contacts.manage",
      "sales.create",
      "cash.operate",
    ]);
    expect(withAdminSellGrants(["sales.create", "contacts.manage", "cash.operate"], false)).toEqual([
      "contacts.manage",
    ]);
    expect(withAdminSellGrants(undefined, false)).toEqual([]);
  });

  it("uno solo de los dos permisos no cuenta como poder vender, ni como apagado", () => {
    expect(hasAdminSellGrants(["sales.create"])).toBe(false);
    expect(hasAdminSellGrants(["cash.operate", "sales.create"])).toBe(true);
    expect(matchesAdminSellGrants(["sales.create"], true)).toBe(false);
    expect(matchesAdminSellGrants(["sales.create"], false)).toBe(false);
    expect(matchesAdminSellGrants([], false)).toBe(true);
    expect(matchesAdminSellGrants(["cash.operate", "sales.create"], true)).toBe(true);
  });

  it("encendido = todos los administradores ACTIVOS pueden vender", () => {
    const selling = admin("ana", { grantedPermissions: ["sales.create", "cash.operate"] });

    expect(buildAdminCanSellState([selling]).enabled).toBe(true);
    expect(buildAdminCanSellState([selling, admin("luis")]).enabled).toBe(false);
    // Un inactivo sin los permisos no apaga el interruptor ni sale en la lista.
    expect(buildAdminCanSellState([selling, admin("zoe", { isActive: false })])).toEqual({
      admins: [{ canSell: true, id: "ana", name: "ana" }],
      enabled: true,
    });
    expect(buildAdminCanSellState([]).enabled).toBe(false);
  });

  it("quien pasa a admin hereda el estado de la tienda", () => {
    expect(
      resolveAdminSellGrantsOnRoleChange({
        currentRole: "vendedor",
        granted: ["contacts.manage"],
        nextRole: "admin",
        storeEnabled: true,
      }),
    ).toEqual(["contacts.manage", "sales.create", "cash.operate"]);
    // Tienda apagada: una concesión antigua de venta no lo convierte en admin vendedor.
    expect(
      resolveAdminSellGrantsOnRoleChange({
        currentRole: "contador",
        granted: ["sales.create"],
        nextRole: "admin",
        storeEnabled: false,
      }),
    ).toEqual([]);
    expect(
      resolveAdminSellGrantsOnRoleChange({
        currentRole: "vendedor",
        granted: [],
        nextRole: "admin",
        storeEnabled: false,
      }),
    ).toBeUndefined();
  });

  it("quien deja de ser admin pierde los dos permisos concedidos", () => {
    expect(
      resolveAdminSellGrantsOnRoleChange({
        currentRole: "admin",
        granted: ["sales.create", "cash.operate"],
        nextRole: "contador",
        storeEnabled: true,
      }),
    ).toEqual([]);
  });

  it("sin cambio de rol, o entre roles que no son admin, no escribe nada", () => {
    expect(
      resolveAdminSellGrantsOnRoleChange({
        currentRole: "admin",
        granted: [],
        nextRole: "admin",
        storeEnabled: true,
      }),
    ).toBeUndefined();
    expect(
      resolveAdminSellGrantsOnRoleChange({
        currentRole: "contador",
        granted: ["sales.create"],
        nextRole: "almacen",
        storeEnabled: true,
      }),
    ).toBeUndefined();
  });
});
