/** @jest-environment node */
/**
 * POS-F5 (qa-final F1): la caja se asigna a quien puede operarla (`cash.operate`
 * efectivo): vendedores, administradores con «El administrador puede vender» y
 * usuarios con el permiso concedido. A cualquier otro, 400.
 */

jest.mock("../../../../../lib/supabase/route-client", () => ({
  createRouteSupabaseClient: jest.fn(),
}));

import { adminSellPermissions } from "@bodega/core";

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { CASH_REGISTER_ASSIGNEE_MESSAGE } from "@/modules/cash/services/cashRegisterAssignee";
import {
  CASH_REGISTER_ASSIGNMENT_CONFLICT_MESSAGE,
  createCashRegister,
  updateCashRegister,
} from "@/modules/cash/services/cash.registers.mock-server";
import { mockUserProfiles, type UserProfileMock } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { PATCH } from "./route";

const ADMIN = "user-admin";
const SELLER = "user-seller";
const ACCOUNTANT = "user-accountant";

function patch(registerId: string, body: unknown) {
  return PATCH(
    new Request(`http://localhost/api/cash/registers/${registerId}`, {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", "x-demo-role": "admin" },
      method: "PATCH",
    }),
    { params: Promise.resolve({ id: registerId }) },
  );
}

async function expectAssignmentConflict(response: Response) {
  expect(response.status).toBe(409);
  expect((await response.json()).error).toEqual({
    code: "CONFLICT",
    message: CASH_REGISTER_ASSIGNMENT_CONFLICT_MESSAGE,
  });
}

async function expectAssigneeRejected(response: Response) {
  expect(response.status).toBe(400);
  expect((await response.json()).error).toEqual({
    code: "BAD_REQUEST",
    message: CASH_REGISTER_ASSIGNEE_MESSAGE,
  });
}

describe("PATCH /api/cash/registers/[id] · a quién se asigna la caja", () => {
  const originalDataSource = process.env.API_DATA_SOURCE;

  afterEach(() => {
    process.env.API_DATA_SOURCE = originalDataSource;
  });

  describe("mock", () => {
    let registerCount = 0;
    let registerId = "";
    const touched: Array<{ original: UserProfileMock; profile: UserProfileMock }> = [];

    function profile(id: string) {
      const found = mockUserProfiles.find((item) => item.id === id);

      if (!found) {
        throw new Error(`Falta el perfil mock ${id}`);
      }

      touched.push({ original: { ...found }, profile: found });

      return found;
    }

    beforeEach(() => {
      process.env.API_DATA_SOURCE = "mock";
      registerCount += 1;
      registerId = createCashRegister({ name: `Caja POS-F5 ${registerCount}` }, DEFAULT_STORE_ID).id;
    });

    afterEach(() => {
      for (const { original, profile: current } of touched.splice(0)) {
        current.grantedPermissions = original.grantedPermissions;
        current.deniedPermissions = original.deniedPermissions;
        current.isActive = original.isActive;
      }

      // Un usuario, una caja activa: se libera para el siguiente caso.
      updateCashRegister(registerId, { assignedUserId: null }, DEFAULT_STORE_ID);
    });

    it("acepta a un vendedor activo", async () => {
      const response = await patch(registerId, { assignedUserId: SELLER });

      expect(response.status).toBe(200);
      expect((await response.json()).data.assignedUserId).toBe(SELLER);
    });

    it("los usuarios demo por rol sin perfil mock valen por su rol", async () => {
      await expectAssigneeRejected(await patch(registerId, { assignedUserId: "user-contador" }));
      expect((await patch(registerId, { assignedUserId: "user-vendedor" })).status).toBe(200);
    });

    it("acepta al administrador con «El administrador puede vender» y lo rechaza apagado", async () => {
      await expectAssigneeRejected(await patch(registerId, { assignedUserId: ADMIN }));

      profile(ADMIN).grantedPermissions = [...adminSellPermissions];

      const response = await patch(registerId, { assignedUserId: ADMIN });

      expect(response.status).toBe(200);
      expect((await response.json()).data.assignedUserId).toBe(ADMIN);
    });

    it("acepta a un contador con cash.operate concedido y lo rechaza sin él", async () => {
      await expectAssigneeRejected(await patch(registerId, { assignedUserId: ACCOUNTANT }));

      profile(ACCOUNTANT).grantedPermissions = ["cash.operate"];

      expect((await patch(registerId, { assignedUserId: ACCOUNTANT })).status).toBe(200);
    });

    it("rechaza a un vendedor inactivo, a uno con cash.operate bloqueado y a quien no es de la tienda", async () => {
      profile(SELLER).isActive = false;
      await expectAssigneeRejected(await patch(registerId, { assignedUserId: SELLER }));

      const seller = profile(SELLER);
      seller.isActive = true;
      seller.deniedPermissions = ["cash.operate"];
      await expectAssigneeRejected(await patch(registerId, { assignedUserId: SELLER }));

      await expectAssigneeRejected(await patch(registerId, { assignedUserId: "no-existe" }));
    });

    it("apagar el interruptor no borra la asignación; desasignar y renombrar no se validan", async () => {
      const admin = profile(ADMIN);
      admin.grantedPermissions = [...adminSellPermissions];
      expect((await patch(registerId, { assignedUserId: ADMIN })).status).toBe(200);

      admin.grantedPermissions = undefined;

      const renamed = await patch(registerId, { name: `Caja POS-F5 renombrada ${registerCount}` });

      expect(renamed.status).toBe(200);
      expect((await renamed.json()).data.assignedUserId).toBe(ADMIN);
      expect((await patch(registerId, { assignedUserId: null })).status).toBe(200);
    });

    // POS-F7 (qa-final N1): un usuario, una caja activa; el 409 dice qué hacer.
    describe("un usuario, una caja activa (POS-F7)", () => {
      // Usuario demo por rol: no depende de los perfiles mock que tocan los casos de arriba.
      const DEMO_SELLER = "user-vendedor";
      let otherId = "";

      beforeEach(() => {
        otherId = createCashRegister({ name: `Caja POS-F7 ${registerCount}` }, DEFAULT_STORE_ID).id;
      });

      afterEach(() => {
        updateCashRegister(otherId, { assignedUserId: null }, DEFAULT_STORE_ID);
        updateCashRegister(registerId, { assignedUserId: null, isActive: true }, DEFAULT_STORE_ID);
      });

      it("asignar a quien ya tiene otra caja activa → 409 con el mensaje y sin cambios", async () => {
        expect((await patch(otherId, { assignedUserId: DEMO_SELLER })).status).toBe(200);

        const response = await patch(registerId, { assignedUserId: DEMO_SELLER, assignedUserName: "Vendedor" });

        expect(CASH_REGISTER_ASSIGNMENT_CONFLICT_MESSAGE).toBe(
          "Ese usuario ya tiene otra caja activa asignada. Desasígnala antes de asignarle esta.",
        );
        await expectAssignmentConflict(response);
        expect(updateCashRegister(registerId, {}, DEFAULT_STORE_ID).assignedUserId ?? null).toBeNull();
      });

      it("activar una caja cuyo usuario ya tiene otra activa → 409; inactiva sí se puede asignar", async () => {
        expect((await patch(otherId, { assignedUserId: DEMO_SELLER })).status).toBe(200);
        expect((await patch(registerId, { isActive: false })).status).toBe(200);
        expect((await patch(registerId, { assignedUserId: DEMO_SELLER })).status).toBe(200);

        await expectAssignmentConflict(await patch(registerId, { isActive: true }));
        expect(updateCashRegister(registerId, {}, DEFAULT_STORE_ID).isActive).toBe(false);

        expect((await patch(registerId, { assignedUserId: null, isActive: true })).status).toBe(200);
      });

      it("reenviar la asignación de la propia caja o renombrarla no choca consigo misma", async () => {
        expect((await patch(registerId, { assignedUserId: DEMO_SELLER })).status).toBe(200);
        expect((await patch(registerId, { assignedUserId: DEMO_SELLER })).status).toBe(200);
        expect((await patch(registerId, { name: `Caja POS-F7 propia ${registerCount}` })).status).toBe(200);
      });
    });
  });

  describe("supabase", () => {
    type ProfileRow = {
      denied_permissions: string[];
      granted_permissions: string[];
      is_active: boolean;
      role: string;
    };

    let profiles: Record<string, ProfileRow>;
    let updates: Array<Record<string, unknown>>;
    let updateError: { code: string; details?: string; message: string } | null;

    function mountSupabase() {
      (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
        from(table: string) {
          const filters: Record<string, unknown> = {};

          if (table === "profiles") {
            const query = {
              eq(column: string, value: unknown) {
                filters[column] = value;
                return query;
              },
              async maybeSingle() {
                const row = profiles[String(filters.id)];

                return {
                  data: row && filters.store_id === DEFAULT_STORE_ID ? row : null,
                  error: null,
                };
              },
              select: () => query,
            };

            return query;
          }

          let values: Record<string, unknown> = {};
          const query = {
            eq: () => query,
            async maybeSingle() {
              updates.push(values);

              if (updateError) {
                return { data: null, error: updateError };
              }

              return {
                data: {
                  assigned_user: null,
                  assigned_user_id: values.assigned_user_id ?? null,
                  created_at: "2026-10-10T08:00:00.000Z",
                  id: "reg-1",
                  is_active: true,
                  name: "Caja 1",
                  store_id: DEFAULT_STORE_ID,
                  updated_at: "2026-10-10T08:00:00.000Z",
                },
                error: null,
              };
            },
            select: () => query,
            update(next: Record<string, unknown>) {
              values = next;
              return query;
            },
          };

          return query;
        },
      });
    }

    beforeEach(() => {
      process.env.API_DATA_SOURCE = "supabase";
      updates = [];
      updateError = null;
      profiles = {
        "admin-apagado": { denied_permissions: [], granted_permissions: [], is_active: true, role: "admin" },
        "admin-vende": {
          denied_permissions: [],
          granted_permissions: [...adminSellPermissions],
          is_active: true,
          role: "admin",
        },
        almacen: { denied_permissions: [], granted_permissions: [], is_active: true, role: "almacen" },
        "vendedor-activo": { denied_permissions: [], granted_permissions: [], is_active: true, role: "vendedor" },
        "vendedor-inactivo": { denied_permissions: [], granted_permissions: [], is_active: false, role: "vendedor" },
      };
      mountSupabase();
    });

    it.each(["vendedor-activo", "admin-vende"])("asigna la caja a %s", async (userId) => {
      const response = await patch("reg-1", { assignedUserId: userId });

      expect(response.status).toBe(200);
      expect(updates).toEqual([{ assigned_user_id: userId }]);
    });

    it.each(["admin-apagado", "almacen", "vendedor-inactivo", "de-otra-tienda"])(
      "rechaza a %s con 400 y no escribe",
      async (userId) => {
        await expectAssigneeRejected(await patch("reg-1", { assignedUserId: userId }));
        expect(updates).toEqual([]);
      },
    );

    it("desasignar no consulta el perfil", async () => {
      profiles = {};

      expect((await patch("reg-1", { assignedUserId: null })).status).toBe(200);
      expect(updates).toEqual([{ assigned_user_id: null }]);
    });

    // POS-F7 (qa-final N1): el 23505 del índice de «una caja activa por usuario» se explica.
    it("el choque con cash_registers_one_active_assignment_per_store_idx → 409 con el mensaje, sin lecturas extra", async () => {
      updateError = {
        code: "23505",
        details: "Key (store_id, assigned_user_id)=(s, u) already exists.",
        message:
          'duplicate key value violates unique constraint "cash_registers_one_active_assignment_per_store_idx"',
      };

      await expectAssignmentConflict(await patch("reg-1", { assignedUserId: "vendedor-activo" }));
      expect(updates).toEqual([{ assigned_user_id: "vendedor-activo" }]);

      await expectAssignmentConflict(await patch("reg-1", { isActive: true }));
    });

    it("otro 23505 (nombre repetido) conserva el 409 genérico", async () => {
      updateError = {
        code: "23505",
        message: 'duplicate key value violates unique constraint "cash_registers_store_name_key"',
      };

      const response = await patch("reg-1", { name: "Caja 2" });

      expect(response.status).toBe(409);
      expect((await response.json()).error).toEqual({ code: "CONFLICT", message: "El recurso ya existe." });
    });
  });
});
