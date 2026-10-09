/**
 * @jest-environment node
 */
/**
 * COM-F7 (M5) · `GET /api/products?search=…&limit=20` tardaba ~1 s con miles de
 * coincidencias: la relación calculada `price_review` viajaba embebida en la
 * consulta paginada y Postgres la evaluaba por cada fila que casaba, antes del
 * `LIMIT`. Sin el filtro `review=1` la página se pide sin la relación y la cola
 * "Por revisar" se resuelve solo para los productos de esa página (una segunda
 * consulta por ids). La respuesta es la misma que con el embed.
 */

jest.mock("../../../lib/supabase/route-client");

import { mapProduct, type ProductPriceReviewRow, type ProductRow } from "@/lib/supabase/mappers";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { listProducts } from "./products.server";

type QueryResult = { count?: number | null; data: unknown[] | null; error: unknown; status: number };

function productRow(id: string, name: string): ProductRow {
  return {
    barcode: null,
    category_id: "cat-1",
    created_at: "2026-10-01T12:00:00.000Z",
    current_cost_ref: 8,
    current_stock: 3,
    description: null,
    id,
    image_url: null,
    is_active: true,
    min_stock: 1,
    name,
    sale_price_ref: 10,
    sku: `SKU-${id}`,
    updated_at: "2026-10-01T12:00:00.000Z",
  };
}

function reviewRow(productId: string): ProductPriceReviewRow {
  return {
    current_band: "red",
    current_cost_ref: 8,
    current_margin_pct: 25,
    name: "Harina",
    previous_band: "green",
    previous_cost_ref: 5,
    previous_margin_pct: 100,
    product_id: productId,
    purchase_id: "purchase-1",
    purchase_number: "C-1",
    purchase_received_at: "2026-10-02T12:00:00.000Z",
    sale_price_ref: 10,
    sku: `SKU-${productId}`,
    snapshot_at: "2026-09-30T12:00:00.000Z",
    supplier_name: "Proveedor",
  };
}

type RecordedQuery = { calls: [string, ...unknown[]][]; select: string; table: string };

/** Cada `from(tabla)` consume el siguiente resultado preparado para esa tabla. */
function installClient(results: Record<string, QueryResult[]>) {
  const queries: RecordedQuery[] = [];

  const from = jest.fn((table: string) => ({
    select: (select: string) => {
      const result = results[table]?.shift();

      if (!result) {
        throw new Error(`Consulta no esperada a ${table}.`);
      }

      const query: RecordedQuery = { calls: [], select, table };
      const chain: Record<string, unknown> = {
        range: async () => result,
        then: (resolve: (value: QueryResult) => unknown) => Promise.resolve(result).then(resolve),
      };

      for (const method of ["eq", "gte", "in", "is", "lt", "or", "order"]) {
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

  return queries;
}

const PAGE = [productRow("p-1", "Harina A"), productRow("p-2", "Harina B"), productRow("p-3", "Harina C")];

describe("products.server · listProducts · price_review solo para la página (COM-F7 M5)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("sin filtro de revisión: la página no embebe `price_review` y la cola se pide por los ids de la página", async () => {
    const queries = installClient({
      products: [{ count: 3644, data: PAGE, error: null, status: 206 }],
      products_price_review: [{ data: [reviewRow("p-2")], error: null, status: 200 }],
    });

    const list = await listProducts(
      new URLSearchParams({ isActive: "true", limit: "20", search: "harina" }),
      DEFAULT_STORE_ID,
    );

    expect(queries.map((query) => query.table)).toEqual(["products", "products_price_review"]);
    expect(queries[0].select).not.toContain("price_review");
    expect(queries[1].calls).toEqual(
      expect.arrayContaining([
        ["eq", "store_id", DEFAULT_STORE_ID],
        ["in", "product_id", ["p-1", "p-2", "p-3"]],
      ]),
    );

    // Misma respuesta que cuando la relación llegaba embebida en cada fila.
    expect(list).toEqual({
      items: [
        mapProduct({ ...PAGE[0], price_review: null }),
        mapProduct({ ...PAGE[1], price_review: reviewRow("p-2") }),
        mapProduct({ ...PAGE[2], price_review: null }),
      ],
      limit: 20,
      skip: 0,
      total: 3644,
    });
    expect(list.items[1].priceReview).toMatchObject({ currentBand: "low", previousBand: "high" });
    expect(list.items[0]).not.toHaveProperty("priceReview");
  });

  it("con `review=1` se mantiene el camino de siempre: una sola consulta con la relación como inner join", async () => {
    const embedded = { ...PAGE[1], price_review: reviewRow("p-2") };
    const queries = installClient({
      products: [{ count: 1, data: [embedded], error: null, status: 200 }],
    });

    const list = await listProducts(
      new URLSearchParams({ limit: "20", review: "1", search: "harina" }),
      DEFAULT_STORE_ID,
    );

    expect(queries.map((query) => query.table)).toEqual(["products"]);
    expect(queries[0].select).toContain("price_review:price_review!inner(");
    expect(list).toEqual({ items: [mapProduct(embedded)], limit: 20, skip: 0, total: 1 });
  });

  it("página vacía: no se consulta la cola", async () => {
    const queries = installClient({
      products: [{ count: 0, data: [], error: null, status: 200 }],
    });

    const list = await listProducts(new URLSearchParams({ search: "nada" }), DEFAULT_STORE_ID);

    expect(list).toEqual({ items: [], limit: 10, skip: 0, total: 0 });
    expect(queries.map((query) => query.table)).toEqual(["products"]);
  });

  it("un error al leer la cola de la página se propaga", async () => {
    installClient({
      products: [{ count: 3, data: PAGE, error: null, status: 200 }],
      products_price_review: [
        { data: null, error: { code: "XX000", message: "boom" }, status: 500 },
      ],
    });

    await expect(
      listProducts(new URLSearchParams({ search: "harina" }), DEFAULT_STORE_ID),
    ).rejects.toBeDefined();
  });
});
