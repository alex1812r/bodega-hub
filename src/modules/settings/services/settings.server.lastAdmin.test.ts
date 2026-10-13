/**
 * @jest-environment node
 */

jest.mock("../../../lib/supabase/route-client");
jest.mock("../../../lib/supabase/admin-client");

import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";

import { LAST_ACTIVE_ADMIN_MESSAGE } from "./lastActiveAdmin";
import { updateUser } from "./settings.server";

const STORE = "00000000-0000-4000-8000-000000000001";
const OTHER_STORE = "00000000-0000-4000-8000-000000000002";

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

/** Cliente simulado de `profiles`: filtra, cuenta y actualiza sobre filas en memoria. */
function mountProfiles(rows: ProfileRow[]) {
  const updates: Array<Record<string, unknown>> = [];
  const from = jest.fn(() => {
    const filters: Array<(row: ProfileRow) => boolean> = [];
    let payload: Partial<ProfileRow> | null = null;
    const matching = () => rows.filter((row) => filters.every((filter) => filter(row)));
    const builder = {
      eq: (column: keyof ProfileRow, value: unknown) => {
        filters.push((row) => row[column] === value);
        return builder;
      },
      maybeSingle: () => {
        const [row] = matching();

        if (row && payload) {
          Object.assign(row, payload);
        }

        return Promise.resolve({ data: row ?? null, error: null });
      },
      neq: (column: keyof ProfileRow, value: unknown) => {
        filters.push((row) => row[column] !== value);
        return builder;
      },
      select: () => builder,
      then: (resolve: (result: { count: number; data: null; error: null }) => unknown) =>
        Promise.resolve({ count: matching().length, data: null, error: null }).then(resolve),
      update: (next: Partial<ProfileRow>) => {
        payload = next;
        updates.push(next);
        return builder;
      },
    };

    return builder;
  });

  (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ from });
  (createAdminSupabaseClient as jest.Mock).mockReturnValue({
    auth: { admin: { listUsers: jest.fn().mockResolvedValue({ data: { users: [] }, error: null }) } },
  });

  return { rows, updates };
}

const conflict = { code: "CONFLICT", message: LAST_ACTIVE_ADMIN_MESSAGE, status: 409 };

describe("settings.server · la tienda conserva un administrador activo (CAOS-03)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("rechaza con 409 quitar el rol al único administrador activo, sin escribir", async () => {
    const { rows, updates } = mountProfiles([profile("admin-1", "admin"), profile("seller", "vendedor")]);

    await expect(updateUser("admin-1", { role: "vendedor" }, STORE)).rejects.toMatchObject(conflict);
    expect(updates).toEqual([]);
    expect(rows[0].role).toBe("admin");
  });

  it("rechaza con 409 desactivar al único administrador activo, sin escribir", async () => {
    const { rows, updates } = mountProfiles([profile("admin-1", "admin")]);

    await expect(updateUser("admin-1", { isActive: false }, STORE)).rejects.toMatchObject(conflict);
    expect(updates).toEqual([]);
    expect(rows[0].is_active).toBe(true);
  });

  it("no cuentan como relevo un administrador inactivo, el de otra tienda ni el de plataforma", async () => {
    mountProfiles([
      profile("admin-1", "admin"),
      profile("admin-inactivo", "admin", { is_active: false }),
      profile("admin-ajeno", "admin", { store_id: OTHER_STORE }),
      profile("plataforma", "superadmin", { store_id: null }),
    ]);

    await expect(updateUser("admin-1", { role: "contador" }, STORE)).rejects.toMatchObject(conflict);
    await expect(updateUser("admin-1", { isActive: false }, STORE)).rejects.toMatchObject(conflict);
  });

  it("con otro administrador activo en la tienda, deja degradar o desactivar", async () => {
    const { rows } = mountProfiles([profile("admin-1", "admin"), profile("admin-2", "admin")]);

    await expect(updateUser("admin-1", { role: "vendedor" }, STORE)).resolves.toMatchObject({
      id: "admin-1",
      role: "vendedor",
    });
    expect(rows[0].role).toBe("vendedor");
    // Ahora `admin-2` es el último: ya no se puede desactivar.
    await expect(updateUser("admin-2", { isActive: false }, STORE)).rejects.toMatchObject(conflict);
  });

  it("no estorba los cambios que no quitan un administrador activo", async () => {
    const { updates } = mountProfiles([
      profile("admin-1", "admin"),
      profile("admin-inactivo", "admin", { is_active: false }),
      profile("seller", "vendedor"),
    ]);

    await expect(updateUser("admin-1", { name: "Ada" }, STORE)).resolves.toMatchObject({ name: "Ada" });
    await expect(updateUser("admin-1", { isActive: true, role: "admin" }, STORE)).resolves.toBeDefined();
    await expect(updateUser("seller", { isActive: false, role: "contador" }, STORE)).resolves.toBeDefined();
    // Un administrador ya inactivo no era el que sostenía la tienda.
    await expect(updateUser("admin-inactivo", { role: "vendedor" }, STORE)).resolves.toBeDefined();
    expect(updates).toHaveLength(4);
  });

  it("un usuario de otra tienda sigue siendo 404, no 409", async () => {
    mountProfiles([profile("admin-ajeno", "admin", { store_id: OTHER_STORE })]);

    await expect(updateUser("admin-ajeno", { isActive: false }, STORE)).rejects.toMatchObject({
      status: 404,
    });
  });
});
