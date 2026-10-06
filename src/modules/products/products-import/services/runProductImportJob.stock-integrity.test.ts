/**
 * @jest-environment node
 */
/**
 * STK-413 · regresión de C1 por el camino del import Excel: una fila con
 * `stock_inicial` acaba en el mismo `POST /api/products` → `createProduct` que el
 * formulario, y hereda el mismo hueco (stock sin movimiento `inventario_inicial`).
 *
 * El `it.failing` describe el comportamiento SANO y hoy falla: al corregir
 * `createProduct` (fase 5) hay que convertirlo en `it`.
 */

jest.mock("../../../../lib/supabase/route-client");
jest.mock("../../../../lib/supabase/admin-client");

import { POST as postProduct } from "@/app/api/products/route";
import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { runProductImportJob } from "./runProductImportJob";
import { revalidateProductImportRows } from "./validateProductImportRows";

type Row = Record<string, unknown>;
type Recorder = {
  inserts: Array<{ rows: Row[]; table: string }>;
  rpcs: Array<{ args: unknown; name: string }>;
};

const PRODUCT_ID = "66666666-6666-4666-8666-666666666666";

function toRows(payload: unknown): Row[] {
  const list = Array.isArray(payload) ? payload : [payload];
  return list.filter((row): row is Row => typeof row === "object" && row !== null);
}

/** Cliente Supabase mínimo: registra `insert` por tabla y `rpc`, y responde filas plausibles. */
function createSupabaseRecorder() {
  const recorder: Recorder = { inserts: [], rpcs: [] };
  let productRow: Row = { id: PRODUCT_ID };

  function builder(table: string) {
    const single = async () => ({
      data: table === "products" ? { ...productRow } : null,
      error: null,
    });
    const chain = {
      eq: () => chain,
      insert: (payload: unknown) => {
        const rows = toRows(payload);
        recorder.inserts.push({ rows, table });
        if (table === "products" && rows[0]) {
          productRow = { is_active: true, ...rows[0], id: PRODUCT_ID };
        }
        return chain;
      },
      maybeSingle: single,
      or: () => chain,
      select: () => chain,
      single,
    };

    return chain;
  }

  const client = {
    from: (table: string) => builder(table),
    rpc: async (name: string, args: unknown) => {
      recorder.rpcs.push({ args, name });
      return { data: { ...productRow, product_id: PRODUCT_ID }, error: null };
    },
  };

  return { client, recorder };
}

function containsValue(value: unknown, expected: number | string): boolean {
  if (value === expected) {
    return true;
  }
  if (typeof value === "object" && value !== null) {
    return Object.values(value).some((inner) => containsValue(inner, expected));
  }
  return false;
}

/** Mismo invariante que products.server.stock-integrity.test.ts (ver allí). */
function initialStockTrace(recorder: Recorder, quantity: number) {
  const movementInserted = recorder.inserts.some(
    (insert) =>
      insert.table === "stock_movements" &&
      insert.rows.some(
        (row) => containsValue(row, "inventario_inicial") && containsValue(row, quantity),
      ),
  );
  const rawStockInsert = recorder.inserts.some(
    (insert) =>
      insert.table === "products" && insert.rows.some((row) => Number(row.current_stock ?? 0) > 0),
  );
  const rpcCarriesQuantity = recorder.rpcs.some((call) => containsValue(call.args, quantity));

  return { registraInventarioInicial: movementInserted || (rpcCarriesQuantity && !rawStockInsert) };
}

describe("C1 · import Excel con stock_inicial", () => {
  const originalDataSource = process.env.API_DATA_SOURCE;
  const originalFetch = global.fetch;
  const posted: Array<{ body: Row; method: string; path: string }> = [];

  beforeEach(() => {
    jest.clearAllMocks();
    posted.length = 0;
    process.env.API_DATA_SOURCE = "supabase";
    (createAdminSupabaseClient as jest.Mock).mockReturnValue({
      from: jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            maybeSingle: jest.fn().mockResolvedValue({
              data: { store_id: DEFAULT_STORE_ID },
              error: null,
            }),
          })),
        })),
      })),
    });
    // El job habla con el BFF por fetch: se enlaza con el handler REAL de la ruta
    // para que la fila recorra validación zod → createProduct (server).
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? init.body : "";
      posted.push({ body: body ? (JSON.parse(body) as Row) : {}, method, path });

      if (method !== "POST" || path !== "/api/products") {
        return Response.json({ error: { code: "NOT_FOUND", message: path } }, { status: 404 });
      }

      return postProduct(
        new Request(`http://localhost${path}`, {
          body,
          headers: { "content-type": "application/json", "x-demo-role": "admin" },
          method,
        }),
      );
    }) as typeof fetch;
  });

  afterEach(() => {
    process.env.API_DATA_SOURCE = originalDataSource;
    global.fetch = originalFetch;
  });

  function validatedRowsWithInitialStock(quantity: number) {
    return revalidateProductImportRows(
      [
        {
          nombre: "Harina PAN import",
          precio_ref: 1.5,
          rowIndex: 3,
          sku: "stk413-import",
          stock_inicial: quantity,
        },
      ],
      { categories: [], existingSkus: new Set<string>() },
    );
  }

  // Control (sano hoy): documenta que el import NO tiene camino propio; manda
  // `currentStock = stock_inicial` al mismo endpoint que el formulario.
  it("una fila con stock_inicial se envía como currentStock a POST /api/products", async () => {
    const { client } = createSupabaseRecorder();
    (createRouteSupabaseClient as jest.Mock).mockResolvedValue(client);

    const results = await runProductImportJob({
      onError: "continue",
      rows: validatedRowsWithInitialStock(12),
    });

    expect(results).toEqual([{ rowIndex: 3, sku: "stk413-import", status: "success" }]);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({
      body: { currentStock: 12, sku: "stk413-import" },
      method: "POST",
      path: "/api/products",
    });
  });

  // Causa: la fila llega a `createProduct`, que inserta `current_stock` crudo sin
  // movimiento (C1). Un Excel de 300 filas deja 300 diffs en `stock_reconciliation`.
  // Evento: qa/STK-406/verdict.md C1 (H9); `w3-ui` f10 (import).
  // Código: runProductImportJob.ts:49 → src/app/api/products/route.ts:25-34 →
  // src/modules/products/services/products.server.ts:70-75, :173-180.
  it.failing(
    "una fila importada con stock_inicial N deja un movimiento inventario_inicial por N",
    async () => {
      const { client, recorder } = createSupabaseRecorder();
      (createRouteSupabaseClient as jest.Mock).mockResolvedValue(client);

      const results = await runProductImportJob({
        onError: "continue",
        rows: validatedRowsWithInitialStock(12),
      });

      // Si el alta falla por montaje, el test debe caer aquí y no en el invariante.
      expect(results).toEqual([{ rowIndex: 3, sku: "stk413-import", status: "success" }]);
      expect(initialStockTrace(recorder, 12)).toEqual({ registraInventarioInicial: true });
    },
  );
});
