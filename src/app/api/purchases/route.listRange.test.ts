/**
 * @jest-environment node
 */
/**
 * COM-F7 (M2) · `GET /api/purchases?skip=999999` contra la base real: PostgREST
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
    permissions: ["purchases.view"],
    role: "admin",
    storeId: "00000000-0000-4000-8000-000000000001",
    userId: "user-admin",
  }),
}));

type QueryResult = { count: number | null; data: unknown[] | null; error: unknown; status: number };

/** La consulta paginada responde 416 y la de conteo (`head: true`), el total. */
function installRangeBeyondTotal(total: number) {
  const rangeResult: QueryResult = {
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
  const headResult: QueryResult = { count: total, data: null, error: null, status: 200 };

  const from = jest.fn(() => ({
    select: () => {
      const chain: Record<string, unknown> = {
        range: jest.fn().mockResolvedValue(rangeResult),
        then: (resolve: (value: QueryResult) => unknown) => resolve(headResult),
      };

      for (const method of ["eq", "gte", "ilike", "lt", "lte", "order"]) {
        chain[method] = () => chain;
      }

      return chain;
    },
  }));

  (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ from });
}

describe("GET /api/purchases · página más allá del total (COM-F7 M2)", () => {
  it.each(["skip=999999", "skip=999999&limit=20&status=pedido", "skip=2147483648"])(
    "%s → 200 con lista vacía y el total real",
    async (query) => {
      installRangeBeyondTotal(42);

      const response = await GET(new Request(`http://localhost/api/purchases?${query}`));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.items).toEqual([]);
      expect(body.data.total).toBe(42);
    },
  );
});
