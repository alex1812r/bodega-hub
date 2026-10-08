/**
 * @jest-environment node
 */
/**
 * INV-03 · `getProductKardex`: serie diaria por día de Caracas, saldo
 * reconstruido desde el stock actual, lectura acotada de la ventana y producto
 * de otra tienda.
 */

jest.mock("../../../lib/supabase/route-client");

import { ApiError } from "@/lib/api/apiError";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { KARDEX_WINDOW_MAX_ROWS, KARDEX_WINDOW_PAGE_SIZE } from "./productKardex";
import { getProductKardex } from "./productKardex.server";

type QueryResult = { count?: number | null; data?: unknown; error?: unknown; status?: number };
type Call = { args: unknown[]; method: string };
type WindowRow = { created_at: string; quantity_delta: number; seq: number };

const PRODUCT_ID = "22222222-2222-4222-8222-222222222222";
const SALE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
/** 8 de octubre de 2026, 11:00 en Caracas. */
const NOW = new Date("2026-10-08T15:00:00.000Z");

const productRow = {
  current_stock: 20,
  id: PRODUCT_ID,
  min_stock: 5,
  name: "Cable HDMI",
  sku: "ELE-CAB-001",
};

const movementRow = {
  conversion_id: null,
  created_at: "2026-10-08T14:00:00.000Z",
  id: "dddddddd-dddd-4ddd-8ddd-dddddddddd01",
  product_id: PRODUCT_ID,
  purchase: null,
  purchase_id: null,
  quantity_delta: -2,
  reason: null,
  sale: { invoice_number: "V-000123" },
  sale_id: SALE_ID,
  stock_after: 20,
  type: "venta",
};

const QUERY_METHODS = ["select", "eq", "gte", "lt", "order", "range", "maybeSingle"];

/** Consulta simulada: registra cada llamada encadenada y resuelve con `result`. */
function createQuery(result: QueryResult) {
  const calls: Call[] = [];
  const query: Record<string, unknown> = { calls, table: null };

  for (const method of QUERY_METHODS) {
    query[method] = (...args: unknown[]) => {
      calls.push({ args, method });
      return query;
    };
  }

  query.then = (resolve: (value: QueryResult) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);

  return query as { calls: Call[]; table: string | null };
}

/** Cliente Supabase simulado: cada `from()` consume la siguiente consulta, en orden. */
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

let nextSeq = 1_000_000;

function windowRow(createdAt: string, quantityDelta: number): WindowRow {
  nextSeq -= 1;

  return { created_at: createdAt, quantity_delta: quantityDelta, seq: nextSeq };
}

function windowRows(count: number, createdAt: string, quantityDelta: number) {
  return Array.from({ length: count }, () => windowRow(createdAt, quantityDelta));
}

const noMovements: QueryResult = { count: 0, data: [], error: null };

function kardex(productId: string | null = PRODUCT_ID, storeId = DEFAULT_STORE_ID) {
  return getProductKardex(new URLSearchParams(productId === null ? "" : { productId }), storeId);
}

async function expectApiError(promise: Promise<unknown>, status: number) {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );

  expect(error).toBeInstanceOf(ApiError);
  expect((error as ApiError).status).toBe(status);
}

describe("productKardex.server · getProductKardex", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("lee el producto de la tienda y la ventana solo con seq, cantidad y fecha", async () => {
    const [product, window, movements] = mockSupabase([
      { data: productRow, error: null },
      { data: [], error: null },
      noMovements,
    ]);

    const result = await kardex();

    expect(product.table).toBe("products");
    expect(callsOf(product, "eq")).toEqual([
      ["id", PRODUCT_ID],
      ["store_id", DEFAULT_STORE_ID],
    ]);
    expect(window.table).toBe("stock_movements");
    expect(callsOf(window, "select")).toEqual([["seq, quantity_delta, created_at"]]);
    expect(callsOf(window, "eq")).toEqual([
      ["store_id", DEFAULT_STORE_ID],
      ["product_id", PRODUCT_ID],
    ]);
    // 30 días de Caracas contando hoy: desde el 9 de septiembre a las 00:00 de Caracas.
    expect(callsOf(window, "gte")).toEqual([["created_at", "2026-09-09T04:00:00.000Z"]]);
    expect(callsOf(window, "order")).toEqual([
      ["created_at", { ascending: false }],
      ["seq", { ascending: false }],
    ]);
    expect(callsOf(window, "range")).toEqual([[0, KARDEX_WINDOW_PAGE_SIZE - 1]]);
    expect(movements.table).toBe("stock_movements");
    expect(result.product).toEqual({
      currentStock: 20,
      id: PRODUCT_ID,
      minStock: 5,
      name: "Cable HDMI",
      sku: "ELE-CAB-001",
    });
  });

  it("sin movimientos en la ventana la serie es plana: 30 días con el stock actual", async () => {
    mockSupabase([{ data: productRow, error: null }, { data: [], error: null }, noMovements]);

    const result = await kardex();

    expect(result.series).toHaveLength(30);
    expect(result.series[0].date).toBe("2026-09-09");
    expect(result.series[29].date).toBe("2026-10-08");
    expect(result.series.every((point) => point.balance === 20)).toBe(true);
    expect(result.series.every((point) => point.entries === 0 && point.exits === 0)).toBe(true);
    expect(result).toMatchObject({
      entries30d: 0,
      exits30d: 0,
      lastMovements: [],
      openingBalance: 20,
      truncated: false,
    });
  });

  it("reconstruye el saldo hacia atrás desde el stock actual y deja planos los días sin movimientos", async () => {
    mockSupabase([
      { data: productRow, error: null },
      {
        data: [
          windowRow("2026-10-08T14:00:00.000Z", -2),
          windowRow("2026-10-05T20:00:00.000Z", 10),
          windowRow("2026-10-05T13:00:00.000Z", -3),
          windowRow("2026-09-20T15:00:00.000Z", -1),
        ],
        error: null,
      },
      noMovements,
    ]);

    const result = await kardex();
    const byDate = new Map(result.series.map((point) => [point.date, point]));

    expect(byDate.get("2026-10-08")).toEqual({
      balance: 20,
      date: "2026-10-08",
      entries: 0,
      exits: 2,
    });
    expect(byDate.get("2026-10-07")).toMatchObject({ balance: 22, entries: 0, exits: 0 });
    expect(byDate.get("2026-10-06")).toMatchObject({ balance: 22, entries: 0, exits: 0 });
    expect(byDate.get("2026-10-05")).toMatchObject({ balance: 22, entries: 10, exits: 3 });
    expect(byDate.get("2026-10-04")).toMatchObject({ balance: 15 });
    expect(byDate.get("2026-09-20")).toMatchObject({ balance: 15, entries: 0, exits: 1 });
    expect(byDate.get("2026-09-19")).toMatchObject({ balance: 16 });
    expect(byDate.get("2026-09-09")).toMatchObject({ balance: 16 });
    expect(result).toMatchObject({ entries30d: 10, exits30d: 6, openingBalance: 16 });

    // Cada cierre es el del día anterior más las entradas menos las salidas del día.
    result.series.forEach((point, index) => {
      const previous = index === 0 ? result.openingBalance : result.series[index - 1].balance;

      expect(point.balance).toBe((previous ?? 0) + (point.entries ?? 0) - (point.exits ?? 0));
    });
  });

  it("asigna cada movimiento a su día de Caracas, no al día UTC", async () => {
    mockSupabase([
      { data: productRow, error: null },
      {
        data: [
          // 00:00 en Caracas del 8: ya es el día 8.
          windowRow("2026-10-08T04:00:00.000Z", 4),
          // 23:30 en Caracas del 7 (ya es día 8 en UTC): cuenta en el 7.
          windowRow("2026-10-08T03:30:00.000Z", -5),
        ],
        error: null,
      },
      noMovements,
    ]);

    const result = await kardex();
    const byDate = new Map(result.series.map((point) => [point.date, point]));

    expect(byDate.get("2026-10-08")).toMatchObject({ balance: 20, entries: 4, exits: 0 });
    expect(byDate.get("2026-10-07")).toMatchObject({ balance: 16, entries: 0, exits: 5 });
    expect(byDate.get("2026-10-06")).toMatchObject({ balance: 21 });
  });

  it("un saldo histórico negativo se devuelve tal cual", async () => {
    mockSupabase([
      { data: { ...productRow, current_stock: 2 }, error: null },
      { data: [windowRow("2026-10-08T14:00:00.000Z", 5)], error: null },
      noMovements,
    ]);

    const result = await kardex();

    expect(result.series[28]).toMatchObject({ balance: -3, date: "2026-10-07" });
    expect(result.openingBalance).toBe(-3);
  });

  it("al llegar al tope deja de leer, marca truncated y solo cubre los días leídos completos", async () => {
    const pageCount = KARDEX_WINDOW_MAX_ROWS / KARDEX_WINDOW_PAGE_SIZE;
    const rows = [
      ...windowRows(100, "2026-10-08T14:00:00.000Z", -1),
      ...windowRows(4400, "2026-10-07T14:00:00.000Z", 1),
      // El día 6 quedó a medias: hay más filas suyas que no se leyeron.
      ...windowRows(500, "2026-10-06T14:00:00.000Z", -1),
    ];
    const pages = Array.from({ length: pageCount }, (_, index) => ({
      data: rows.slice(index * KARDEX_WINDOW_PAGE_SIZE, (index + 1) * KARDEX_WINDOW_PAGE_SIZE),
      error: null,
    }));
    const queries = mockSupabase([
      { data: { ...productRow, current_stock: 5000 }, error: null },
      ...pages,
      noMovements,
    ]);

    const result = await kardex();
    const windowQueries = queries.slice(1, 1 + pageCount);
    const byDate = new Map(result.series.map((point) => [point.date, point]));

    // 5 páginas de la ventana y ninguna más: la séptima consulta sería "inesperada".
    expect(windowQueries.map((query) => callsOf(query, "range")[0])).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
      [3000, 3999],
      [4000, 4999],
    ]);
    expect(result.truncated).toBe(true);
    expect(byDate.get("2026-10-08")).toEqual({
      balance: 5000,
      date: "2026-10-08",
      entries: 0,
      exits: 100,
    });
    expect(byDate.get("2026-10-07")).toMatchObject({ balance: 5100, entries: 4400, exits: 0 });
    expect(byDate.get("2026-10-06")).toEqual({
      balance: null,
      date: "2026-10-06",
      entries: null,
      exits: null,
    });
    expect(result.series.slice(0, 28).every((point) => point.balance === null)).toBe(true);
    expect(result.series).toHaveLength(30);
    expect(result).toMatchObject({ entries30d: 4400, exits30d: 100, openingBalance: null });
  });

  it("una ventana de exactamente una página termina sin error cuando la siguiente responde 416", async () => {
    const queries = mockSupabase([
      { data: { ...productRow, current_stock: 1000 }, error: null },
      { data: windowRows(KARDEX_WINDOW_PAGE_SIZE, "2026-10-08T14:00:00.000Z", 1), error: null },
      { data: null, error: { code: "PGRST103" }, status: 416 },
      noMovements,
    ]);

    const result = await kardex();

    expect(callsOf(queries[2], "range")).toEqual([[1000, 1999]]);
    expect(result.truncated).toBe(false);
    expect(result).toMatchObject({ entries30d: 1000, openingBalance: 0 });
  });

  it("no cuenta dos veces la fila que se repite entre dos páginas", async () => {
    const firstPage = windowRows(KARDEX_WINDOW_PAGE_SIZE, "2026-10-08T14:00:00.000Z", 1);

    mockSupabase([
      { data: { ...productRow, current_stock: 1001 }, error: null },
      { data: firstPage, error: null },
      {
        data: [firstPage[firstPage.length - 1], windowRow("2026-10-07T14:00:00.000Z", 1)],
        error: null,
      },
      noMovements,
    ]);

    const result = await kardex();

    expect(result).toMatchObject({ entries30d: 1001, openingBalance: 0, truncated: false });
  });

  it("devuelve los 10 últimos movimientos por seq descendente con su documento", async () => {
    const queries = mockSupabase([
      { data: productRow, error: null },
      { data: [], error: null },
      {
        count: 2,
        data: [
          movementRow,
          {
            ...movementRow,
            id: "dddddddd-dddd-4ddd-8ddd-dddddddddd02",
            quantity_delta: 3,
            reason: "Conteo físico",
            sale: null,
            sale_id: null,
            stock_after: 22,
            type: "ajuste_entrada",
          },
        ],
        error: null,
      },
    ]);

    const result = await kardex();
    const movements = queries[2];

    expect(callsOf(movements, "eq")).toEqual([
      ["store_id", DEFAULT_STORE_ID],
      ["product_id", PRODUCT_ID],
    ]);
    expect(callsOf(movements, "order")).toEqual([["seq", { ascending: false }]]);
    expect(callsOf(movements, "range")).toEqual([[0, 9]]);
    expect(result.lastMovements).toEqual([
      {
        conversionId: null,
        createdAt: "2026-10-08T14:00:00.000Z",
        documentKind: "venta",
        documentNumber: "V-000123",
        id: "dddddddd-dddd-4ddd-8ddd-dddddddddd01",
        purchaseId: null,
        quantityDelta: -2,
        reason: null,
        saleId: SALE_ID,
        stockAfter: 20,
        type: "venta",
      },
      {
        conversionId: null,
        createdAt: "2026-10-08T14:00:00.000Z",
        documentKind: null,
        documentNumber: null,
        id: "dddddddd-dddd-4ddd-8ddd-dddddddddd02",
        purchaseId: null,
        quantityDelta: 3,
        reason: "Conteo físico",
        saleId: null,
        stockAfter: 22,
        type: "ajuste_entrada",
      },
    ]);
  });

  it("un producto de otra tienda (o inexistente) responde 404 sin leer movimientos", async () => {
    const queries = mockSupabase([{ data: null, error: null }, { data: [], error: null }]);

    await expectApiError(kardex(PRODUCT_ID, "00000000-0000-4000-8000-000000000002"), 404);

    expect(callsOf(queries[0], "eq")).toContainEqual([
      "store_id",
      "00000000-0000-4000-8000-000000000002",
    ]);
    expect(queries[1].table).toBeNull();
  });

  it.each([
    ["ausente", null],
    ["vacío", "  "],
    ["que no es un uuid", "prod-cable"],
    ["demasiado largo", "a".repeat(201)],
  ])("productId %s responde 400 sin consultar la base", async (_label, productId) => {
    await expectApiError(kardex(productId), 400);

    expect(createRouteSupabaseClient).not.toHaveBeenCalled();
  });

  it("propaga el error de la base al leer la ventana", async () => {
    mockSupabase([
      { data: productRow, error: null },
      { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } },
    ]);

    await expect(kardex()).rejects.toBeDefined();
  });
});
