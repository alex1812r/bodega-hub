/**
 * @jest-environment node
 */
/**
 * POS-H2 · `GET /api/contacts?skip=999999` contra la base real: PostgREST
 * responde 416 / `PGRST103` y la ruta devolvía 500 "Requested range not
 * satisfiable". Debe responder 200 con `items: []` y el total real.
 */

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";

import { GET } from "./route";

jest.mock("../../../lib/supabase/route-client");
jest.mock("../../../lib/api/dataSource", () => ({
  resolveDataSource: jest.fn(() => "supabase"),
}));
jest.mock("../../../lib/api/requirePermission", () => ({
  requireStorePermission: jest.fn().mockResolvedValue({
    isSuperadmin: false,
    permissions: ["contacts.view"],
    role: "admin",
    storeId: "00000000-0000-4000-8000-000000000001",
    userId: "user-admin",
  }),
}));

type QueryResult = { count: number | null; data: unknown[] | null; error: unknown; status: number };

/** La consulta paginada responde `rangeResult` y la de conteo (`head: true`), el total. */
function installContacts(rangeResult: QueryResult, total: number) {
  const headResult: QueryResult = { count: total, data: null, error: null, status: 200 };
  const selects: boolean[] = [];

  const from = jest.fn(() => ({
    select: (_columns: string, options?: { head?: boolean }) => {
      selects.push(options?.head === true);

      const chain: Record<string, unknown> = {
        range: jest.fn().mockResolvedValue(rangeResult),
        then: (resolve: (value: QueryResult) => unknown) => resolve(headResult),
      };

      for (const method of ["eq", "in", "or", "order"]) {
        chain[method] = () => chain;
      }

      return chain;
    },
  }));

  (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ from });

  return selects;
}

function rangeBeyondTotal(total: number): QueryResult {
  return {
    count: null,
    data: null,
    error: {
      code: "PGRST103",
      details: `An offset of 999999 was requested, but there are only ${total} rows.`,
      hint: null,
      message: "Requested range not satisfiable",
    },
    status: 416,
  };
}

describe("GET /api/contacts · página más allá del total (POS-H2)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each(["skip=999999", "skip=999999&limit=20&type=cliente&search=ana", "skip=2147483648"])(
    "%s → 200 con lista vacía y el total real",
    async (query) => {
      const selects = installContacts(rangeBeyondTotal(42), 42);

      const response = await GET(new Request(`http://localhost/api/contacts?${query}`));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.items).toEqual([]);
      expect(body.data.total).toBe(42);
      expect(body.data.skip).toBe(Number(new URLSearchParams(query).get("skip")));
      // La página y, solo por el 416, el conteo.
      expect(selects).toEqual([false, true]);
    },
  );

  it("una página normal hace una sola consulta", async () => {
    const selects = installContacts({ count: 0, data: [], error: null, status: 200 }, 0);

    const response = await GET(new Request("http://localhost/api/contacts?skip=0"));

    expect(response.status).toBe(200);
    expect(selects).toEqual([false]);
  });

  it("otro error de la base sigue respondiendo como error", async () => {
    installContacts(
      { count: null, data: null, error: { code: "XX000", message: "boom" }, status: 500 },
      42,
    );

    const response = await GET(new Request("http://localhost/api/contacts?skip=0"));

    expect(response.status).toBe(500);
  });
});
