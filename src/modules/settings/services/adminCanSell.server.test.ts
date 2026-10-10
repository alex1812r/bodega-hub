/**
 * @jest-environment node
 *
 * POS-02 · «El administrador puede vender» sobre Supabase simulado: el estado
 * son los `granted_permissions` de los perfiles `admin` de la tienda.
 */

jest.mock("../../../lib/supabase/route-client");
jest.mock("../../../lib/supabase/admin-client");

import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";

import { getAdminCanSell, setAdminCanSell } from "./adminCanSell.server";
import { createUser, updateUser } from "./settings.server";

const STORE = "00000000-0000-4000-8000-000000000001";
const OTHER_STORE = "00000000-0000-4000-8000-000000000002";
const SELL = ["sales.create", "cash.operate"];

type ProfileRow = {
  denied_permissions: string[];
  full_name: string;
  granted_permissions: string[];
  id: string;
  is_active: boolean;
  role: string;
  store_id: string | null;
};

function profile(id: string, role: string, overrides: Partial<ProfileRow> = {}): ProfileRow {
  return {
    denied_permissions: [],
    full_name: id,
    granted_permissions: [],
    id,
    is_active: true,
    role,
    store_id: STORE,
    ...overrides,
  };
}

/** Cliente simulado de `profiles` sobre filas en memoria; sirve de cliente de ruta y de servicio. */
function mountProfiles(rows: ProfileRow[]) {
  const updates: Array<{ ids: string[]; payload: Partial<ProfileRow> }> = [];
  const from = jest.fn(() => {
    const filters: Array<(row: ProfileRow) => boolean> = [];
    let payload: Partial<ProfileRow> | null = null;
    const matching = () => rows.filter((row) => filters.every((filter) => filter(row)));
    const apply = () => {
      const matched = matching();

      if (payload) {
        updates.push({ ids: matched.map((row) => row.id), payload });
        matched.forEach((row) => Object.assign(row, payload));
      }

      return matched;
    };
    const builder = {
      eq: (column: keyof ProfileRow, value: unknown) => {
        filters.push((row) => row[column] === value);
        return builder;
      },
      in: (column: keyof ProfileRow, values: unknown[]) => {
        filters.push((row) => values.includes(row[column]));
        return builder;
      },
      maybeSingle: () => Promise.resolve({ data: apply()[0] ?? null, error: null }),
      neq: (column: keyof ProfileRow, value: unknown) => {
        filters.push((row) => row[column] !== value);
        return builder;
      },
      select: () => builder,
      then: (resolve: (result: { count: number; data: ProfileRow[]; error: null }) => unknown) => {
        const matched = apply();

        return Promise.resolve({ count: matched.length, data: matched, error: null }).then(resolve);
      },
      update: (next: Partial<ProfileRow>) => {
        payload = next;
        return builder;
      },
      upsert: (row: Partial<ProfileRow>) => {
        rows.push(profile(String(row.id), String(row.role), row));
        return Promise.resolve({ error: null });
      },
    };

    return builder;
  });
  const createAuthUser = jest.fn().mockResolvedValue({
    data: { user: { email: "nuevo@demo.test", id: "nuevo" } },
    error: null,
  });

  (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ from });
  (createAdminSupabaseClient as jest.Mock).mockReturnValue({
    auth: {
      admin: {
        createUser: createAuthUser,
        deleteUser: jest.fn().mockResolvedValue({ error: null }),
        listUsers: jest.fn().mockResolvedValue({ data: { users: [] }, error: null }),
      },
    },
    from,
  });

  return { rows, updates };
}

const byId = (rows: ProfileRow[], id: string) => rows.find((row) => row.id === id) as ProfileRow;

describe("adminCanSell.server · interruptor (POS-02)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("apagado por defecto: lista los administradores activos de la tienda", async () => {
    mountProfiles([
      profile("luis", "admin"),
      profile("ana", "admin"),
      profile("inactivo", "admin", { is_active: false }),
      profile("ajeno", "admin", { store_id: OTHER_STORE }),
      profile("seller", "vendedor"),
    ]);

    await expect(getAdminCanSell(STORE)).resolves.toEqual({
      admins: [
        { canSell: false, id: "ana", name: "ana" },
        { canSell: false, id: "luis", name: "luis" },
      ],
      enabled: false,
    });
  });

  it("activar concede los dos permisos a todos los admin de la tienda en una sola escritura", async () => {
    const { rows, updates } = mountProfiles([
      profile("ana", "admin"),
      profile("luis", "admin"),
      profile("inactivo", "admin", { is_active: false }),
      profile("ajeno", "admin", { store_id: OTHER_STORE }),
      profile("seller", "vendedor"),
      profile("contador", "contador"),
    ]);

    await expect(setAdminCanSell(true, STORE)).resolves.toEqual({
      admins: [
        { canSell: true, id: "ana", name: "ana" },
        { canSell: true, id: "luis", name: "luis" },
      ],
      enabled: true,
    });
    expect(updates).toEqual([
      { ids: ["ana", "luis", "inactivo"], payload: { granted_permissions: SELL } },
    ]);
    // Ni otra tienda ni otros roles.
    expect(byId(rows, "ajeno").granted_permissions).toEqual([]);
    expect(byId(rows, "seller").granted_permissions).toEqual([]);
    expect(byId(rows, "contador").granted_permissions).toEqual([]);
    await expect(getAdminCanSell(STORE)).resolves.toMatchObject({ enabled: true });
    await expect(getAdminCanSell(OTHER_STORE)).resolves.toMatchObject({ enabled: false });
  });

  it("es idempotente: repetir el mismo valor no escribe", async () => {
    const { updates } = mountProfiles([profile("ana", "admin")]);

    await setAdminCanSell(true, STORE);
    await setAdminCanSell(true, STORE);
    expect(updates).toHaveLength(1);

    await setAdminCanSell(false, STORE);
    await setAdminCanSell(false, STORE);
    expect(updates).toHaveLength(2);
  });

  it("desactivar retira solo esos dos permisos y conserva las demás excepciones", async () => {
    const { rows, updates } = mountProfiles([
      profile("ana", "admin", { granted_permissions: ["contacts.manage", ...SELL] }),
      profile("luis", "admin", { granted_permissions: SELL }),
    ]);

    await expect(setAdminCanSell(false, STORE)).resolves.toMatchObject({ enabled: false });
    expect(byId(rows, "ana").granted_permissions).toEqual(["contacts.manage"]);
    expect(byId(rows, "luis").granted_permissions).toEqual([]);
    // Excepciones distintas: una escritura por grupo.
    expect(updates).toHaveLength(2);
  });

  it("iguala un estado parcial (un admin con uno solo de los permisos)", async () => {
    const { rows } = mountProfiles([
      profile("ana", "admin", { granted_permissions: SELL }),
      profile("luis", "admin", { granted_permissions: ["sales.create"] }),
    ]);

    await expect(getAdminCanSell(STORE)).resolves.toMatchObject({ enabled: false });
    await expect(setAdminCanSell(true, STORE)).resolves.toMatchObject({ enabled: true });
    expect(byId(rows, "luis").granted_permissions).toEqual(SELL);
  });

  it("un error de la base se propaga", async () => {
    (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
      from: () => ({
        select: () => ({
          eq: () => ({ eq: () => Promise.resolve({ data: null, error: { message: "boom" } }) }),
        }),
      }),
    });

    await expect(setAdminCanSell(true, STORE)).rejects.toBeDefined();
  });
});

describe("settings.server · un administrador nuevo hereda el interruptor (POS-02)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const newUser = { email: "nuevo@demo.test", fullName: "Nuevo", password: "secreto-123" };

  it("admin creado con el interruptor encendido nace pudiendo vender", async () => {
    const { rows } = mountProfiles([profile("ana", "admin", { granted_permissions: SELL })]);

    await expect(createUser({ ...newUser, role: "admin" }, STORE)).resolves.toMatchObject({
      grantedPermissions: SELL,
      role: "admin",
    });
    expect(byId(rows, "nuevo").granted_permissions).toEqual(SELL);
    await expect(getAdminCanSell(STORE)).resolves.toMatchObject({ enabled: true });
  });

  it("admin creado con el interruptor apagado, o cualquier otro rol, no recibe nada", async () => {
    const off = mountProfiles([profile("ana", "admin")]);

    await createUser({ ...newUser, role: "admin" }, STORE);
    expect(byId(off.rows, "nuevo").granted_permissions).toEqual([]);

    const on = mountProfiles([profile("ana", "admin", { granted_permissions: SELL })]);

    await createUser({ ...newUser, role: "contador" }, STORE);
    expect(byId(on.rows, "nuevo").granted_permissions).toEqual([]);
  });

  it("ascender a admin hereda el estado; degradar a un admin le quita los permisos", async () => {
    const { rows, updates } = mountProfiles([
      profile("ana", "admin", { granted_permissions: SELL }),
      profile("conta", "contador"),
    ]);

    await expect(updateUser("conta", { role: "admin" }, STORE)).resolves.toMatchObject({
      grantedPermissions: SELL,
      role: "admin",
    });
    await expect(updateUser("ana", { role: "contador" }, STORE)).resolves.toMatchObject({
      grantedPermissions: [],
      role: "contador",
    });
    expect(byId(rows, "ana").granted_permissions).toEqual([]);
    // Una sola escritura por cambio: rol y permisos viajan juntos.
    expect(updates).toHaveLength(2);
  });

  it("unas excepciones enviadas a mano mandan sobre la herencia", async () => {
    const { rows } = mountProfiles([
      profile("ana", "admin", { granted_permissions: SELL }),
      profile("conta", "contador"),
    ]);

    await updateUser("conta", { grantedPermissions: [], role: "admin" }, STORE);
    expect(byId(rows, "conta").granted_permissions).toEqual([]);
  });

  it("un cambio sin rol no lee ni toca los permisos", async () => {
    const { rows, updates } = mountProfiles([
      profile("ana", "admin", { granted_permissions: SELL }),
    ]);

    await updateUser("ana", { name: "Ana" }, STORE);
    expect(updates).toEqual([{ ids: ["ana"], payload: { full_name: "Ana" } }]);
    expect(byId(rows, "ana").granted_permissions).toEqual(SELL);
  });
});
