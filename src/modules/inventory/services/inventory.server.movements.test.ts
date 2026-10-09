/**
 * @jest-environment node
 */
/**
 * INV-04a · `listStockMovements` y `getStockCard`: filtros en la consulta,
 * documento resuelto, orden del libro y página más allá del total.
 */

jest.mock("../../../lib/supabase/route-client");

import { ApiError } from "@/lib/api/apiError";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { getStockCard, listStockMovements, MAX_DOCUMENT_MATCHES } from "./inventory.server";

type QueryResult = { count?: number | null; data?: unknown; error?: unknown; status?: number };
type Call = { args: unknown[]; method: string };

const PRODUCT_ID = "22222222-2222-4222-8222-222222222222";
const SALE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SALE_ID_2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab";
const PURCHASE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CONVERSION_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const baseRow = {
  conversion_id: null,
  created_at: "2026-10-01T15:00:00.000Z",
  id: "dddddddd-dddd-4ddd-8ddd-dddddddddd01",
  product: {
    category_id: null,
    current_cost_ref: "5.00",
    current_stock: 4,
    id: PRODUCT_ID,
    is_active: true,
    min_stock: 1,
    name: "Cable HDMI",
    sale_price_ref: "12.00",
    sku: "ELE-CAB-001",
  },
  product_id: PRODUCT_ID,
  purchase: null,
  purchase_id: null,
  quantity_delta: -1,
  reason: null,
  sale: null,
  sale_id: null,
  stock_after: 4,
  type: "ajuste_salida",
};

const saleRow = {
  ...baseRow,
  id: "dddddddd-dddd-4ddd-8ddd-dddddddddd02",
  sale: { invoice_number: "V-000123" },
  sale_id: SALE_ID,
  type: "venta",
};

const purchaseRow = {
  ...baseRow,
  id: "dddddddd-dddd-4ddd-8ddd-dddddddddd03",
  purchase: [{ purchase_number: "C-000045" }],
  purchase_id: PURCHASE_ID,
  quantity_delta: 10,
  type: "compra",
};

const conversionRow = {
  ...baseRow,
  conversion_id: CONVERSION_ID,
  id: "dddddddd-dddd-4ddd-8ddd-dddddddddd04",
  type: "conversion_salida",
};

const stockCardRow = {
  conversion_id: null,
  created_at: "2026-10-01T15:00:00.000Z",
  created_by: null,
  id: "dddddddd-dddd-4ddd-8ddd-dddddddddd05",
  product_id: PRODUCT_ID,
  product_name: "Cable HDMI",
  purchase_id: null,
  quantity_delta: -1,
  reason: null,
  sale_id: SALE_ID,
  sku: "ELE-CAB-001",
  stock_after: 4,
  type: "venta",
};

const QUERY_METHODS = [
  "select",
  "eq",
  "in",
  "or",
  "not",
  "is",
  "ilike",
  "gte",
  "lt",
  "order",
  "limit",
  "range",
];

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

function movements(queryString: string) {
  return listStockMovements(new URLSearchParams(queryString), DEFAULT_STORE_ID);
}

function stockCard(queryString: string) {
  return getStockCard(new URLSearchParams(queryString), DEFAULT_STORE_ID);
}

async function expectBadRequest(promise: Promise<unknown>, message?: string) {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );

  expect(error).toBeInstanceOf(ApiError);
  expect((error as ApiError).status).toBe(400);

  if (message) {
    expect((error as ApiError).message).toBe(message);
  }
}

describe("inventory.server · listStockMovements", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("lee el libro de la tienda con conteo exacto, en orden de seq descendente y con rango", async () => {
    const [query] = mockSupabase([{ count: 37, data: [saleRow], error: null }]);

    const result = await movements("skip=20&limit=10");

    expect(query.table).toBe("stock_movements");
    expect(callsOf(query, "select")[0][1]).toEqual({ count: "exact" });
    expect(callsOf(query, "eq")).toEqual([["store_id", DEFAULT_STORE_ID]]);
    expect(callsOf(query, "order")).toEqual([["seq", { ascending: false }]]);
    expect(callsOf(query, "range")).toEqual([[20, 29]]);
    expect(result).toMatchObject({ limit: 10, skip: 20, total: 37 });
  });

  it("pide el número de la venta y de la compra en la misma consulta (sin N+1)", async () => {
    const [query] = mockSupabase([{ count: 4, data: [saleRow], error: null }]);

    await movements("");

    const select = String(callsOf(query, "select")[0][0]);

    expect(select).toContain("sale:sales!sale_id(invoice_number)");
    expect(select).toContain("purchase:purchases!purchase_id(purchase_number)");
  });

  it("devuelve el documento resuelto de cada movimiento", async () => {
    mockSupabase([
      { count: 4, data: [saleRow, purchaseRow, conversionRow, baseRow], error: null },
    ]);

    const { items } = await movements("");

    expect(items.map((item) => [item.documentKind, item.documentNumber])).toEqual([
      ["venta", "V-000123"],
      ["compra", "C-000045"],
      ["conversion", null],
      [null, null],
    ]);
    // Lo que ya devolvía sigue igual.
    expect(items[0]).toMatchObject({
      id: saleRow.id,
      product: { id: PRODUCT_ID, name: "Cable HDMI" },
      productId: PRODUCT_ID,
      quantityDelta: -1,
      saleId: SALE_ID,
      stockAfter: 4,
      type: "venta",
    });
  });

  it("un movimiento de venta cuyo documento no llega en el embed conserva el tipo y número null", async () => {
    mockSupabase([{ count: 1, data: [{ ...saleRow, sale: null }], error: null }]);

    const { items } = await movements("");

    expect(items[0]).toMatchObject({ documentKind: "venta", documentNumber: null });
  });

  it("filtra por producto, tipo, venta y compra exactos", async () => {
    const [query] = mockSupabase([{ count: 0, data: [], error: null }]);

    await movements(
      `productId=${PRODUCT_ID}&type=venta&saleId=${SALE_ID}&purchaseId=${PURCHASE_ID}`,
    );

    expect(callsOf(query, "eq")).toEqual([
      ["store_id", DEFAULT_STORE_ID],
      ["product_id", PRODUCT_ID],
      ["type", "venta"],
      ["sale_id", SALE_ID],
      ["purchase_id", PURCHASE_ID],
    ]);
  });

  it("filtra el rango por días de Caracas (medianoche = 04:00 UTC, fin exclusivo)", async () => {
    const [query] = mockSupabase([{ count: 0, data: [], error: null }]);

    await movements("from=2026-10-01&to=2026-10-03");

    expect(callsOf(query, "gte")).toEqual([["created_at", "2026-10-01T04:00:00.000Z"]]);
    expect(callsOf(query, "lt")).toEqual([["created_at", "2026-10-04T04:00:00.000Z"]]);
  });

  it("acepta el mismo día como inicio y fin", async () => {
    const [query] = mockSupabase([{ count: 0, data: [], error: null }]);

    await movements("from=2026-10-01&to=2026-10-01");

    expect(callsOf(query, "gte")).toHaveLength(1);
    expect(callsOf(query, "lt")).toHaveLength(1);
  });

  it.each([
    ["venta", [["sale_id", "is", null]]],
    ["compra", [["purchase_id", "is", null]]],
    ["conversion", [["conversion_id", "is", null]]],
  ])("documentKind=%s exige ese vínculo", async (kind, expected) => {
    const [query] = mockSupabase([{ count: 0, data: [], error: null }]);

    await movements(`documentKind=${kind}`);

    expect(callsOf(query, "not")).toEqual(expected);
    expect(callsOf(query, "is")).toEqual([]);
  });

  it("documentKind=sin_documento exige los tres vínculos vacíos", async () => {
    const [query] = mockSupabase([{ count: 1, data: [baseRow], error: null }]);

    const { items } = await movements("documentKind=sin_documento");

    expect(callsOf(query, "is")).toEqual([
      ["sale_id", null],
      ["purchase_id", null],
      ["conversion_id", null],
    ]);
    expect(callsOf(query, "not")).toEqual([]);
    expect(items[0]).toMatchObject({ documentKind: null, documentNumber: null });
  });

  it("document: busca el número en ventas y compras de la tienda y filtra por sus ids", async () => {
    const [sales, purchases, query] = mockSupabase([
      { data: [{ id: SALE_ID }, { id: SALE_ID_2 }], error: null },
      { data: [{ id: PURCHASE_ID }], error: null },
      { count: 3, data: [saleRow, purchaseRow], error: null },
    ]);

    const result = await movements("document=0001&type=venta");

    expect(sales.table).toBe("sales");
    expect(callsOf(sales, "eq")).toEqual([["store_id", DEFAULT_STORE_ID]]);
    expect(callsOf(sales, "ilike")).toEqual([["invoice_number", "%0001%"]]);
    expect(callsOf(sales, "limit")).toEqual([[MAX_DOCUMENT_MATCHES]]);
    expect(purchases.table).toBe("purchases");
    expect(callsOf(purchases, "eq")).toEqual([["store_id", DEFAULT_STORE_ID]]);
    expect(callsOf(purchases, "ilike")).toEqual([["purchase_number", "%0001%"]]);
    expect(callsOf(purchases, "limit")).toEqual([[MAX_DOCUMENT_MATCHES]]);
    expect(query.table).toBe("stock_movements");
    expect(callsOf(query, "or")).toEqual([
      [`sale_id.in.(${SALE_ID},${SALE_ID_2}),purchase_id.in.(${PURCHASE_ID})`],
    ]);
    // Se combina con el resto de filtros.
    expect(callsOf(query, "eq")).toContainEqual(["type", "venta"]);
    expect(result.total).toBe(3);
  });

  it("document que solo casa con ventas (o solo con compras) filtra por esa columna", async () => {
    const [, , onlySales] = mockSupabase([
      { data: [{ id: SALE_ID }], error: null },
      { data: [], error: null },
      { count: 1, data: [saleRow], error: null },
    ]);

    await movements("document=V-0001");

    expect(callsOf(onlySales, "in")).toEqual([["sale_id", [SALE_ID]]]);
    expect(callsOf(onlySales, "or")).toEqual([]);

    const [, , onlyPurchases] = mockSupabase([
      { data: [], error: null },
      { data: [{ id: PURCHASE_ID }], error: null },
      { count: 1, data: [purchaseRow], error: null },
    ]);

    await movements("document=C-0001");

    expect(callsOf(onlyPurchases, "in")).toEqual([["purchase_id", [PURCHASE_ID]]]);
  });

  it("document + documentKind=compra solo busca en compras", async () => {
    const [purchases, query, unused] = mockSupabase([
      { data: [{ id: PURCHASE_ID }], error: null },
      { count: 1, data: [purchaseRow], error: null },
      { data: [], error: null },
    ]);

    await movements("document=C-0001&documentKind=compra");

    expect(purchases.table).toBe("purchases");
    expect(query.table).toBe("stock_movements");
    expect(unused.table).toBeNull();
    expect(callsOf(query, "in")).toEqual([["purchase_id", [PURCHASE_ID]]]);
    expect(callsOf(query, "not")).toEqual([["purchase_id", "is", null]]);
  });

  it.each(["conversion", "sin_documento"])(
    "document + documentKind=%s no casa con nada y no consulta",
    async (kind) => {
      const [unused] = mockSupabase([{ data: [], error: null }]);

      const result = await movements(`document=V-0001&documentKind=${kind}&limit=20`);

      expect(result).toEqual({ items: [], limit: 20, skip: 0, total: 0 });
      expect(unused.table).toBeNull();
    },
  );

  it("document sin coincidencias responde vacío sin leer el libro", async () => {
    const [, , unused] = mockSupabase([
      { data: [], error: null },
      { data: [], error: null },
      { count: 9, data: [saleRow], error: null },
    ]);

    const result = await movements("document=NO-EXISTE");

    expect(result).toEqual({ items: [], limit: 10, skip: 0, total: 0 });
    expect(unused.table).toBeNull();
  });

  it("document con comodines y caracteres reservados viaja como valor de ilike, nunca dentro del or", async () => {
    const hostile = "V%_0*1,sale_id.is.null),or(store_id.neq.x";
    const [sales, purchases, query] = mockSupabase([
      { data: [{ id: SALE_ID }], error: null },
      { data: [{ id: PURCHASE_ID }], error: null },
      { count: 0, data: [], error: null },
    ]);

    await movements(`document=${encodeURIComponent(hostile)}`);

    // `%`, `_` y `*` pasan a `_` (un carácter cualquiera): ninguno actúa de comodín abierto.
    const pattern = "%V__0_1,sale_id.is.null),or(store_id.neq.x%";

    expect(callsOf(sales, "ilike")).toEqual([["invoice_number", pattern]]);
    expect(callsOf(purchases, "ilike")).toEqual([["purchase_number", pattern]]);
    expect(callsOf(query, "or")).toEqual([
      [`sale_id.in.(${SALE_ID}),purchase_id.in.(${PURCHASE_ID})`],
    ]);
    expect(JSON.stringify(query.calls)).not.toContain("store_id.neq");
  });

  it("descarta un id de documento que no sea un uuid antes de armar el or", async () => {
    const [, , query] = mockSupabase([
      { data: [{ id: SALE_ID }, { id: "x),store_id.neq.y,sale_id.in.(z" }], error: null },
      { data: [{ id: PURCHASE_ID }], error: null },
      { count: 0, data: [], error: null },
    ]);

    await movements("document=V-0001");

    expect(callsOf(query, "or")).toEqual([
      [`sale_id.in.(${SALE_ID}),purchase_id.in.(${PURCHASE_ID})`],
    ]);
  });

  it.each(["%", "__", "*%_", '"\\'])(
    "document=%s (solo comodines) responde vacío sin consultar",
    async (term) => {
      const [unused] = mockSupabase([{ data: [], error: null }]);

      const result = await movements(`document=${encodeURIComponent(term)}`);

      expect(result).toEqual({ items: [], limit: 10, skip: 0, total: 0 });
      expect(unused.table).toBeNull();
      expect(createRouteSupabaseClient).not.toHaveBeenCalled();
    },
  );

  it("document vacío o solo espacios no filtra", async () => {
    const [query, unused] = mockSupabase([
      { count: 2, data: [saleRow], error: null },
      { data: [], error: null },
    ]);

    await movements("document=%20%20");

    expect(query.table).toBe("stock_movements");
    expect(unused.table).toBeNull();
  });

  it("recorta un document enorme antes de buscar", async () => {
    const [sales] = mockSupabase([
      { data: [], error: null },
      { data: [], error: null },
    ]);

    await movements(`document=${"7".repeat(5000)}`);

    expect(String(callsOf(sales, "ilike")[0][1])).toHaveLength(102);
  });

  it("un error al buscar documentos no se traga", async () => {
    mockSupabase([
      { data: null, error: { code: "42501", message: "permission denied" } },
      { data: [], error: null },
    ]);

    await expect(movements("document=V-1")).rejects.toMatchObject({ status: 403 });
  });

  it.each(["type=regalo", "type=VENTA", "type=toString"])("400 con %s", async (queryString) => {
    mockSupabase([]);

    await expectBadRequest(movements(queryString), "El tipo de movimiento no es válido.");
  });

  it.each([
    "from=01-10-2026",
    "from=2026-13-01",
    "to=2026-02-30",
    "to=2026-10-1",
    "from=2026-10-01T00:00:00Z",
    "to=hoy",
  ])("400 con la fecha %s", async (queryString) => {
    mockSupabase([]);

    await expectBadRequest(movements(queryString));
  });

  it("400 con mensaje en español si el rango está invertido", async () => {
    mockSupabase([]);

    await expectBadRequest(
      movements("from=2026-10-05&to=2026-10-01"),
      "La fecha inicial no puede ser posterior a la final.",
    );
  });

  it("400 con un documentKind desconocido", async () => {
    mockSupabase([]);

    await expectBadRequest(movements("documentKind=factura"), "El tipo de documento no es válido.");
  });

  it.each(["productId", "saleId", "purchaseId"])(
    "400 con un %s demasiado largo o con caracteres de control",
    async (name) => {
      mockSupabase([]);

      await expectBadRequest(movements(`${name}=${"a".repeat(201)}`));
      await expectBadRequest(movements(`${name}=abc%00def`));
    },
  );

  it("los filtros vacíos cuentan como ausentes", async () => {
    const [query] = mockSupabase([{ count: 0, data: [], error: null }]);

    await movements("type=&from=&to=&productId=&documentKind=&saleId=&purchaseId=&document=");

    expect(callsOf(query, "eq")).toEqual([["store_id", DEFAULT_STORE_ID]]);
    expect(callsOf(query, "gte")).toEqual([]);
    expect(callsOf(query, "not")).toEqual([]);
  });

  it("skip más allá del total: 200 con items vacíos y el total real, con los mismos filtros", async () => {
    const [page, total] = mockSupabase([
      {
        count: null,
        data: null,
        error: { code: "PGRST103", message: "Requested range not satisfiable" },
        status: 416,
      },
      { count: 12, data: null, error: null },
    ]);

    const result = await movements("skip=500&limit=20&type=venta&documentKind=venta");

    expect(result).toEqual({ items: [], limit: 20, skip: 500, total: 12 });
    expect(total.table).toBe("stock_movements");
    expect(callsOf(total, "select")[0][1]).toEqual({ count: "exact", head: true });
    expect(callsOf(total, "eq")).toEqual(callsOf(page, "eq"));
    expect(callsOf(total, "not")).toEqual(callsOf(page, "not"));
    expect(callsOf(total, "range")).toEqual([]);
  });

  it("skip gigantesco no llega como offset a la base", async () => {
    const [total, unused] = mockSupabase([
      { count: 12, data: null, error: null },
      { count: 0, data: [], error: null },
    ]);

    const result = await movements("skip=99999999999999999999");

    expect(result).toMatchObject({ items: [], total: 12 });
    expect(callsOf(total, "range")).toEqual([]);
    expect(unused.table).toBeNull();
  });

  it.each([
    ["limit=abc&skip=xyz", [0, 9]],
    ["limit=-5&skip=-3", [0, 9]],
    ["limit=100000", [0, 99]],
    ["limit=&skip=", [0, 9]],
    ["limit=1.5e3&skip=NaN", [0, 9]],
  ])("paginación inválida (%s) cae a valores seguros", async (queryString, range) => {
    const [query] = mockSupabase([{ count: 0, data: [], error: null }]);

    await expect(movements(queryString)).resolves.toMatchObject({ items: [], total: 0 });
    expect(callsOf(query, "range")).toEqual([range]);
  });

  it("otro error de la base sí se propaga", async () => {
    mockSupabase([{ count: null, data: null, error: { code: "42501", message: "denied" } }]);

    await expect(movements("")).rejects.toMatchObject({ status: 403 });
  });
});

describe("inventory.server · getStockCard", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("lee la vista con producto, tipo y rango, ordenada por fecha e id descendentes", async () => {
    const [query] = mockSupabase([{ count: 1, data: [stockCardRow], error: null }]);

    const result = await stockCard(
      `productId=${PRODUCT_ID}&type=venta&from=2026-10-01&to=2026-10-02&skip=10&limit=20`,
    );

    expect(query.table).toBe("stock_card");
    expect(callsOf(query, "eq")).toEqual([
      ["store_id", DEFAULT_STORE_ID],
      ["product_id", PRODUCT_ID],
      ["type", "venta"],
    ]);
    expect(callsOf(query, "gte")).toEqual([["created_at", "2026-10-01T04:00:00.000Z"]]);
    expect(callsOf(query, "lt")).toEqual([["created_at", "2026-10-03T04:00:00.000Z"]]);
    expect(callsOf(query, "order")).toEqual([
      ["created_at", { ascending: false }],
      ["id", { ascending: false }],
    ]);
    expect(callsOf(query, "range")).toEqual([[10, 29]]);
    expect(result).toMatchObject({ limit: 20, skip: 10, total: 1 });
    expect(result.items[0]).toMatchObject({
      id: stockCardRow.id,
      productId: PRODUCT_ID,
      saleId: SALE_ID,
      type: "venta",
    });
  });

  it("no atiende los filtros de documento", async () => {
    const [query, unused] = mockSupabase([
      { count: 0, data: [], error: null },
      { data: [], error: null },
    ]);

    await stockCard("document=V-1&documentKind=venta");

    expect(query.table).toBe("stock_card");
    expect(callsOf(query, "not")).toEqual([]);
    expect(unused.table).toBeNull();
  });

  it.each([
    ["type=regalo", "El tipo de movimiento no es válido."],
    ["from=2026-99-01", 'La fecha "from" no es válida. Usa el formato AAAA-MM-DD.'],
    ["to=ayer", 'La fecha "to" no es válida. Usa el formato AAAA-MM-DD.'],
    ["from=2026-10-05&to=2026-10-01", "La fecha inicial no puede ser posterior a la final."],
  ])("400 con %s", async (queryString, message) => {
    mockSupabase([]);

    await expectBadRequest(stockCard(queryString), message);
  });

  it("skip más allá del total: items vacíos y el total real", async () => {
    const [, total] = mockSupabase([
      { count: null, data: null, error: { code: "PGRST103", message: "range" }, status: 416 },
      { count: 7, data: null, error: null },
    ]);

    const result = await stockCard(`productId=${PRODUCT_ID}&skip=300`);

    expect(result).toEqual({ items: [], limit: 10, skip: 300, total: 7 });
    expect(callsOf(total, "select")[0][1]).toEqual({ count: "exact", head: true });
    expect(callsOf(total, "eq")).toEqual([
      ["store_id", DEFAULT_STORE_ID],
      ["product_id", PRODUCT_ID],
    ]);
  });

  it("paginación inválida cae a valores seguros", async () => {
    const [query] = mockSupabase([{ count: 0, data: [], error: null }]);

    await expect(stockCard("limit=abc&skip=-1")).resolves.toMatchObject({ items: [], total: 0 });
    expect(callsOf(query, "range")).toEqual([[0, 9]]);
  });
});
