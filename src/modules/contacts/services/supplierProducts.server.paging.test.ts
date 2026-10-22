/**
 * @jest-environment node
 */

jest.mock("../../../lib/supabase/route-client");

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { createFakePostgrest } from "@/modules/reports/services/testing/fakePostgrest";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { listSupplierProducts } from "./supplierProducts.server";

/**
 * REP6-05 (patrón C6-M3): la página de productos del proveedor
 * (`GET /api/suppliers/[id]/products`) completa el último origen de precio, la
 * variación y los empaques con lecturas por los ids de la página. PostgREST corta
 * cada respuesta en 1000 filas: con 100 productos y una docena de cambios de
 * precio o de empaques cada uno, los últimos productos se quedaban sin ellos.
 */
const SUPPLIER = "33333333-3333-4333-8333-333333333333";
const PAGE = 100;
const PER_PRODUCT = 12;

function uuid(prefix: string, index: number) {
  return `${prefix}-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function supplierProductRows() {
  return Array.from({ length: PAGE }, (_, index) => ({
    id: uuid("cccccccc", index),
    is_active: true,
    last_cost_ref: 1,
    product_id: uuid("bbbbbbbb", index),
    store_id: DEFAULT_STORE_ID,
    supplier_id: SUPPLIER,
    updated_at: `2026-10-${String(1 + (index % 20)).padStart(2, "0")}T00:00:00+00:00`,
  }));
}

/** El producto `index` tiene sus cambios de precio más antiguos cuanto mayor es `index`. */
function historyRows() {
  return Array.from({ length: PAGE }).flatMap((_, index) =>
    Array.from({ length: PER_PRODUCT }, (__, step) => ({
      created_at: new Date(Date.UTC(2026, 9, 1) - (index * PER_PRODUCT + step) * 60_000).toISOString(),
      id: uuid("dddddddd", index * PER_PRODUCT + step),
      new_cost_ref: step === 0 ? 11 : 10,
      old_cost_ref: 10,
      origin: step === 0 ? "compra" : "ajuste",
      supplier_product_id: uuid("cccccccc", index),
    })),
  );
}

function packUnitRows() {
  return Array.from({ length: PAGE }).flatMap((_, index) =>
    Array.from({ length: PER_PRODUCT }, (__, step) => ({
      id: uuid("eeeeeeee", index * PER_PRODUCT + step),
      is_active: true,
      is_default: step === 0,
      label: `Caja ${String(step).padStart(2, "0")}`,
      supplier_product_id: uuid("cccccccc", index),
      units_per_pack: step + 2,
    })),
  );
}

/** `supplier_products` lleva embebidos que el doble no proyecta: se sirve la página tal cual. */
function supplierProductsPage(rows: ReturnType<typeof supplierProductRows>) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "range", "ilike", "or"]) {
    chain[method] = () => chain;
  }
  chain.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve({ count: rows.length, data: rows, error: null, status: 200 }).then(resolve);
  return chain;
}

describe("listSupplierProducts · más de 1000 filas de historial y empaques (REP6-05)", () => {
  it("el último producto de la página conserva origen, variación y empaques", async () => {
    const fake = createFakePostgrest({
      supplier_product_pack_units: packUnitRows(),
      supplier_product_price_history: historyRows(),
    });
    const rows = supplierProductRows();
    (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
      from: (table: string) => (table === "supplier_products" ? supplierProductsPage(rows) : fake.client.from(table)),
    });

    const params = new URLSearchParams({ limit: String(PAGE), supplierId: SUPPLIER });
    const result = await listSupplierProducts(params, DEFAULT_STORE_ID);

    expect(result.items).toHaveLength(PAGE);
    const withoutHistory = result.items.filter((item) => item.lastPriceOrigin !== "compra" || item.variationPercent !== 10);
    const withoutPacks = result.items.filter(
      (item) => item.packUnits?.length !== PER_PRODUCT || item.defaultPackUnit?.label !== "Caja 00",
    );
    expect({ withoutHistory: withoutHistory.length, withoutPacks: withoutPacks.length }).toEqual({
      withoutHistory: 0,
      withoutPacks: 0,
    });
  });
});
