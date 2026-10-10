/** @jest-environment node */
/**
 * POS-F3 (caos pos-nav F2): con «El administrador puede vender» encendido el admin
 * abría varios turnos a la vez, también en la caja asignada a un vendedor
 * (`open_cash_session` solo exige caja asignada al rol vendedor). El BFF aplica al
 * admin la regla del vendedor: solo su caja asignada y un turno abierto a la vez.
 */

jest.mock("../../../../../lib/supabase/route-client", () => ({
  createRouteSupabaseClient: jest.fn(),
}));

import { adminSellPermissions } from "@bodega/core";

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import {
  createCashRegister,
  updateCashRegister,
} from "@/modules/cash/services/cash.registers.mock-server";
import {
  CASH_REGISTER_NOT_ASSIGNED_MESSAGE,
  CASH_SESSION_ALREADY_OPEN_MESSAGE,
} from "@/modules/cash/services/cash.session.mock-server";
import {
  createCashSupabaseFake,
  type CashFakeCaller,
  type CashFakeState,
} from "@/modules/cash/services/testing/cashSupabaseFake";
import { mockUserProfiles } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { POST } from "./route";

const ADMIN = "user-admin";
const SELLER = "user-vendedor";

function setAdminCanSell(enabled: boolean) {
  const admin = mockUserProfiles.find((profile) => profile.id === ADMIN);

  if (!admin) {
    throw new Error("Falta el perfil mock user-admin");
  }

  admin.grantedPermissions = enabled ? [...adminSellPermissions] : undefined;
}

function open(role: CashFakeCaller["role"], registerId: string) {
  return POST(
    new Request("http://localhost/api/cash/session/open", {
      body: JSON.stringify({ openingRef: 0, openingVes: 0, registerId }),
      headers: { "content-type": "application/json", "x-demo-role": role },
      method: "POST",
    }),
  );
}

function registerRow(id: string, assignedUserId: string | null) {
  return { assigned_user_id: assignedUserId, id, is_active: true, name: id, store_id: DEFAULT_STORE_ID };
}

describe("POST /api/cash/session/open · caja asignada y un turno a la vez", () => {
  const originalDataSource = process.env.API_DATA_SOURCE;

  beforeEach(() => setAdminCanSell(true));

  afterEach(() => {
    setAdminCanSell(false);
    process.env.API_DATA_SOURCE = originalDataSource;
  });

  describe("supabase", () => {
    let state: CashFakeState;

    function mount(role: CashFakeCaller["role"]) {
      const fake = createCashSupabaseFake(state, { role, uid: role === "admin" ? ADMIN : SELLER });
      (createRouteSupabaseClient as jest.Mock).mockResolvedValue(fake.client);

      return fake;
    }

    beforeEach(() => {
      process.env.API_DATA_SOURCE = "supabase";
      state = {
        registers: [
          registerRow("reg-admin", ADMIN),
          registerRow("reg-seller", SELLER),
          registerRow("reg-libre", null),
        ],
        sessions: [],
      };
    });

    it("F2: el admin abre su caja y ya no puede abrir la del vendedor ni una sin asignar (403)", async () => {
      const fake = mount("admin");

      expect((await open("admin", "reg-admin")).status).toBe(201);

      for (const registerId of ["reg-seller", "reg-libre"]) {
        const response = await open("admin", registerId);

        expect(response.status).toBe(403);
        expect((await response.json()).error).toEqual({
          code: "FORBIDDEN",
          message: CASH_REGISTER_NOT_ASSIGNED_MESSAGE,
        });
      }

      expect(fake.rpcCalls).toHaveLength(1);
      expect(state.sessions).toHaveLength(1);
    });

    it("F2: con un turno propio abierto en otra caja no abre un segundo (409)", async () => {
      state.sessions.push({
        id: "heredada",
        opened_at: "2026-10-10T08:00:00.000Z",
        opened_by: ADMIN,
        register_id: "reg-vieja",
        status: "open",
        store_id: DEFAULT_STORE_ID,
      });
      const fake = mount("admin");

      const response = await open("admin", "reg-admin");

      expect(response.status).toBe(409);
      expect((await response.json()).error).toEqual({
        code: "CONFLICT",
        message: CASH_SESSION_ALREADY_OPEN_MESSAGE,
      });
      expect(fake.rpcCalls).toEqual([]);
    });

    it("reabrir la misma caja conserva el rechazo del RPC (400)", async () => {
      mount("admin");

      expect((await open("admin", "reg-admin")).status).toBe(201);

      const response = await open("admin", "reg-admin");

      expect(response.status).toBe(400);
      expect((await response.json()).error.message).toBe("La caja ya tiene una sesión abierta");
    });

    it("el vendedor no cambia: abre su caja (201) y la ajena la rechaza el RPC (400)", async () => {
      mount("vendedor");

      const foreign = await open("vendedor", "reg-admin");

      expect(foreign.status).toBe(400);
      expect((await foreign.json()).error.message).toBe("La caja no está asignada al vendedor actual");
      expect((await open("vendedor", "reg-seller")).status).toBe(201);
      expect((await open("vendedor", "reg-seller")).status).toBe(400);
    });
  });

  describe("mock", () => {
    beforeEach(() => {
      process.env.API_DATA_SOURCE = "mock";
    });

    it("el admin abre solo su caja asignada y un turno a la vez", async () => {
      const adminRegister = createCashRegister({ name: "Caja admin apertura" }, DEFAULT_STORE_ID);
      const sellerRegister = createCashRegister({ name: "Caja vendedor apertura" }, DEFAULT_STORE_ID);
      const spare = createCashRegister({ name: "Caja segunda apertura" }, DEFAULT_STORE_ID);
      updateCashRegister(adminRegister.id, { assignedUserId: ADMIN }, DEFAULT_STORE_ID);
      updateCashRegister(sellerRegister.id, { assignedUserId: SELLER }, DEFAULT_STORE_ID);

      expect((await open("admin", sellerRegister.id)).status).toBe(403);
      expect((await open("admin", adminRegister.id)).status).toBe(201);
      expect((await open("admin", adminRegister.id)).status).toBe(400);

      // Caja reasignada con el turno anterior todavía abierto.
      updateCashRegister(adminRegister.id, { assignedUserId: null }, DEFAULT_STORE_ID);
      updateCashRegister(spare.id, { assignedUserId: ADMIN }, DEFAULT_STORE_ID);

      const second = await open("admin", spare.id);

      expect(second.status).toBe(409);
      expect((await second.json()).error.code).toBe("CONFLICT");
    });
  });
});
