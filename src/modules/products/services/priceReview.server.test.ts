/**
 * @jest-environment node
 *
 * PRO-11 · servicio real de la cola "Por revisar": qué le pide a PostgREST
 * (vista `products_price_review`, RPC `keep_product_price` y
 * `update_product_price`) y cómo lo devuelve.
 */

jest.mock("../../../lib/supabase/route-client");
jest.mock("../../../lib/api/assertStoreResource", () => ({
  ...jest.requireActual("../../../lib/api/assertStoreResource"),
  assertSupabaseStoreResource: jest.fn(),
}));

import { ApiError } from "@/lib/api/apiError";
import { assertSupabaseStoreResource } from "@/lib/api/assertStoreResource";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import {
  getPriceReviewSummary,
  keepProductPrice,
  listPriceReview,
  repriceProducts,
} from "./priceReview.server";

type Call = { args: unknown[]; method: string };
type QueryResult = { count?: number | null; data?: unknown; error?: unknown };

/** Constructor de consultas encadenable que anota cada llamada y resuelve con `result`. */
function queryBuilder(result: QueryResult, calls: Call[]) {
  const builder: Record<string, unknown> = {
    then: (resolve: (value: QueryResult) => unknown) => Promise.resolve(result).then(resolve),
  };

  for (const method of ["select", "eq", "in", "order", "range"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ args, method });
      return builder;
    };
  }

  return builder;
}

function mockSupabase(options: {
  rpc?: (name: string, args: Record<string, unknown>) => QueryResult;
  tables?: Record<string, QueryResult>;
}) {
  const calls: Record<string, Call[]> = {};
  const rpc = jest.fn(async (name: string, args: Record<string, unknown>) =>
    options.rpc ? options.rpc(name, args) : { data: null, error: null },
  );

  (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
    from: jest.fn((table: string) => {
      calls[table] = [];
      return queryBuilder(options.tables?.[table] ?? { data: [], error: null }, calls[table]);
    }),
    rpc,
  });

  return { calls, rpc };
}

const reviewRow = {
  current_band: "red",
  current_cost_ref: "9.00",
  current_margin_pct: "11.111111",
  name: "Harina PAN",
  previous_band: "green",
  previous_cost_ref: "8.00",
  previous_margin_pct: "25.000000",
  product_id: "prod-1",
  purchase_id: "pur-1",
  purchase_number: "C-0001",
  purchase_received_at: "2026-10-02T10:00:00.000Z",
  sale_price_ref: "10.00",
  sku: "HAR-001",
  snapshot_at: "2026-10-01T10:00:00.000Z",
  supplier_name: "Distribuidora Lara",
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("priceReview.server listPriceReview", () => {
  it("reads the view of the store, worst band and biggest drop first, with exact count and pagination", async () => {
    const { calls } = mockSupabase({
      tables: { products_price_review: { count: 41, data: [reviewRow], error: null } },
    });

    const result = await listPriceReview(new URLSearchParams("skip=10&limit=20"), DEFAULT_STORE_ID);

    expect(calls.products_price_review).toEqual([
      { args: [expect.stringContaining("previous_margin_pct"), { count: "exact" }], method: "select" },
      { args: ["store_id", DEFAULT_STORE_ID], method: "eq" },
      { args: ["current_band_rank", { ascending: true }], method: "order" },
      { args: ["margin_drop_pct", { ascending: false }], method: "order" },
      { args: ["product_id", { ascending: true }], method: "order" },
      { args: [10, 29], method: "range" },
    ]);
    expect(result).toEqual({
      items: [
        {
          currentBand: "low",
          currentCostRef: 9,
          currentMarginPct: 11.111111,
          name: "Harina PAN",
          previousBand: "high",
          previousCostRef: 8,
          previousMarginPct: 25,
          productId: "prod-1",
          purchase: {
            id: "pur-1",
            number: "C-0001",
            receivedAt: "2026-10-02T10:00:00.000Z",
            supplierName: "Distribuidora Lara",
          },
          salePriceRef: 10,
          sku: "har-001",
          snapshotAt: "2026-10-01T10:00:00.000Z",
        },
      ],
      limit: 20,
      skip: 10,
      total: 41,
    });
  });

  it("filters by the purchase that raised the cost, always inside the store of the session", async () => {
    const { calls } = mockSupabase({});

    await listPriceReview(new URLSearchParams("purchaseId=pur-9&store_id=otra"), DEFAULT_STORE_ID);

    expect(calls.products_price_review.filter((call) => call.method === "eq")).toEqual([
      { args: ["store_id", DEFAULT_STORE_ID], method: "eq" },
      { args: ["purchase_id", "pur-9"], method: "eq" },
    ]);
  });

  it("omits the purchase when the cost changed some other way", async () => {
    mockSupabase({
      tables: {
        products_price_review: {
          count: 1,
          data: [{ ...reviewRow, purchase_id: null, purchase_number: null, purchase_received_at: null, supplier_name: null }],
          error: null,
        },
      },
    });

    const result = await listPriceReview(new URLSearchParams(), DEFAULT_STORE_ID);

    expect(result.items[0]).not.toHaveProperty("purchase");
  });

  it("maps a rejected read to an ApiError", async () => {
    mockSupabase({
      tables: { products_price_review: { data: null, error: { code: "22P02", message: "invalid input syntax for type uuid" } } },
    });

    await expect(listPriceReview(new URLSearchParams("purchaseId=no-uuid"), DEFAULT_STORE_ID)).rejects.toMatchObject({
      message: "Los datos enviados no son validos.",
      status: 400,
    });
  });
});

describe("priceReview.server getPriceReviewSummary", () => {
  it("asks only for the count of the store", async () => {
    const { calls } = mockSupabase({ tables: { products_price_review: { count: 7, data: null, error: null } } });

    expect(await getPriceReviewSummary(DEFAULT_STORE_ID)).toEqual({ total: 7 });
    expect(calls.products_price_review).toEqual([
      { args: ["product_id", { count: "exact", head: true }], method: "select" },
      { args: ["store_id", DEFAULT_STORE_ID], method: "eq" },
    ]);
  });
});

describe("priceReview.server keepProductPrice", () => {
  const historyRow = {
    changed_by: "user-1",
    created_at: "2026-10-03T10:00:00.000Z",
    id: "price-9",
    new_sale_price_ref: 10,
    old_sale_price_ref: 10,
    product_id: "prod-1",
    reason: "Precio mantenido",
  };

  it("calls keep_product_price after checking the product belongs to the store and returns the kept-price row", async () => {
    const { rpc } = mockSupabase({ rpc: () => ({ data: historyRow, error: null }) });

    const entry = await keepProductPrice("prod-1", { reason: null }, DEFAULT_STORE_ID);

    expect(assertSupabaseStoreResource).toHaveBeenCalledWith(
      "products",
      "prod-1",
      DEFAULT_STORE_ID,
      "Producto no encontrado.",
    );
    expect(rpc).toHaveBeenCalledWith("keep_product_price", { p_product_id: "prod-1", p_reason: null });
    expect(entry).toMatchObject({
      id: "price-9",
      kind: "keep",
      previousSalePriceRef: 10,
      reason: "Precio mantenido",
      salePriceRef: 10,
    });
  });

  it("passes the reason through", async () => {
    const { rpc } = mockSupabase({ rpc: () => ({ data: historyRow, error: null }) });

    await keepProductPrice("prod-1", { reason: "Lo reviso el lunes" }, DEFAULT_STORE_ID);

    expect(rpc).toHaveBeenCalledWith("keep_product_price", {
      p_product_id: "prod-1",
      p_reason: "Lo reviso el lunes",
    });
  });

  it.each([
    ["PT403", "No autorizado para mantener precios", 403],
    ["PT404", "Producto no encontrado", 404],
  ])("answers %s from the RPC with its Spanish message and status", async (code, message, status) => {
    mockSupabase({ rpc: () => ({ data: null, error: { code, message } }) });

    await expect(keepProductPrice("prod-1", { reason: null }, DEFAULT_STORE_ID)).rejects.toMatchObject({
      message,
      status,
    });
  });

  it("does not call the RPC for a product of another store", async () => {
    const { rpc } = mockSupabase({});
    (assertSupabaseStoreResource as jest.Mock).mockRejectedValueOnce(
      new ApiError(404, "NOT_FOUND", "Producto no encontrado."),
    );

    await expect(keepProductPrice("prod-ajeno", { reason: null }, DEFAULT_STORE_ID)).rejects.toMatchObject({
      status: 404,
    });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("priceReview.server repriceProducts", () => {
  const products = [
    { current_cost_ref: "9.00", id: "prod-ok" },
    { current_cost_ref: "0.00", id: "prod-sin-costo" },
    { current_cost_ref: "1.02", id: "prod-empate" },
    { current_cost_ref: "5.00", id: "prod-rechazado" },
  ];

  it("reads the costs of the store once and updates each product with update_product_price, one result per product", async () => {
    const { calls, rpc } = mockSupabase({
      rpc: (_name, args) =>
        args.p_product_id === "prod-rechazado"
          ? { data: null, error: { code: "PT403", message: "No autorizado para cambiar precios" } }
          : { data: { id: args.p_product_id }, error: null },
      tables: { products: { data: products, error: null } },
    });

    const result = await repriceProducts(
      {
        markupPct: 25,
        productIds: ["prod-sin-costo", "prod-ok", "prod-de-otra-tienda", "prod-rechazado", "prod-empate", "prod-ok"],
        reason: null,
      },
      DEFAULT_STORE_ID,
    );

    expect(calls.products).toEqual([
      { args: ["id, current_cost_ref"], method: "select" },
      { args: ["store_id", DEFAULT_STORE_ID], method: "eq" },
      {
        args: ["id", ["prod-sin-costo", "prod-ok", "prod-de-otra-tienda", "prod-rechazado", "prod-empate"]],
        method: "in",
      },
    ]);
    // Sin costo y fuera de la tienda no llegan a la RPC; el rechazo de uno no corta el lote.
    expect(rpc.mock.calls).toEqual([
      ["update_product_price", { p_new_sale_price_ref: 11.25, p_product_id: "prod-ok", p_reason: "Reprecio al 25 %" }],
      ["update_product_price", { p_new_sale_price_ref: 6.25, p_product_id: "prod-rechazado", p_reason: "Reprecio al 25 %" }],
      // 1,02 × 1,25 = 1,275: el empate de medio céntimo sube (priceFromMarkup de @bodega/core).
      ["update_product_price", { p_new_sale_price_ref: 1.28, p_product_id: "prod-empate", p_reason: "Reprecio al 25 %" }],
    ]);
    expect(result).toEqual({
      failed: 3,
      results: [
        { code: "NO_COST", message: expect.stringContaining("no tiene costo"), productId: "prod-sin-costo", status: "error" },
        { productId: "prod-ok", salePriceRef: 11.25, status: "ok" },
        { code: "NOT_FOUND", message: "Producto no encontrado.", productId: "prod-de-otra-tienda", status: "error" },
        { code: "FORBIDDEN", message: "No autorizado para cambiar precios", productId: "prod-rechazado", status: "error" },
        { productId: "prod-empate", salePriceRef: 1.28, status: "ok" },
      ],
      updated: 2,
    });
  });

  it("uses the given reason instead of the default one", async () => {
    const { rpc } = mockSupabase({
      rpc: () => ({ data: {}, error: null }),
      tables: { products: { data: products, error: null } },
    });

    await repriceProducts({ markupPct: 12.5, productIds: ["prod-ok"], reason: "Ajuste de octubre" }, DEFAULT_STORE_ID);

    expect(rpc).toHaveBeenCalledWith("update_product_price", {
      p_new_sale_price_ref: 10.13,
      p_product_id: "prod-ok",
      p_reason: "Ajuste de octubre",
    });
  });

  it("fails as a whole only when the costs cannot be read", async () => {
    const { rpc } = mockSupabase({
      tables: { products: { data: null, error: { code: "42501", message: "permission denied for table products" } } },
    });

    await expect(
      repriceProducts({ markupPct: 25, productIds: ["prod-ok"], reason: null }, DEFAULT_STORE_ID),
    ).rejects.toMatchObject({ status: 403 });
    expect(rpc).not.toHaveBeenCalled();
  });
});
