/**
 * @jest-environment node
 */

jest.mock("../../../lib/supabase/route-client");

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

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

    const result = await listContacts(new URLSearchParams("skip=0&limit=10"), DEFAULT_STORE_ID);

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

  describe("isActive filter (parity with the mock)", () => {
    function setup() {
      const supabase = createMockSupabase({ count: 0, data: [], error: null });
      (createRouteSupabaseClient as jest.Mock).mockResolvedValue(supabase);

      return supabase.from() as Record<string, jest.Mock>;
    }

    it.each([
      ["true", true],
      ["false", false],
    ])("filters by is_active when isActive=%s", async (value, expected) => {
      const chain = setup();

      await listContacts(new URLSearchParams(`isActive=${value}`), DEFAULT_STORE_ID);

      expect(chain.eq).toHaveBeenCalledWith("store_id", DEFAULT_STORE_ID);
      expect(chain.eq).toHaveBeenCalledWith("is_active", expected);
    });

    it.each(["", "isActive="])("does not filter by is_active for query [%s]", async (queryString) => {
      const chain = setup();

      await listContacts(new URLSearchParams(queryString), DEFAULT_STORE_ID);

      expect(chain.eq).toHaveBeenCalledTimes(1);
      expect(chain.eq).toHaveBeenCalledWith("store_id", DEFAULT_STORE_ID);
      expect(chain.range).toHaveBeenCalledTimes(1);
    });

    it("combines isActive with type and search", async () => {
      const chain = setup();

      await listContacts(
        new URLSearchParams("isActive=true&type=proveedor&search=lago"),
        DEFAULT_STORE_ID,
      );

      expect(chain.eq).toHaveBeenCalledWith("is_active", true);
      expect(chain.in).toHaveBeenCalledWith("type", ["proveedor", "ambos"]);
      expect(chain.or).toHaveBeenCalledWith(expect.stringContaining("name.ilike.%lago%"));
    });

    it("returns an empty page for a value the mock would not match", async () => {
      const chain = setup();

      const result = await listContacts(new URLSearchParams("isActive=TRUE"), DEFAULT_STORE_ID);

      expect(result).toEqual(expect.objectContaining({ items: [], total: 0 }));
      expect(chain.range).not.toHaveBeenCalled();
    });
  });

  it("maps duplicate tax id to conflict", async () => {
    const supabase = createMockSupabase({
      data: null,
      error: { code: "23505", message: "duplicate key value violates unique constraint" },
    });
    (createRouteSupabaseClient as jest.Mock).mockResolvedValue(supabase);

    await expect(
      createContact(
        {
          name: "Duplicado",
          taxId: "J-00000001-1",
          type: "cliente",
        },
        DEFAULT_STORE_ID,
      ),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
    });
  });
});
