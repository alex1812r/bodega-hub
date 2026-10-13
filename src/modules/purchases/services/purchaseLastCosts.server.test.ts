/**
 * @jest-environment node
 */
/**
 * COM-F11 · último costo de compra en el servidor real: una consulta para todos los
 * productos (dos si alguno no lo vendió ese proveedor), con la sesión del usuario,
 * solo compras recibidas, la más reciente por producto.
 */

jest.mock("../../../lib/supabase/route-client");
jest.mock("../../../lib/supabase/admin-client");

import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";

import { listPurchaseLastCosts } from "./purchaseLastCosts.server";

const STORE_ID = "00000000-0000-4000-8000-000000000001";
const SUPPLIER_ID = "11111111-1111-4111-8111-111111111111";
const DRILL_ID = "22222222-2222-4222-8222-222222222222";
const CABLE_ID = "33333333-3333-4333-8333-333333333333";
const NEVER_BOUGHT_ID = "44444444-4444-4444-8444-444444444444";

type QueryResult = { data?: unknown; error?: unknown };
type QueryMock = Record<"eq" | "in" | "order" | "select", jest.Mock> & { limit: jest.Mock };

/** Cada `from("products")` consume el siguiente resultado y deja su consulta en `queries`. */
function mockProductQueries(...results: QueryResult[]) {
  const queries: QueryMock[] = [];
  const from = jest.fn(() => {
    const result = results[queries.length] ?? { data: [] };
    const query: QueryMock = {
      eq: jest.fn(() => query),
      in: jest.fn(() => query),
      limit: jest.fn(async () => result),
      order: jest.fn(() => query),
      select: jest.fn(() => query),
    };

    queries.push(query);

    return query;
  });

  (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ from });

  return { from, queries };
}

describe("purchaseLastCosts.server", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    // Lee con la sesión del usuario (RLS), nunca con la clave de servicio.
    expect(createAdminSupabaseClient).not.toHaveBeenCalled();
  });

  it("una consulta para todos los productos: recibidas de ese proveedor, la más reciente de cada uno", async () => {
    const { from, queries } = mockProductQueries({
      data: [
        { id: DRILL_ID, purchase_items: [{ tax_rate: 0, unit_cost_ref: 2494.41 }] },
        { id: CABLE_ID, purchase_items: [{ tax_rate: "16.00", unit_cost_ref: "1.48" }] },
      ],
    });

    const costs = await listPurchaseLastCosts(
      { productIds: [DRILL_ID, CABLE_ID, DRILL_ID], supplierId: SUPPLIER_ID },
      STORE_ID,
    );

    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith("products");
    expect(queries[0].select).toHaveBeenCalledWith(
      "id, purchase_items(unit_cost_ref, tax_rate, purchases!inner(created_at))",
    );
    expect(queries[0].in).toHaveBeenCalledWith("id", [DRILL_ID, CABLE_ID]);
    expect(queries[0].eq.mock.calls).toEqual([
      ["store_id", STORE_ID],
      ["purchase_items.purchases.store_id", STORE_ID],
      ["purchase_items.purchases.status", "recibido"],
      ["purchase_items.purchases.supplier_id", SUPPLIER_ID],
    ]);
    expect(queries[0].order).toHaveBeenCalledWith("purchases(created_at)", {
      ascending: false,
      referencedTable: "purchase_items",
    });
    expect(queries[0].limit).toHaveBeenCalledWith(1, { referencedTable: "purchase_items" });
    expect(costs).toEqual([
      { productId: DRILL_ID, source: "supplier", taxRate: 0, unitCostRef: 2494.41 },
      { productId: CABLE_ID, source: "supplier", taxRate: 16, unitCostRef: 1.48 },
    ]);
  });

  it("los que ese proveedor nunca vendió se buscan, en UNA segunda consulta, en cualquier proveedor", async () => {
    const { from, queries } = mockProductQueries(
      {
        data: [
          { id: DRILL_ID, purchase_items: [{ tax_rate: 16, unit_cost_ref: 2494.41 }] },
          { id: CABLE_ID, purchase_items: [] },
          { id: NEVER_BOUGHT_ID, purchase_items: [] },
        ],
      },
      {
        data: [
          { id: CABLE_ID, purchase_items: [{ tax_rate: null, unit_cost_ref: 2 }] },
          { id: NEVER_BOUGHT_ID, purchase_items: [] },
        ],
      },
    );

    const costs = await listPurchaseLastCosts(
      { productIds: [DRILL_ID, CABLE_ID, NEVER_BOUGHT_ID], supplierId: SUPPLIER_ID },
      STORE_ID,
    );

    expect(from).toHaveBeenCalledTimes(2);
    expect(queries[1].in).toHaveBeenCalledWith("id", [CABLE_ID, NEVER_BOUGHT_ID]);
    // Misma regla de estado y tienda, sin filtro de proveedor.
    expect(queries[1].eq.mock.calls).toEqual([
      ["store_id", STORE_ID],
      ["purchase_items.purchases.store_id", STORE_ID],
      ["purchase_items.purchases.status", "recibido"],
    ]);
    expect(queries[1].limit).toHaveBeenCalledWith(1, { referencedTable: "purchase_items" });
    // El producto sin ninguna línea recibida no aparece.
    expect(costs).toEqual([
      { productId: DRILL_ID, source: "supplier", taxRate: 16, unitCostRef: 2494.41 },
      { productId: CABLE_ID, source: "any", taxRate: 0, unitCostRef: 2 },
    ]);
  });

  it("no consulta ids que no son uuid, y con un proveedor que no lo es busca en cualquiera", async () => {
    const none = mockProductQueries();

    expect(
      await listPurchaseLastCosts({ productIds: ["prod-drill"], supplierId: SUPPLIER_ID }, STORE_ID),
    ).toEqual([]);
    expect(none.from).not.toHaveBeenCalled();

    const { from, queries } = mockProductQueries({
      data: [{ id: DRILL_ID, purchase_items: [{ tax_rate: 16, unit_cost_ref: 5 }] }],
    });

    const costs = await listPurchaseLastCosts(
      { productIds: [DRILL_ID, "prod-cable"], supplierId: "cont-supplier" },
      STORE_ID,
    );

    expect(from).toHaveBeenCalledTimes(1);
    expect(queries[0].in).toHaveBeenCalledWith("id", [DRILL_ID]);
    expect(queries[0].eq).not.toHaveBeenCalledWith(
      "purchase_items.purchases.supplier_id",
      expect.anything(),
    );
    expect(costs).toEqual([{ productId: DRILL_ID, source: "any", taxRate: 16, unitCostRef: 5 }]);
  });

  it("propaga el error de la consulta", async () => {
    mockProductQueries({ error: { code: "42501", message: "permission denied" } });

    await expect(
      listPurchaseLastCosts({ productIds: [DRILL_ID], supplierId: SUPPLIER_ID }, STORE_ID),
    ).rejects.toBeDefined();
  });
});
