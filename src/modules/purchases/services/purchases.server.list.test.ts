/**
 * @jest-environment node
 */
/**
 * COM-08 · filtros de `GET /api/purchases` en el servidor real: rango de fechas
 * en día operativo Caracas y "con saldo pendiente" (`pendingBalance=1`), que
 * sale de la cabecera de la compra y nunca lee `payments`.
 */

jest.mock("../../../lib/supabase/route-client");

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { listPurchases } from "./purchases.server";

type QueryResult = { count?: number; data?: unknown; error?: unknown };

/** Constructor de consulta encadenable: resuelve con `range` o al esperarlo. */
function createQuery(result: QueryResult) {
  const query: Record<
    "eq" | "gte" | "ilike" | "in" | "lt" | "lte" | "order" | "range" | "select",
    jest.Mock
  > & { then: (resolve: (value: QueryResult) => unknown) => Promise<unknown> } = {
    eq: jest.fn(() => query),
    gte: jest.fn(() => query),
    ilike: jest.fn(() => query),
    in: jest.fn(() => query),
    lt: jest.fn(() => query),
    lte: jest.fn(() => query),
    order: jest.fn(() => query),
    range: jest.fn(async () => result),
    select: jest.fn(() => query),
    then: (resolve) => Promise.resolve(result).then(resolve),
  };

  return query;
}

/** Cada `from(...)` consume la siguiente consulta preparada. */
function mockQueries(results: QueryResult[]) {
  const queries = results.map(createQuery);
  /** Tabla de cada consulta, en orden. */
  const tables: string[] = [];
  const from = (table: string) => {
    const query = queries[tables.length];

    if (!query) {
      throw new Error("Consulta no esperada.");
    }

    tables.push(table);

    return query;
  };

  (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ from });

  return { queries, tables };
}

function balanceRow(id: string, totalRef: number, paidRef: number, status = "recibido") {
  return { id, paid_ref: paidRef, status, total_ref: totalRef };
}

function listRow(id: string, totalRef: number, paidRef: number) {
  return {
    created_at: "2026-05-17T16:00:00.000Z",
    discount_ref: 0,
    id,
    paid_ref: paidRef,
    paid_ves: paidRef * 510,
    purchase_items: [{ count: 1 }],
    purchase_number: `C-${id}`,
    ref_rate_ves: 510,
    status: "recibido" as const,
    subtotal_ref: totalRef,
    supplier_id: "supplier-1",
    tax_ref: 0,
    total_ref: totalRef,
    total_ves: totalRef * 510,
    updated_at: "2026-05-17T16:00:00.000Z",
    user_id: "user-1",
  };
}

describe("purchases.server · listPurchases (COM-08)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("rango `from` / `to`: filtra `created_at` por día operativo Caracas en la base", async () => {
    const { queries } = mockQueries([{ count: 0, data: [], error: null }]);

    await listPurchases(new URLSearchParams("from=2026-05-17&to=2026-05-18"), DEFAULT_STORE_ID);

    // Caracas es UTC-4: el día 17 empieza a las 04:00Z y el 18 termina a las 04:00Z del 19.
    expect(queries[0].gte).toHaveBeenCalledWith("created_at", "2026-05-17T04:00:00.000Z");
    expect(queries[0].lt).toHaveBeenCalledWith("created_at", "2026-05-19T04:00:00.000Z");
    expect(queries[0].in).not.toHaveBeenCalled();
  });

  it("sin `pendingBalance` no devuelve `pendingBalanceRef`", async () => {
    mockQueries([{ count: 1, data: [listRow("a", 20, 0)], error: null }]);

    const result = await listPurchases(new URLSearchParams(), DEFAULT_STORE_ID);

    expect(result).not.toHaveProperty("pendingBalanceRef");
    expect(result.total).toBe(1);
  });

  it("`pendingBalance=1`: solo compras vigentes con saldo, total y suma del filtro completo", async () => {
    const { queries, tables } = mockQueries([
      {
        data: [
          balanceRow("debe-todo", 20, 0),
          balanceRow("pagada", 20, 20),
          balanceRow("debe-parte", 18, 5.02, "pedido"),
          // Menos de un céntimo de diferencia no es saldo.
          balanceRow("redondeo", 10, 9.996),
          balanceRow("debe-poco", 7.5, 7.49),
        ],
        error: null,
      },
      // La base devuelve la página en otro orden: se respeta el del recorrido.
      {
        data: [
          listRow("debe-poco", 7.5, 7.49),
          listRow("debe-parte", 18, 5.02),
          listRow("debe-todo", 20, 0),
        ],
        error: null,
      },
    ]);

    const result = await listPurchases(
      new URLSearchParams("pendingBalance=1&limit=10&skip=0&from=2026-05-01&status=recibido"),
      DEFAULT_STORE_ID,
    );
    const pendingIds = ["debe-todo", "debe-parte", "debe-poco"];

    expect(result.total).toBe(3);
    expect(result.pendingBalanceRef).toBe(32.99);
    expect(result.items.map((purchase) => purchase.id)).toEqual(pendingIds);
    expect(result.items[1]).toEqual(expect.objectContaining({ paidRef: 5.02, totalRef: 18 }));

    // Recorrido: solo cabeceras vigentes de la tienda, con los demás filtros aplicados.
    expect(queries[0].select).toHaveBeenCalledWith("id, total_ref, paid_ref, status");
    expect(queries[0].eq).toHaveBeenCalledWith("store_id", DEFAULT_STORE_ID);
    expect(queries[0].in).toHaveBeenCalledWith("status", ["pedido", "recibido"]);
    expect(queries[0].eq).toHaveBeenCalledWith("status", "recibido");
    expect(queries[0].gte).toHaveBeenCalledWith("created_at", "2026-05-01T04:00:00.000Z");
    // Página: por id, dentro de la tienda.
    expect(queries[1].in).toHaveBeenCalledWith("id", pendingIds);
    expect(queries[1].eq).toHaveBeenCalledWith("store_id", DEFAULT_STORE_ID);
    // Lo pagado sale de la cabecera: nunca se consulta `payments`.
    expect(tables).toEqual(["purchases", "purchases"]);
  });

  it("`pendingBalance=1`: la segunda página sale del mismo recorrido", async () => {
    const { queries } = mockQueries([
      {
        data: Array.from({ length: 12 }, (_, index) => balanceRow(`p-${index}`, 20, 15)),
        error: null,
      },
      { data: [listRow("p-11", 20, 15), listRow("p-10", 20, 15)], error: null },
    ]);

    const result = await listPurchases(
      new URLSearchParams("pendingBalance=1&limit=10&skip=10"),
      DEFAULT_STORE_ID,
    );

    expect(result).toEqual(expect.objectContaining({ limit: 10, skip: 10, total: 12 }));
    // La suma es la del filtro completo, no la de la página.
    expect(result.pendingBalanceRef).toBe(60);
    expect(queries[1].in).toHaveBeenCalledWith("id", ["p-10", "p-11"]);
    expect(result.items.map((purchase) => purchase.id)).toEqual(["p-10", "p-11"]);
  });

  it("`pendingBalance=1`: recorre todas las compras vigentes aunque pasen del tope de filas", async () => {
    const firstChunk = Array.from({ length: 1000 }, (_, index) => balanceRow(`p-${index}`, 1, 1));
    const { queries } = mockQueries([
      { data: firstChunk, error: null },
      { data: [balanceRow("ultima", 12, 2)], error: null },
      { data: [listRow("ultima", 12, 2)], error: null },
    ]);

    const result = await listPurchases(new URLSearchParams("pendingBalance=1"), DEFAULT_STORE_ID);

    expect(queries[0].range).toHaveBeenCalledWith(0, 999);
    expect(queries[1].range).toHaveBeenCalledWith(1000, 1999);
    expect(result.total).toBe(1);
    expect(result.pendingBalanceRef).toBe(10);
    expect(result.items.map((purchase) => purchase.id)).toEqual(["ultima"]);
  });

  it("`pendingBalance=1` sin deudas: lista vacía, saldo 0 y ninguna consulta de página", async () => {
    const { tables } = mockQueries([{ data: [balanceRow("pagada", 20, 20)], error: null }]);

    const result = await listPurchases(new URLSearchParams("pendingBalance=1"), DEFAULT_STORE_ID);

    expect(result).toEqual(
      expect.objectContaining({ items: [], pendingBalanceRef: 0, total: 0 }),
    );
    expect(tables).toEqual(["purchases"]);
  });

  it("`pendingBalance=1`: un error de la base se propaga", async () => {
    mockQueries([{ data: null, error: { code: "XX000", message: "boom" } }]);

    await expect(
      listPurchases(new URLSearchParams("pendingBalance=1"), DEFAULT_STORE_ID),
    ).rejects.toBeDefined();
  });
});
