/**
 * @jest-environment node
 */
/**
 * REP9-01 (D41-a) · `loadLastUnitCostRefs`: el último costo por unidad REF de unos productos con
 * las mismas consultas y el mismo criterio que `loadMatchContext` + `lastUnitCostRefOf` (D38):
 * última línea recibida del proveedor, si no de cualquiera, si no `current_cost_ref`; con receta,
 * repartido entre las unidades de la conversión. Todo filtrado por la tienda del servidor.
 */
import { loadLastUnitCostRefs, type MatchContextSupabaseClient } from "./loadMatchContext";

const STORE_ID = "00000000-0000-4000-8000-000000000001";
const MALTA = "22222222-2222-4222-8222-000000000001";
const POLAR = "22222222-2222-4222-8222-000000000002";
const CAJA = "22222222-2222-4222-8222-000000000003";
const NUEVO = "22222222-2222-4222-8222-000000000004";
const CERO = "22222222-2222-4222-8222-000000000005";
const OTRA_TIENDA = "22222222-2222-4222-8222-000000000006";
const SUPPLIER_ID = "11111111-1111-4111-8111-111111111111";

type Call = { method: string; args: unknown[] };
type Query = { table: string; calls: Call[] };

const hasCall = (query: Query, method: string, ...args: unknown[]) =>
  query.calls.some((call) => call.method === method && args.every((arg, index) => call.args[index] === arg));

function selectOf(query: Query): string {
  return String(query.calls.find((call) => call.method === "select")?.args[0] ?? "");
}

function createStub(respond: (query: Query) => unknown[]) {
  const queries: Query[] = [];
  const from = (table: string) => {
    const query: Query = { table, calls: [] };
    queries.push(query);
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "order", "limit", "range"]) {
      chain[method] = (...args: unknown[]) => {
        query.calls.push({ method, args });
        return chain;
      };
    }
    chain.then = (resolve: (value: unknown) => unknown) => resolve({ data: respond(query), error: null });
    return chain;
  };
  return { client: { from } as unknown as MatchContextSupabaseClient, queries };
}

const product = (id: string, current: number | null) => ({
  id,
  name: id,
  sku: null,
  barcode: null,
  is_active: true,
  current_cost_ref: current,
  category: null,
});

describe("loadLastUnitCostRefs", () => {
  it("proveedor > cualquiera > current_cost_ref; receta repartida; sin dato o fuera de la tienda, null", async () => {
    const { client, queries } = createStub((query) => {
      if (query.table === "product_pack_conversions") {
        return [{ pack_product_id: CAJA, total_units: 36 }];
      }
      if (selectOf(query).includes("purchase_items")) {
        return hasCall(query, "eq", "purchase_items.purchases.supplier_id", SUPPLIER_ID)
          ? [{ id: MALTA, purchase_items: [{ unit_cost_ref: "0.84" }] }]
          : [
              { id: MALTA, purchase_items: [{ unit_cost_ref: 9 }] },
              { id: POLAR, purchase_items: [{ unit_cost_ref: 1.1 }] },
              { id: CAJA, purchase_items: [{ unit_cost_ref: 18 }] },
              { id: NUEVO, purchase_items: [] },
            ];
      }
      return [product(MALTA, 5), product(POLAR, 5), product(CAJA, 5), product(NUEVO, 2.17), product(CERO, 0)];
    });

    const costs = await loadLastUnitCostRefs(
      client,
      STORE_ID,
      [MALTA, POLAR, CAJA, NUEVO, CERO, OTRA_TIENDA],
      SUPPLIER_ID,
    );

    expect(costs).toEqual([
      { productId: MALTA, lastUnitCostRef: 0.84 },
      { productId: POLAR, lastUnitCostRef: 1.1 },
      { productId: CAJA, lastUnitCostRef: 0.5 },
      { productId: NUEVO, lastUnitCostRef: 2.17 },
      { productId: CERO, lastUnitCostRef: null },
      { productId: OTRA_TIENDA, lastUnitCostRef: null },
    ]);
    expect(queries.length).toBeGreaterThan(0);
    for (const query of queries) {
      expect(hasCall(query, "eq", "store_id", STORE_ID)).toBe(true);
    }
  });

  it("sin proveedor no consulta las líneas del proveedor", async () => {
    const { client, queries } = createStub((query) =>
      selectOf(query).includes("purchase_items") ? [] : query.table === "products" ? [product(MALTA, 0.9)] : [],
    );

    await expect(loadLastUnitCostRefs(client, STORE_ID, [MALTA])).resolves.toEqual([
      { productId: MALTA, lastUnitCostRef: 0.9 },
    ]);
    expect(queries.some((query) => query.calls.some((call) => call.args[0] === "purchase_items.purchases.supplier_id"))).toBe(
      false,
    );
  });

  it("un id que no es uuid no puede existir: null sin consultar (Postgres lo rechazaría)", async () => {
    const { client, queries } = createStub(() => []);

    await expect(loadLastUnitCostRefs(client, STORE_ID, ["prod-lote-1"])).resolves.toEqual([
      { productId: "prod-lote-1", lastUnitCostRef: null },
    ]);
    expect(queries).toEqual([]);
  });
});
