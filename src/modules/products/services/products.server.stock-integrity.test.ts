/**
 * @jest-environment node
 */
/**
 * STK-413 · regresión de C1 (alta de producto con stock inicial sin movimiento
 * `inventario_inicial`).
 *
 * Los `it.failing` describen el comportamiento SANO y hoy fallan: al corregir
 * `createProduct` (fase 5) hay que convertirlos en `it`.
 */

jest.mock("../../../lib/supabase/route-client");
jest.mock("../../../lib/supabase/admin-client");

import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { mockStockMovements } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { createProduct as createProductMock } from "./products.mock-server";
import { createProduct } from "./products.server";

type Row = Record<string, unknown>;
type Recorder = {
  inserts: Array<{ rows: Row[]; table: string }>;
  rpcs: Array<{ args: unknown; name: string }>;
};

const PRODUCT_ID = "55555555-5555-4555-8555-555555555555";

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

/**
 * Invariante de C1 sin atarse a un diseño: o hay un insert de `stock_movements`
 * `inventario_inicial` por N, o el producto NO se insertó con stock crudo y una RPC
 * recibió N (p. ej. `adjust_stock(…, 'inventario_inicial')` o `create_product_with_stock`).
 */
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

function mockAdminStoreLookup() {
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
}

describe("C1 · alta de producto con stock inicial", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAdminStoreLookup();
  });

  // Causa: `toProductInsert` escribe `current_stock: input.currentStock` directo en
  // `products` y `createProduct` no llama a ninguna RPC ni inserta `stock_movements`:
  // diff permanente en `stock_reconciliation`.
  // Evento: qa/STK-406/verdict.md C1 (H9); `w1-matrix` `iva.new_product_stock_form`; `w4-hyp` `h09.*`.
  // Código: src/modules/products/services/products.server.ts:70-75 y :173-180.
  it.failing(
    "createProduct con stock N deja un movimiento inventario_inicial por N (server)",
    async () => {
      const { client, recorder } = createSupabaseRecorder();
      (createRouteSupabaseClient as jest.Mock).mockResolvedValue(client);

      const created = await createProduct(
        { currentStock: 7, name: "Harina PAN", salePriceRef: 1.5, sku: "stk413-harina" },
        DEFAULT_STORE_ID,
      );

      expect(created.id).toBe(PRODUCT_ID);
      expect(initialStockTrace(recorder, 7)).toEqual({ registraInventarioInicial: true });
    },
  );

  // Control: sin stock inicial no hace falta movimiento y el alta sigue funcionando
  // (protege contra un "arreglo" que rompa el camino normal).
  it("createProduct sin stock inicial inserta el producto con stock 0 (server)", async () => {
    const { client, recorder } = createSupabaseRecorder();
    (createRouteSupabaseClient as jest.Mock).mockResolvedValue(client);

    const created = await createProduct(
      { name: "Harina PAN", salePriceRef: 1.5, sku: "stk413-harina" },
      DEFAULT_STORE_ID,
    );

    expect(created.id).toBe(PRODUCT_ID);
    expect(created.currentStock).toBe(0);
    expect(
      recorder.inserts.some(
        (insert) =>
          insert.table === "products" &&
          insert.rows.some((row) => Number(row.current_stock ?? 0) > 0),
      ),
    ).toBe(false);
  });

  // Paridad server/mock: el mock-server tiene libro de movimientos
  // (`mockStockMovements`, lo usa inventory.mock-server) y tampoco registra el alta.
  // Evento: mismo que el server (H9). Código: src/modules/products/services/products.mock-server.ts:210-239.
  it.failing(
    "createProduct con stock N deja un movimiento inventario_inicial por N (mock-server)",
    () => {
      const created = createProductMock(
        { currentStock: 9, name: "Harina PAN mock", salePriceRef: 1.5, sku: "stk413-harina-mock" },
        DEFAULT_STORE_ID,
      );

      expect(created.currentStock).toBe(9);
      expect(
        mockStockMovements
          .filter((movement) => movement.productId === created.id)
          .map((movement) => ({
            quantityDelta: movement.quantityDelta,
            stockAfter: movement.stockAfter,
            type: movement.type,
          })),
      ).toEqual([{ quantityDelta: 9, stockAfter: 9, type: "inventario_inicial" }]);
    },
  );
});
