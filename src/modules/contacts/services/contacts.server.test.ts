/**
 * @jest-environment node
 */

jest.mock("../../../lib/supabase/route-client");

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";

import { createContact, listContacts } from "./contacts.server";

type QueryResult = {
  count?: number | null;
  data?: unknown;
  error?: unknown;
};

function createMockSupabase(result: QueryResult) {
  const terminal = {
    range: jest.fn().mockResolvedValue(result),
    single: jest.fn().mockResolvedValue(result),
  };

  const chain: Record<string, jest.Mock> = {
    eq: jest.fn(),
    in: jest.fn(),
    insert: jest.fn(),
    or: jest.fn(),
    order: jest.fn(),
    select: jest.fn(),
    update: jest.fn(),
    ...terminal,
  };

  chain.eq.mockReturnValue(chain);
  chain.in.mockReturnValue(chain);
  chain.insert.mockReturnValue(chain);
  chain.or.mockReturnValue(chain);
  chain.select.mockReturnValue(chain);
  chain.update.mockReturnValue(chain);
  chain.order.mockReturnValue(terminal);

  return {
    from: jest.fn(() => chain),
    rpc: jest.fn(),
  };
}

describe("contacts.server", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("lists contacts with pagination", async () => {
    const supabase = createMockSupabase({
      count: 1,
      data: [
        {
          address: "Av. Principal",
          email: "cliente@example.com",
          id: "11111111-1111-4111-8111-111111111111",
          is_active: true,
          name: "Cliente Demo",
          phone: "0412-0000001",
          tax_id: "J-00000001-1",
          type: "cliente",
        },
      ],
      error: null,
    });
    (createRouteSupabaseClient as jest.Mock).mockResolvedValue(supabase);

    const result = await listContacts(new URLSearchParams("skip=0&limit=10"));

    expect(result.total).toBe(1);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        id: "11111111-1111-4111-8111-111111111111",
        name: "Cliente Demo",
        taxId: "J-00000001-1",
        type: "cliente",
      }),
    );
  });

  it("maps duplicate tax id to conflict", async () => {
    const supabase = createMockSupabase({
      data: null,
      error: { code: "23505", message: "duplicate key value violates unique constraint" },
    });
    (createRouteSupabaseClient as jest.Mock).mockResolvedValue(supabase);

    await expect(
      createContact({
        name: "Duplicado",
        taxId: "J-00000001-1",
        type: "cliente",
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
    });
  });
});
