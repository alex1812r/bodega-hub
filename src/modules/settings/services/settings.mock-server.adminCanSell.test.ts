/** POS-02 · «El administrador puede vender» en el servicio mock (paridad con el real). */
import { mockUserProfiles, type UserProfileMock } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import {
  createUser,
  getAdminCanSell,
  setAdminCanSell,
  updateUser,
} from "./settings.mock-server";

const OTHER_STORE = "00000000-0000-4000-8000-000000000002";
const SELL = ["sales.create", "cash.operate"];

function seed(profile: Partial<UserProfileMock> & Pick<UserProfileMock, "id" | "role">) {
  const user: UserProfileMock = {
    email: `${profile.id}@demo.test`,
    isActive: true,
    name: profile.id,
    storeId: DEFAULT_STORE_ID,
    ...profile,
  };

  mockUserProfiles.push(user);

  return user;
}

const find = (id: string) => mockUserProfiles.find((profile) => profile.id === id) as UserProfileMock;

describe("settings.mock-server · El administrador puede vender (POS-02)", () => {
  let snapshot: UserProfileMock[];

  beforeEach(() => {
    snapshot = mockUserProfiles.map((profile) => ({ ...profile }));
  });

  afterEach(() => {
    mockUserProfiles.splice(0, mockUserProfiles.length, ...snapshot);
  });

  it("apagado por defecto, con los administradores activos de la tienda", () => {
    expect(getAdminCanSell(DEFAULT_STORE_ID)).toEqual({
      admins: [{ canSell: false, id: "user-admin", name: "Admin Demo" }],
      enabled: false,
    });
  });

  it("activar y desactivar alcanza a todos los admin de la tienda y a nadie más", () => {
    seed({ id: "admin-2", role: "admin" });
    seed({ id: "admin-inactivo", isActive: false, role: "admin" });
    seed({ id: "admin-ajeno", role: "admin", storeId: OTHER_STORE });

    expect(setAdminCanSell(true, DEFAULT_STORE_ID)).toMatchObject({ enabled: true });
    expect(find("user-admin").grantedPermissions).toEqual(SELL);
    expect(find("admin-2").grantedPermissions).toEqual(SELL);
    expect(find("admin-inactivo").grantedPermissions).toEqual(SELL);
    expect(find("admin-ajeno").grantedPermissions).toBeUndefined();
    expect(find("user-seller").grantedPermissions).toBeUndefined();
    expect(find("55555555-5555-4555-8555-555555555555").grantedPermissions).toEqual([
      "contacts.manage",
    ]);
    expect(getAdminCanSell(OTHER_STORE).enabled).toBe(false);

    expect(setAdminCanSell(false, DEFAULT_STORE_ID)).toMatchObject({ enabled: false });
    expect(find("user-admin").grantedPermissions).toEqual([]);
    expect(find("admin-2").grantedPermissions).toEqual([]);
  });

  it("es idempotente y conserva las demás excepciones", () => {
    find("user-admin").grantedPermissions = ["contacts.manage"];

    setAdminCanSell(true, DEFAULT_STORE_ID);
    const granted = find("user-admin").grantedPermissions;

    expect(setAdminCanSell(true, DEFAULT_STORE_ID)).toMatchObject({ enabled: true });
    // Misma referencia: la segunda vez no escribió.
    expect(find("user-admin").grantedPermissions).toBe(granted);
    expect(granted).toEqual(["contacts.manage", ...SELL]);

    setAdminCanSell(false, DEFAULT_STORE_ID);
    expect(find("user-admin").grantedPermissions).toEqual(["contacts.manage"]);
  });

  it("una tienda sin administradores no falla y queda apagada", () => {
    expect(setAdminCanSell(true, "store-sin-admin")).toEqual({ admins: [], enabled: false });
  });

  it("un administrador nuevo hereda el estado de la tienda", () => {
    const input = { fullName: "Nueva", password: "secreto-123" };

    expect(
      createUser({ ...input, email: "apagado@demo.test", role: "admin" }, DEFAULT_STORE_ID)
        .grantedPermissions,
    ).toBeUndefined();

    // El recién creado también es admin: activar los alcanza a todos.
    setAdminCanSell(true, DEFAULT_STORE_ID);

    expect(
      createUser({ ...input, email: "encendido@demo.test", role: "admin" }, DEFAULT_STORE_ID)
        .grantedPermissions,
    ).toEqual(SELL);
    expect(
      createUser({ ...input, email: "conta@demo.test", role: "contador" }, DEFAULT_STORE_ID)
        .grantedPermissions,
    ).toBeUndefined();
    expect(getAdminCanSell(DEFAULT_STORE_ID).enabled).toBe(true);
  });

  it("ascender a admin hereda el estado y degradar a un admin le quita los permisos", () => {
    seed({ id: "admin-2", role: "admin" });
    setAdminCanSell(true, DEFAULT_STORE_ID);

    expect(updateUser("user-accountant", { role: "admin" }, DEFAULT_STORE_ID)).toMatchObject({
      grantedPermissions: SELL,
      role: "admin",
    });
    expect(updateUser("admin-2", { role: "contador" }, DEFAULT_STORE_ID)).toMatchObject({
      grantedPermissions: [],
      role: "contador",
    });
    expect(getAdminCanSell(DEFAULT_STORE_ID).enabled).toBe(true);
  });
});
