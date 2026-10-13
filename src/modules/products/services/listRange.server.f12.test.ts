/**
 * @jest-environment node
 *
 * PRO-F12 · una página más allá del total (`skip` > total) hacía que PostgREST
 * respondiera 416 / `PGRST103` "Requested range not satisfiable" y el BFF lo
 * devolvía como 500. No es un error: la lista responde vacía con el total real
 * (como el mock), y así la pantalla puede volver a la última página.
 */

jest.mock("../../../lib/supabase/route-client");

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { listCategories as listMockCategories } from "./categories.mock-server";
import { listCategories } from "./categories.server";
import { isRangeNotSatisfiable } from "./listRange";
import { listPriceReview as listMockPriceReview } from "./priceReview.mock-server";
import { listPriceReview } from "./priceReview.server";
import { listProducts as listMockProducts } from "./products.mock-server";
import { listProducts } from "./products.server";

const CATEGORY_ID = "11111111-1111-4111-8111-111111111111";

/** Lo que entrega `@supabase/postgrest-js` cuando PostgREST responde 416. */
const RANGE_ERROR = {
  count: null,
  data: null,
  error: {
    code: "PGRST103",
    details: "An offset of 50 was requested, but there are only 49 rows.",
    hint: null,
    message: "Requested range not satisfiable",
  },
  status: 416,
};

type QueryResult = { count: number | null; data: unknown[] | null; error: unknown; status: number };

/**
 * Cliente de Supabase de prueba. Cada `select` abre una consulta: la paginada
 * termina en `range` y la de conteo (`head: true`) se espera tal cual.
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

      for (const method of ["eq", "ilike", "is", "or", "order"]) {
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

const HEAD_49: QueryResult = { count: 49, data: null, error: null, status: 200 };
const PAGE_OK: QueryResult = { count: 49, data: [], error: null, status: 206 };

describe("isRangeNotSatisfiable (PRO-F12)", () => {
  it("reconoce el código PGRST103 y el estado 416", () => {
    expect(isRangeNotSatisfiable({ code: "PGRST103" }, 416)).toBe(true);
    expect(isRangeNotSatisfiable({ code: "PGRST103" }, undefined)).toBe(true);
    expect(isRangeNotSatisfiable({}, 416)).toBe(true);
  });

  it("no confunde otros errores ni una respuesta sin error", () => {
    expect(isRangeNotSatisfiable(null, 200)).toBe(false);
    expect(isRangeNotSatisfiable(null, 416)).toBe(false);
    expect(isRangeNotSatisfiable({ code: "42501" }, 403)).toBe(false);
    expect(isRangeNotSatisfiable({ code: "PGRST116" }, 406)).toBe(false);
  });
});

describe("listProducts · página más allá del total (PRO-F12)", () => {
  it("responde vacío con el total real en vez de un 500", async () => {
    const { queries } = installList(RANGE_ERROR, HEAD_49);

    const list = await listProducts(
      new URLSearchParams({ limit: "10", skip: "50" }),
      DEFAULT_STORE_ID,
    );

    expect(list).toEqual({ items: [], limit: 10, skip: 50, total: 49 });
    expect(queries.map((query) => query.head)).toEqual([false, true]);
  });

  it("cuenta con los mismos filtros que la consulta paginada", async () => {
    const { filtersOf } = installList(RANGE_ERROR, HEAD_49);

    await listProducts(
      new URLSearchParams({
        categoryId: CATEGORY_ID,
        isActive: "true",
        packLink: "none",
        search: "arroz",
        skip: "50",
      }),
      DEFAULT_STORE_ID,
    );

    expect(filtersOf(0)).toEqual(
      expect.arrayContaining([
        ["eq", "store_id", DEFAULT_STORE_ID],
        ["eq", "category_id", CATEGORY_ID],
        ["eq", "is_active", true],
        ["is", "pack_role.is_component", false],
      ]),
    );
    expect(filtersOf(1)).toEqual(filtersOf(0));
  });

  it("no hace la consulta de conteo cuando la página existe", async () => {
    const { queries } = installList(PAGE_OK, HEAD_49);

    const list = await listProducts(new URLSearchParams({ skip: "40" }), DEFAULT_STORE_ID);

    expect(list).toMatchObject({ items: [], skip: 40, total: 49 });
    expect(queries).toHaveLength(1);
  });

  it("otro error del listado sigue saliendo como error", async () => {
    const { queries } = installList(
      { count: null, data: null, error: { code: "42501", message: "permission denied" }, status: 403 },
      HEAD_49,
    );

    await expect(
      listProducts(new URLSearchParams({ skip: "50" }), DEFAULT_STORE_ID),
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(queries).toHaveLength(1);
  });

  it("un error en la consulta de conteo no se oculta", async () => {
    installList(RANGE_ERROR, {
      count: null,
      data: null,
      error: { code: "42501", message: "permission denied" },
      status: 403,
    });

    await expect(
      listProducts(new URLSearchParams({ skip: "50" }), DEFAULT_STORE_ID),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe("listPriceReview · página más allá del total (PRO-F12)", () => {
  it("responde vacío con el total real y cuenta con los mismos filtros", async () => {
    const { filtersOf, queries } = installList(RANGE_ERROR, { ...HEAD_49, count: 7 });

    const list = await listPriceReview(
      new URLSearchParams({ purchaseId: CATEGORY_ID, skip: "9990" }),
      DEFAULT_STORE_ID,
    );

    expect(list).toEqual({ items: [], limit: 10, skip: 9990, total: 7 });
    expect(queries.map((query) => query.head)).toEqual([false, true]);
    expect(filtersOf(0)).toEqual([
      ["eq", "store_id", DEFAULT_STORE_ID],
      ["eq", "purchase_id", CATEGORY_ID],
    ]);
    expect(filtersOf(1)).toEqual(filtersOf(0));
  });

  it("no hace la consulta de conteo cuando la página existe", async () => {
    const { queries } = installList(PAGE_OK, HEAD_49);

    await listPriceReview(new URLSearchParams(), DEFAULT_STORE_ID);

    expect(queries).toHaveLength(1);
  });
});

describe("listCategories · página más allá del total (PRO-F12)", () => {
  it("responde vacío con el total real y cuenta con los mismos filtros", async () => {
    const { filtersOf, queries } = installList(RANGE_ERROR, { ...HEAD_49, count: 25 });

    const list = await listCategories(
      new URLSearchParams({ limit: "100", search: "pan", skip: "200" }),
      DEFAULT_STORE_ID,
    );

    expect(list).toEqual({ items: [], limit: 100, skip: 200, total: 25 });
    expect(queries.map((query) => query.head)).toEqual([false, true]);
    expect(filtersOf(0)).toEqual([
      ["eq", "store_id", DEFAULT_STORE_ID],
      ["eq", "is_active", true],
      ["ilike", "name", "%pan%"],
    ]);
    expect(filtersOf(1)).toEqual(filtersOf(0));
  });

  it("no hace la consulta de conteo cuando la página existe", async () => {
    const { queries } = installList(PAGE_OK, HEAD_49);

    await listCategories(new URLSearchParams(), DEFAULT_STORE_ID);

    expect(queries).toHaveLength(1);
  });
});

describe("paridad con el mock · página más allá del total (PRO-F12)", () => {
  const beyond = new URLSearchParams({ limit: "10", skip: "99990" });

  it("productos: vacío con el total real", () => {
    const total = listMockProducts(new URLSearchParams(), DEFAULT_STORE_ID).total;

    expect(total).toBeGreaterThan(0);
    expect(listMockProducts(beyond, DEFAULT_STORE_ID)).toEqual({
      items: [],
      limit: 10,
      skip: 99990,
      total,
    });
  });

  it("cola Por revisar: vacío con el total real", () => {
    const total = listMockPriceReview(new URLSearchParams(), DEFAULT_STORE_ID).total;

    expect(listMockPriceReview(beyond, DEFAULT_STORE_ID)).toEqual({
      items: [],
      limit: 10,
      skip: 99990,
      total,
    });
  });

  it("categorías: vacío con el total real", () => {
    const total = listMockCategories(new URLSearchParams(), DEFAULT_STORE_ID).total;

    expect(total).toBeGreaterThan(0);
    expect(listMockCategories(beyond, DEFAULT_STORE_ID)).toEqual({
      items: [],
      limit: 10,
      skip: 99990,
      total,
    });
  });
});
