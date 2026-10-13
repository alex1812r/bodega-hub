/**
 * @jest-environment node
 */
/**
 * COM-F7 (M2) · `GET /api/purchases?skip=999999`: una página más allá del total
 * hacía que PostgREST respondiera 416 / `PGRST103` "Requested range not
 * satisfiable" y el BFF lo devolvía como 500. No es un error: la lista responde
 * vacía con el total real, contando con los mismos filtros.
 */

jest.mock("../../../lib/supabase/route-client");

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { listPurchases } from "./purchases.server";

type QueryResult = { count: number | null; data: unknown[] | null; error: unknown; status: number };

/** Lo que entrega `@supabase/postgrest-js` cuando PostgREST responde 416. */
const RANGE_ERROR: QueryResult = {
  count: null,
  data: null,
  error: {
    code: "PGRST103",
    details: "An offset of 999999 was requested, but there are only 7 rows.",
    hint: null,
    message: "Requested range not satisfiable",
  },
  status: 416,
};

/**
 * Cada `select` abre una consulta: la paginada termina en `range` y la de conteo
 * (`head: true`) se espera tal cual.
 */
function installList(rangeResult: QueryResult, headResult: QueryResult) {
  const queries: { calls: [string, ...unknown[]][]; head: boolean }[] = [];
  const range = jest.fn().mockResolvedValue(rangeResult);

  const from = jest.fn(() => ({
    select: (_columns: string, options?: { count?: string; head?: boolean }) => {
      const query = { calls: [] as [string, ...unknown[]][], head: options?.head === true };
      const chain: Record<string, unknown> = {
        range,
        then: (resolve: (value: QueryResult) => unknown) => resolve(headResult),
      };

      for (const method of ["eq", "gte", "ilike", "lt", "lte", "order"]) {
        chain[method] = (...args: unknown[]) => {
          query.calls.push([method, ...args]);
          return chain;
        };
      }

      queries.push(query);

      return chain;
    },
  }));

  (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ from });

  /** Filtros (sin el orden) de una consulta. */
  const filtersOf = (index: number) =>
    queries[index].calls.filter(([method]) => method !== "order");

  return { filtersOf, queries, range };
}

describe("purchases.server · listPurchases · página más allá del total (COM-F7 M2)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("responde vacío con el total real en vez de un 500", async () => {
    const { queries, range } = installList(RANGE_ERROR, {
      count: 7,
      data: null,
      error: null,
      status: 200,
    });

    const list = await listPurchases(
      new URLSearchParams({ limit: "10", skip: "999999" }),
      DEFAULT_STORE_ID,
    );

    expect(list).toEqual({ items: [], limit: 10, skip: 999999, total: 7 });
    expect(range).toHaveBeenCalledWith(999999, 1000008);
    expect(queries.map((query) => query.head)).toEqual([false, true]);
  });

  it("cuenta con los mismos filtros que la consulta paginada", async () => {
    const { filtersOf } = installList(RANGE_ERROR, {
      count: 3,
      data: null,
      error: null,
      status: 200,
    });

    const list = await listPurchases(
      new URLSearchParams({
        from: "2026-05-17",
        limit: "20",
        search: "C-20",
        skip: "999999",
        status: "pedido",
        supplierId: "supplier-1",
      }),
      DEFAULT_STORE_ID,
    );

    expect(list.total).toBe(3);
    expect(filtersOf(0).length).toBeGreaterThanOrEqual(5);
    expect(filtersOf(1)).toEqual(filtersOf(0));
  });

  it("otro error de la consulta paginada se sigue propagando", async () => {
    installList(
      { count: null, data: null, error: { code: "XX000", message: "boom" }, status: 500 },
      { count: 7, data: null, error: null, status: 200 },
    );

    await expect(
      listPurchases(new URLSearchParams({ skip: "999999" }), DEFAULT_STORE_ID),
    ).rejects.toBeDefined();
  });

  it("un error al contar se propaga", async () => {
    installList(RANGE_ERROR, {
      count: null,
      data: null,
      error: { code: "XX000", message: "boom" },
      status: 500,
    });

    await expect(
      listPurchases(new URLSearchParams({ skip: "999999" }), DEFAULT_STORE_ID),
    ).rejects.toBeDefined();
  });
});
