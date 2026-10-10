/** @jest-environment node */
/**
 * POS-F3 (caos pos-nav F2/F3): con «El administrador puede vender» encendido el
 * admin cerraba el turno de OTRO usuario (200) y, con dos turnos propios abiertos
 * y el interruptor apagado, no podía cerrar ninguno (404). Cada quien cierra solo
 * el turno que abrió, y la pertenencia se decide por el `sessionId`.
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
import { openCashSession } from "@/modules/cash/services/cash.session.mock-server";
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

function close(role: CashFakeCaller["role"], sessionId: string) {
  return POST(
    new Request("http://localhost/api/cash/session/close", {
      body: JSON.stringify({ closingRef: 0, closingVes: 0, sessionId }),
      headers: { "content-type": "application/json", "x-demo-role": role },
      method: "POST",
    }),
  );
}

function sessionRow(id: string, registerId: string, openedBy: string, status = "open") {
  return {
    id,
    opened_at: `2026-10-10T1${id.length % 10}:00:00.000Z`,
    opened_by: openedBy,
    opening_ref: 0,
    opening_ves: 0,
    register_id: registerId,
    status,
    store_id: DEFAULT_STORE_ID,
  };
}

function registerRow(id: string, assignedUserId: string | null) {
  return { assigned_user_id: assignedUserId, id, is_active: true, name: id, store_id: DEFAULT_STORE_ID };
}

describe("POST /api/cash/session/close · pertenencia del turno", () => {
  const originalDataSource = process.env.API_DATA_SOURCE;

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
        registers: [registerRow("reg-admin", ADMIN), registerRow("reg-seller", SELLER)],
        sessions: [
          sessionRow("own-a", "reg-admin", ADMIN),
          sessionRow("own-bb", "reg-extra", ADMIN),
          sessionRow("seller", "reg-seller", SELLER),
          sessionRow("closed", "reg-admin", ADMIN, "closed"),
        ],
      };
    });

    it("F3: el admin que vende NO cierra el turno abierto por otro usuario (403, sin llamar al RPC)", async () => {
      setAdminCanSell(true);
      const fake = mount("admin");

      const response = await close("admin", "seller");

      expect(response.status).toBe(403);
      expect((await response.json()).error.code).toBe("FORBIDDEN");
      expect(fake.rpcCalls).toEqual([]);
      expect(state.sessions.find((session) => session.id === "seller")?.status).toBe("open");
    });

    it.each([true, false])(
      "F2: con dos turnos propios abiertos (interruptor %s) cierra ambos, uno a uno",
      async (enabled) => {
        setAdminCanSell(enabled);
        mount("admin");

        expect((await close("admin", "own-a")).status).toBe(200);
        expect((await close("admin", "own-bb")).status).toBe(200);
        expect(state.sessions.filter((session) => session.status === "open").map((s) => s.id)).toEqual([
          "seller",
        ]);
      },
    );

    it("con solo cash.manage tampoco cierra un turno ajeno (403)", async () => {
      const fake = mount("admin");

      expect((await close("admin", "seller")).status).toBe(403);
      expect(fake.rpcCalls).toEqual([]);
    });

    it("un turno inexistente responde 404 sin llamar al RPC", async () => {
      setAdminCanSell(true);
      const fake = mount("admin");

      const response = await close("admin", "no-existe");

      expect(response.status).toBe(404);
      expect((await response.json()).error.code).toBe("NOT_FOUND");
      expect(fake.rpcCalls).toEqual([]);
    });

    it("un turno propio ya cerrado conserva el rechazo del RPC (400)", async () => {
      setAdminCanSell(true);
      mount("admin");

      const response = await close("admin", "closed");

      expect(response.status).toBe(400);
      expect((await response.json()).error.message).toBe("La sesión de caja ya está cerrada");
    });

    it("el vendedor sigue cerrando su turno (200) y no el de otro", async () => {
      mount("vendedor");

      expect((await close("vendedor", "seller")).status).toBe(200);
      expect((await close("vendedor", "own-a")).status).toBe(404);
    });
  });

  describe("mock", () => {
    beforeEach(() => {
      process.env.API_DATA_SOURCE = "mock";
    });

    it("el admin que vende cierra su turno y no el del vendedor; uno inexistente → 404", async () => {
      setAdminCanSell(true);
      const adminRegister = createCashRegister({ name: "Caja admin cierre" }, DEFAULT_STORE_ID);
      const sellerRegister = createCashRegister({ name: "Caja vendedor cierre" }, DEFAULT_STORE_ID);
      updateCashRegister(adminRegister.id, { assignedUserId: ADMIN }, DEFAULT_STORE_ID);
      updateCashRegister(sellerRegister.id, { assignedUserId: SELLER }, DEFAULT_STORE_ID);
      const own = openCashSession({ registerId: adminRegister.id }, ADMIN, DEFAULT_STORE_ID);
      const foreign = openCashSession({ registerId: sellerRegister.id }, SELLER, DEFAULT_STORE_ID);

      expect((await close("admin", foreign.id)).status).toBe(403);
      expect(foreign.status).toBe("open");
      expect((await close("admin", "no-existe")).status).toBe(404);
      expect((await close("admin", own.id)).status).toBe(200);
      expect((await close("vendedor", foreign.id)).status).toBe(200);
    });
  });
});
