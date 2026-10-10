/**
 * @jest-environment node
 */

jest.mock("../../../lib/supabase/admin-client");
jest.mock("../../../lib/supabase/route-client");

import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";

import { listStores } from "./stores.server";

function createMockAdmin() {
  const result = { count: 0, data: [], error: null };
  const chain: Record<string, jest.Mock> = {
    eq: jest.fn(),
    in: jest.fn().mockResolvedValue({ data: [], error: null }),
    or: jest.fn(),
    order: jest.fn(),
    range: jest.fn().mockResolvedValue(result),
    select: jest.fn(),
  };

  chain.eq.mockReturnValue(chain);
  chain.or.mockReturnValue(chain);
  chain.order.mockReturnValue(chain);
  chain.select.mockReturnValue(chain);

  return { chain, client: { from: jest.fn(() => chain) } };
}

describe("stores.server · listStores (AUD-04)", () => {
  function setup() {
    const admin = createMockAdmin();
    (createAdminSupabaseClient as jest.Mock).mockReturnValue(admin.client);

    return admin.chain;
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("busca por nombre y slug", async () => {
    const chain = setup();

    await listStores(new URLSearchParams("search=luces"));

    expect(chain.or).toHaveBeenCalledWith("name.ilike.%luces%,slug.ilike.%luces%");
  });

  it.each([
    // Una coma cerraría el valor y añadiría otra condición al `or`.
    ["a,status.eq.paused", 'name.ilike."%a,status.eq.paused%",slug.ilike."%a,status.eq.paused%"'],
    // Un paréntesis rompe el `or=(…)` y PostgREST responde 400 → 500 del BFF.
    ["bodega (centro)", 'name.ilike."%bodega (centro)%",slug.ilike."%bodega (centro)%"'],
    // Comillas, barras y comodines no llegan como sintaxis.
    ['a"b\\c%d_e*f', "name.ilike.%a_b_c_d_e_f%,slug.ilike.%a_b_c_d_e_f%"],
  ])("el término %s viaja como texto, no como sintaxis de PostgREST", async (search, expected) => {
    const chain = setup();

    await listStores(new URLSearchParams({ search }));

    expect(chain.or).toHaveBeenCalledWith(expected);
  });

  it("sin término no añade el filtro", async () => {
    const chain = setup();

    await listStores(new URLSearchParams("search=%20%20"));

    expect(chain.or).not.toHaveBeenCalled();
  });
});
