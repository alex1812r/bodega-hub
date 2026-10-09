/**
 * @jest-environment node
 */

jest.mock("../../../lib/supabase/route-client");
jest.mock("../../../lib/supabase/admin-client");

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";

import { listPendingClosures } from "./cash.session.server";

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
