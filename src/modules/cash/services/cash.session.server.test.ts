/**
 * @jest-environment node
 */

jest.mock("../../../lib/supabase/route-client");
jest.mock("../../../lib/supabase/admin-client");

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";

import {
  getCashSessionOwner,
  getCurrentCashSession,
  listOpenCashSessions,
  listPendingClosures,
  openCashSession,
} from "./cash.session.server";
import { createCashSupabaseFake, type CashFakeState } from "./testing/cashSupabaseFake";

const STORE_ID = "00000000-0000-4000-8000-000000000001";

function closureRow(overrides: Record<string, unknown>) {
  return {
    cash_registers: { id: "reg-1", is_active: true, name: "Caja 1", store_id: STORE_ID },
    closed_at: "2026-08-20T23:00:00.000Z",
    closing_ref: "5.00",
    closing_ves: "1200.50",
    id: "session-1",
    opened_at: "2026-08-20T12:00:00.000Z",
    opening_ref: "0",
    opening_ves: "100.00",
    register_id: "reg-1",
    status: "closed",
    store_id: STORE_ID,
    vault_transferred_at: null,
    ...overrides,
  };
}

function mountClosures(rows: unknown[]) {
  const builder = {
    eq: () => builder,
    is: () => builder,
    order: () => Promise.resolve({ data: rows, error: null }),
    select: () => builder,
  };

  (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ from: () => builder });
}

describe("cash.session.server · teórico de un cierre (CNF-10, lectura)", () => {
  it("un cierre histórico sin teórico guardado lo expone como null, no como 0", async () => {
    mountClosures([
      closureRow({ theoretical_closing_ref: null, theoretical_closing_ves: null }),
      closureRow({ id: "session-2" }),
    ]);

    const closures = await listPendingClosures(STORE_ID);

    expect(closures.map((closure) => [closure.theoreticalClosingVes, closure.theoreticalClosingRef])).toEqual([
      [null, null],
      [null, null],
    ]);
    // Lo contado no cambia: es lo único que se transfiere al baúl.
    expect(closures[0]).toEqual(expect.objectContaining({ closingRef: 5, closingVes: 1200.5 }));
  });

  it("un teórico guardado, también si es 0, sigue llegando como número", async () => {
    mountClosures([
      closureRow({ theoretical_closing_ref: "0.00", theoretical_closing_ves: "1250.75" }),
    ]);

    const [closure] = await listPendingClosures(STORE_ID);

    expect(closure.theoreticalClosingVes).toBe(1250.75);
    expect(closure.theoreticalClosingRef).toBe(0);
  });
});

describe("cash.session.server · reglas de turno del que opera caja (POS-F3)", () => {
  const ADMIN = "admin-1";

  function openSession(id: string, registerId: string, openedAt: string, openedBy = ADMIN) {
    return {
      id,
      opened_at: openedAt,
      opened_by: openedBy,
      opening_ref: 0,
      opening_ves: 0,
      register_id: registerId,
      status: "open",
      store_id: STORE_ID,
    };
  }

  function register(id: string, assignedUserId: string | null) {
    return { assigned_user_id: assignedUserId, id, is_active: true, name: id, store_id: STORE_ID };
  }

  function mount(state: CashFakeState) {
    const fake = createCashSupabaseFake(state, { role: "admin", uid: ADMIN });
    (createRouteSupabaseClient as jest.Mock).mockResolvedValue(fake.client);

    return fake;
  }

  it("getCurrentCashSession devuelve el turno propio más reciente cuando hay más de uno", async () => {
    mount({
      registers: [],
      sessions: [
        openSession("s-1", "reg-1", "2026-10-10T08:00:00.000Z"),
        openSession("s-2", "reg-2", "2026-10-10T09:00:00.000Z"),
      ],
    });

    await expect(getCurrentCashSession(ADMIN, STORE_ID)).resolves.toEqual(
      expect.objectContaining({ id: "s-2" }),
    );
  });

  it("getCashSessionOwner dice quién abrió el turno y null si no existe en la tienda", async () => {
    mount({ registers: [], sessions: [openSession("s-1", "reg-1", "2026-10-10T08:00:00.000Z", "otro")] });

    await expect(getCashSessionOwner("s-1", STORE_ID)).resolves.toEqual({ openedBy: "otro" });
    await expect(getCashSessionOwner("s-1", "otra-tienda")).resolves.toBeNull();
    await expect(getCashSessionOwner("s-9", STORE_ID)).resolves.toBeNull();
  });

  it("listOpenCashSessions dice quién abrió cada turno (POS-F5: aviso al apagar «El administrador puede vender»)", async () => {
    mount({
      registers: [register("reg-1", "otro"), register("reg-2", null)],
      sessions: [
        openSession("s-1", "reg-1", "2026-10-10T08:00:00.000Z"),
        openSession("s-2", "reg-2", "2026-10-10T09:00:00.000Z", "vendedor-1"),
      ],
    });

    const sessions = await listOpenCashSessions(STORE_ID);

    expect(sessions.map((session) => [session.id, session.openedBy])).toEqual([
      ["s-1", ADMIN],
      ["s-2", "vendedor-1"],
    ]);
  });

  it("openCashSession rechaza la caja asignada a otro (403) y un segundo turno (409) sin llamar al RPC", async () => {
    const fake = mount({
      registers: [register("reg-mia", ADMIN), register("reg-ajena", "otro")],
      sessions: [openSession("s-1", "reg-vieja", "2026-10-10T08:00:00.000Z")],
    });

    await expect(openCashSession({ registerId: "reg-ajena" }, ADMIN, STORE_ID)).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403,
    });
    await expect(openCashSession({ registerId: "reg-mia" }, ADMIN, STORE_ID)).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
    });
    expect(fake.rpcCalls).toEqual([]);
  });

  it("openCashSession abre la caja asignada cuando no hay otro turno propio", async () => {
    const fake = mount({ registers: [register("reg-mia", ADMIN)], sessions: [] });

    await expect(openCashSession({ registerId: "reg-mia" }, ADMIN, STORE_ID)).resolves.toEqual(
      expect.objectContaining({ registerId: "reg-mia", status: "open" }),
    );
    expect(fake.rpcCalls.map((call) => call.name)).toEqual(["open_cash_session"]);
  });
});
