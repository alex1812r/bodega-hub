/** CNF-11 · Diferencia de permisos efectivos al cambiar el rol de un usuario. */
import { permissions, rolePermissions, storeUserRoles } from "@/shared/auth/permissions";

import {
  computeRoleChangeEffect,
  groupPermissionsByArea,
  permissionAreas,
  permissionLabels,
} from "./rolePermissionDiff";

function flat(groups: ReturnType<typeof groupPermissionsByArea>) {
  return groups.flatMap((group) => group.permissions);
}

describe("rolePermissionDiff (CNF-11)", () => {
  it("todos los permisos tienen etiqueta en español y un área conocida", () => {
    for (const permission of permissions) {
      expect(permissionLabels[permission].label.length).toBeGreaterThan(3);
      expect(permissionAreas).toContain(permissionLabels[permission].area);
    }
  });

  it("vendedor → admin: gana y pierde exactamente la diferencia de rolePermissions", () => {
    const effect = computeRoleChangeEffect({ role: "vendedor" }, "admin");
    const expectedGained = rolePermissions.admin.filter(
      (permission) => !rolePermissions.vendedor.includes(permission),
    );

    expect([...flat(effect.gained)].sort()).toEqual([...expectedGained].sort());
    expect([...flat(effect.lost)].sort()).toEqual(
      ["cash.operate", "payroll.view_own", "sales.create"].sort(),
    );
    expect(effect.gainedCount).toBe(expectedGained.length);
    expect(effect.lostCount).toBe(3);
    expect(effect.losesAdministration).toBe(false);
  });

  it("agrupa por área con etiquetas legibles", () => {
    const effect = computeRoleChangeEffect({ role: "vendedor" }, "admin");
    const vault = effect.gained.find((group) => group.area === "baul");

    expect(vault).toEqual({
      area: "baul",
      areaLabel: "Baúl",
      labels: ["Ver el baúl", "Mover dinero del baúl"],
      permissions: ["vault.view", "vault.manage"],
    });
    expect(effect.gained.map((group) => group.areaLabel)).toEqual(
      expect.arrayContaining(["Compras", "Baúl", "Reportes", "Administración"]),
    );
  });

  it("admin → vendedor: pierde la administración", () => {
    const effect = computeRoleChangeEffect({ role: "admin" }, "vendedor");

    expect(effect.losesAdministration).toBe(true);
    expect(flat(effect.lost)).toEqual(expect.arrayContaining(["users.manage", "vault.manage"]));
    expect([...flat(effect.gained)].sort()).toEqual(
      ["cash.operate", "payroll.view_own", "sales.create"].sort(),
    );
  });

  it("respeta las excepciones del usuario: lo concedido no se gana y lo bloqueado no se pierde", () => {
    const effect = computeRoleChangeEffect(
      {
        deniedPermissions: ["sales.create"],
        grantedPermissions: ["reports.view"],
        role: "vendedor",
      },
      "contador",
    );

    // Ya tenía reportes por concesión y nunca tuvo vender: ninguno cambia.
    expect(flat(effect.gained)).not.toContain("reports.view");
    expect(flat(effect.lost)).not.toContain("sales.create");
    expect(flat(effect.gained)).toEqual(
      expect.arrayContaining(["purchases.view", "payments.manage", "vault.view"]),
    );
    expect(flat(effect.lost)).toEqual(
      expect.arrayContaining(["products.view", "cash.operate", "payroll.view_own"]),
    );
  });

  it("al pasar a admin las excepciones dejan de aplicar, como en el sistema", () => {
    const effect = computeRoleChangeEffect(
      { grantedPermissions: ["sales.create"], role: "almacen" },
      "admin",
    );

    // El administrador ignora las concesiones: deja de poder vender.
    expect(flat(effect.lost)).toEqual(["sales.create"]);
  });

  it("el mismo rol no cambia nada", () => {
    for (const role of storeUserRoles) {
      const effect = computeRoleChangeEffect({ role }, role);

      expect(effect.gainedCount).toBe(0);
      expect(effect.lostCount).toBe(0);
      expect(effect.losesAdministration).toBe(false);
    }
  });
});
