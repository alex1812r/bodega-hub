/**
 * @jest-environment node
 */

import { mockUserProfiles, type UserProfileMock } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { LAST_ACTIVE_ADMIN_MESSAGE } from "./lastActiveAdmin";
import { updateUser } from "./settings.mock-server";

const OTHER_STORE_ID = "00000000-0000-4000-8000-000000000002";
const conflict = { code: "CONFLICT", message: LAST_ACTIVE_ADMIN_MESSAGE, status: 409 };

function admin(id: string, overrides: Partial<UserProfileMock> = {}): UserProfileMock {
  return {
    email: `${id}@example.com`,
    id,
    isActive: true,
    name: id,
    role: "admin",
    storeId: DEFAULT_STORE_ID,
    ...overrides,
  };
}

describe("settings.mock-server · la tienda conserva un administrador activo (CAOS-03)", () => {
  let snapshot: UserProfileMock[];

  beforeEach(() => {
    snapshot = mockUserProfiles.map((profile) => ({ ...profile }));
  });

  afterEach(() => {
    mockUserProfiles.splice(0, mockUserProfiles.length, ...snapshot);
  });

  const storedAdmin = () => mockUserProfiles.find((profile) => profile.id === "user-admin");

  it("la tienda demo parte con un único administrador activo", () => {
    expect(
      mockUserProfiles.filter(
        (profile) =>
          profile.storeId === DEFAULT_STORE_ID && profile.role === "admin" && profile.isActive,
      ),
    ).toHaveLength(1);
  });

  it("rechaza con 409 quitarle el rol o desactivarlo, sin cambiar nada", () => {
    expect(() => updateUser("user-admin", { role: "vendedor" }, DEFAULT_STORE_ID)).toThrow(
      expect.objectContaining(conflict),
    );
    expect(() => updateUser("user-admin", { isActive: false }, DEFAULT_STORE_ID)).toThrow(
      expect.objectContaining(conflict),
    );
    expect(storedAdmin()).toMatchObject({ isActive: true, role: "admin" });
  });

  it("no cuentan como relevo un administrador inactivo, el de otra tienda ni el de plataforma", () => {
    mockUserProfiles.push(
      admin("admin-inactivo", { isActive: false }),
      admin("admin-ajeno", { storeId: OTHER_STORE_ID }),
    );

    expect(mockUserProfiles.some((profile) => profile.role === "superadmin")).toBe(true);
    expect(() => updateUser("user-admin", { isActive: false }, DEFAULT_STORE_ID)).toThrow(
      expect.objectContaining(conflict),
    );
  });

  it("con otro administrador activo en la tienda, deja degradar; el que queda ya no puede irse", () => {
    mockUserProfiles.push(admin("admin-2"));

    expect(updateUser("user-admin", { role: "vendedor" }, DEFAULT_STORE_ID)).toMatchObject({
      id: "user-admin",
      role: "vendedor",
    });
    expect(() => updateUser("admin-2", { isActive: false }, DEFAULT_STORE_ID)).toThrow(
      expect.objectContaining(conflict),
    );
  });

  it("no estorba los cambios que no quitan un administrador activo", () => {
    expect(updateUser("user-admin", { name: "Ada" }, DEFAULT_STORE_ID).name).toBe("Ada");
    expect(
      updateUser("user-admin", { isActive: true, role: "admin" }, DEFAULT_STORE_ID).role,
    ).toBe("admin");
    expect(
      updateUser("user-seller", { isActive: false, role: "contador" }, DEFAULT_STORE_ID).isActive,
    ).toBe(false);
  });
});
