/**
 * @jest-environment node
 */
/**
 * INV-01a · `listInventory` sobre la vista `inventory_overview`: filtros y
 * paginación en la consulta, página más allá del total y descuadre solo admin.
 */

jest.mock("../../../lib/supabase/route-client");

import { ApiError } from "@/lib/api/apiError";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { listInventory } from "./inventory.server";

type QueryResult = { count?: number | null; data?: unknown; error?: unknown; status?: number };
type Call = { args: unknown[]; method: string };

const CABLE_ID = "22222222-2222-4222-8222-222222222222";
const DRILL_ID = "44444444-4444-4444-8444-444444444444";
const CATEGORY_ID = "33333333-3333-4333-8333-333333333333";

const cableRow = {
  barcode: null,
  category: { id: CATEGORY_ID, is_active: true, name: "Electricidad" },
  category_id: CATEGORY_ID,
  current_cost_ref: "5.00",
  current_stock: 4,
  entries_30d: 10,
  exits_30d: 6,
  id: CABLE_ID,
  image_url: null,
  is_active: true,
  last_movement_at: "2026-10-01T15:00:00.000Z",
  last_movement_type: "venta",
  min_stock: 10,
  name: "Cable HDMI",
  sale_price_ref: "12.00",
  sku: "ELE-CAB-001",
  stock_status: "low",
};

const drillRow = {
  ...cableRow,
  current_stock: 18,
  entries_30d: 0,
  exits_30d: 0,
  id: DRILL_ID,
  last_movement_at: null,
  last_movement_type: null,
  name: "Taladro",
  sku: "HER-TAL-001",
  stock_status: "ok",
};

/** Consulta simulada: registra cada llamada encadenada y resuelve con `result`. */
function createQuery(result: QueryResult) {
  const calls: Call[] = [];
  const query: Record<string, unknown> = { calls, table: null };

  for (const method of ["select", "eq", "in", "or", "gte", "lte", "order", "range"]) {
    query[method] = (...args: unknown[]) => {
      calls.push({ args, method });
      return query;
    };
  }

  query.then = (resolve: (value: QueryResult) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);

  return query as { calls: Call[]; table: string | null };
}

/**
 * Cliente Supabase simulado: cada `from()` consume la siguiente consulta, en
 * orden. `table` queda en `null` en las que el servicio no llegó a usar.
 */
function mockSupabase(results: QueryResult[]) {
  const queries = results.map(createQuery);
  let used = 0;

  (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
    from: (table: string) => {
      const query = queries[used];

      if (!query) {
        throw new Error(`Consulta inesperada a ${table}`);
      }

      used += 1;
      query.table = table;
      return query;
    },
  });

  return queries;
}

function callsOf(query: { calls: Call[] }, method: string) {
  return query.calls.filter((call) => call.method === method).map((call) => call.args);
}

function list(queryString: string, role?: "admin" | "almacen" | "vendedor" | "contador") {
  return listInventory(new URLSearchParams(queryString), DEFAULT_STORE_ID, { role });
}

describe("inventory.server · listInventory (vista inventory_overview)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("lee la vista con conteo exacto, solo activos de la tienda, orden estable y rango", async () => {
    const [query] = mockSupabase([{ count: 37, data: [cableRow, drillRow], error: null }]);

    const result = await list("skip=20&limit=10");

    expect(query.table).toBe("inventory_overview");
    expect(callsOf(query, "select")[0][1]).toEqual({ count: "exact" });
    expect(callsOf(query, "eq")).toEqual([
      ["store_id", DEFAULT_STORE_ID],
      ["is_active", true],
    ]);
    expect(callsOf(query, "order")).toEqual([
      ["name", { ascending: true }],
      ["id", { ascending: true }],
    ]);
    expect(callsOf(query, "range")).toEqual([[20, 29]]);
    expect(result).toMatchObject({ limit: 10, skip: 20, total: 37 });
  });

  it("devuelve el producto con su categoría y las cifras del libro", async () => {
    mockSupabase([{ count: 2, data: [cableRow, drillRow], error: null }]);

    const result = await list("");

    expect(result.items[0]).toEqual(
      expect.objectContaining({
        category: expect.objectContaining({ id: CATEGORY_ID, name: "Electricidad" }),
        currentCostRef: 5,
        currentStock: 4,
        entries30d: 10,
        exits30d: 6,
        id: CABLE_ID,
        lastMovementAt: "2026-10-01T15:00:00.000Z",
        lastMovementType: "venta",
        minStock: 10,
        salePriceRef: 12,
        sku: "ele-cab-001",
        stockStatus: "low",
      }),
    );
    expect(result.items[1]).toEqual(
      expect.objectContaining({
        entries30d: 0,
        exits30d: 0,
        lastMovementAt: null,
        lastMovementType: null,
        stockStatus: "ok",
      }),
    );
  });

  it("aplica todos los filtros en la consulta", async () => {
    const [query] = mockSupabase([{ count: 1, data: [cableRow], error: null }]);

    await list(
      `search=cable&categoryId=${CATEGORY_ID}&productId=${CABLE_ID}&stockStatus=low,out&minPriceRef=2&maxPriceRef=20`,
    );

    expect(callsOf(query, "eq")).toEqual(
      expect.arrayContaining([
        ["id", CABLE_ID],
        ["category_id", CATEGORY_ID],
      ]),
    );
    expect(callsOf(query, "or")).toEqual([
      ["name.ilike.%cable%,sku.ilike.%cable%,barcode.ilike.%cable%"],
    ]);
    expect(callsOf(query, "in")).toEqual([["stock_status", ["low", "out"]]]);
    expect(callsOf(query, "gte")).toEqual([["sale_price_ref", 2]]);
    expect(callsOf(query, "lte")).toEqual([["sale_price_ref", 20]]);
  });

  it("lowStock filtra bajo y agotado, y se cruza con stockStatus", async () => {
    const [onlyLowStock] = mockSupabase([{ count: 0, data: [], error: null }]);
    await list("lowStock=true");
    expect(callsOf(onlyLowStock, "in")).toEqual([["stock_status", ["low", "out"]]]);

    const [crossed] = mockSupabase([{ count: 0, data: [], error: null }]);
    await list("lowStock=true&stockStatus=ok,out");
    expect(callsOf(crossed, "in")).toEqual([["stock_status", ["out"]]]);
  });

  it("lowStock con stockStatus=ok no casa con nada y no consulta la base", async () => {
    mockSupabase([]);

    await expect(list("lowStock=true&stockStatus=ok")).resolves.toEqual({
      items: [],
      limit: 10,
      skip: 0,
      total: 0,
    });
    expect(createRouteSupabaseClient).not.toHaveBeenCalled();
  });

  it("skip más allá del total (416 / PGRST103) responde página vacía con el total real", async () => {
    const [page, total] = mockSupabase([
      { count: null, data: null, error: { code: "PGRST103", message: "Requested range not satisfiable" }, status: 416 },
      { count: 37, data: null, error: null },
    ]);

    const result = await list("skip=500&limit=10&stockStatus=low", "admin");

    expect(result).toEqual({ items: [], limit: 10, skip: 500, total: 37 });
    expect(callsOf(total, "select")[0][1]).toEqual({ count: "exact", head: true });
    expect(callsOf(total, "in")).toEqual(callsOf(page, "in"));
    expect(callsOf(total, "range")).toEqual([]);
  });

  it("un skip desmesurado no llega como offset a la base: solo cuenta", async () => {
    const [total] = mockSupabase([{ count: 37, data: null, error: null }]);

    const result = await list("skip=99999999999999999999");

    expect(result).toMatchObject({ items: [], total: 37 });
    expect(callsOf(total, "select")[0][1]).toEqual({ count: "exact", head: true });
    expect(callsOf(total, "range")).toEqual([]);
  });

  it("paginación y precios inválidos usan los valores por defecto y no filtran", async () => {
    const [query] = mockSupabase([{ count: 2, data: [cableRow, drillRow], error: null }]);

    const result = await list("skip=abc&limit=-5&minPriceRef=caro&maxPriceRef=Infinity&stockStatus=nada");

    expect(result).toMatchObject({ limit: 10, skip: 0, total: 2 });
    expect(callsOf(query, "range")).toEqual([[0, 9]]);
    expect(callsOf(query, "gte")).toEqual([]);
    expect(callsOf(query, "lte")).toEqual([]);
    expect(callsOf(query, "in")).toEqual([]);
  });

  it("un filtro exacto imposible responde 400, no 500", async () => {
    mockSupabase([]);

    await expect(list(`productId=${"x".repeat(300)}`)).rejects.toMatchObject({ status: 400 });

    mockSupabase([{ count: null, data: null, error: { code: "22P02", message: "invalid input syntax for type uuid" }, status: 400 }]);

    const error = await list("categoryId=no-es-uuid").catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400 });
  });

  it("propaga el error de la consulta", async () => {
    mockSupabase([{ count: null, data: null, error: { code: "42P01", message: "relation does not exist" }, status: 404 }]);

    await expect(list("")).rejects.toMatchObject({ status: 500 });
  });

  describe("descuadre (reconciliationDiff)", () => {
    it("admin: segunda consulta a stock_reconciliation con los ids de la página; null si cuadra", async () => {
      const [, reconciliation] = mockSupabase([
        { count: 2, data: [cableRow, drillRow], error: null },
        { data: [{ diff: -3, product_id: CABLE_ID }], error: null },
      ]);

      const result = await list("", "admin");

      expect(reconciliation.table).toBe("stock_reconciliation");
      expect(callsOf(reconciliation, "eq")).toEqual([["store_id", DEFAULT_STORE_ID]]);
      expect(callsOf(reconciliation, "in")).toEqual([["product_id", [CABLE_ID, DRILL_ID]]]);
      expect(result.items.map((item) => item.reconciliationDiff)).toEqual([-3, null]);
    });

    it.each(["almacen", "vendedor", "contador", undefined] as const)(
      "rol %s: no consulta stock_reconciliation y el campo no viaja",
      async (role) => {
        const [, reconciliation] = mockSupabase([
          { count: 2, data: [cableRow, drillRow], error: null },
          { data: [{ diff: -3, product_id: CABLE_ID }], error: null },
        ]);

        const result = await list("", role);

        expect(reconciliation.table).toBeNull();
        expect(result.items.every((item) => !("reconciliationDiff" in item))).toBe(true);
      },
    );

    it("admin con página vacía no consulta stock_reconciliation", async () => {
      const [, reconciliation] = mockSupabase([
        { count: 0, data: [], error: null },
        { data: [], error: null },
      ]);

      await expect(list("", "admin")).resolves.toMatchObject({ items: [], total: 0 });
      expect(reconciliation.table).toBeNull();
    });

    it("admin: un fallo de stock_reconciliation no se traga", async () => {
      mockSupabase([
        { count: 1, data: [cableRow], error: null },
        { data: null, error: { code: "42501", message: "permission denied" } },
      ]);

      await expect(list("", "admin")).rejects.toMatchObject({ status: 403 });
    });
  });
});
