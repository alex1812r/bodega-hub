/** @jest-environment node */
/**
 * POS-F3 (caos pos-nav F2): con dos turnos propios abiertos (estado heredado)
 * `GET /api/cash/session` respondía 404 y la pantalla no ofrecía cerrarlos.
 */

jest.mock("../../../../lib/supabase/route-client", () => ({
  createRouteSupabaseClient: jest.fn(),
}));

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import {
  createCashSupabaseFake,
  type CashFakeState,
} from "@/modules/cash/services/testing/cashSupabaseFake";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { GET } from "./route";

const ADMIN = "user-admin";

function sessionRow(id: string, openedAt: string, openedBy = ADMIN) {
  return {
    id,
    opened_at: openedAt,
    opened_by: openedBy,
    opening_ref: 0,
    opening_ves: 0,
    register_id: `reg-${id}`,
    status: "open",
    store_id: DEFAULT_STORE_ID,
  };
}

function get(state: CashFakeState) {
  (createRouteSupabaseClient as jest.Mock).mockResolvedValue(
    createCashSupabaseFake(state, { role: "admin", uid: ADMIN }).client,
  );

  return GET(new Request("http://localhost/api/cash/session", { headers: { "x-demo-role": "admin" } }));
}

describe("GET /api/cash/session (supabase)", () => {
  const originalDataSource = process.env.API_DATA_SOURCE;

  beforeEach(() => {
    process.env.API_DATA_SOURCE = "supabase";
  });

  afterEach(() => {
    process.env.API_DATA_SOURCE = originalDataSource;
  });

  it("con dos turnos propios abiertos devuelve el más reciente, no 404", async () => {
    const response = await get({
      registers: [],
      sessions: [
        sessionRow("vieja", "2026-10-10T08:00:00.000Z"),
        sessionRow("nueva", "2026-10-10T09:00:00.000Z"),
        sessionRow("ajena", "2026-10-10T10:00:00.000Z", "user-vendedor"),
      ],
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.id).toBe("nueva");
    expect(body.data.liveTotals).toEqual(expect.any(Object));
  });

  it("sin turno abierto devuelve null", async () => {
    const response = await get({ registers: [], sessions: [] });

    expect(response.status).toBe(200);
    expect((await response.json()).data).toBeNull();
  });
});
