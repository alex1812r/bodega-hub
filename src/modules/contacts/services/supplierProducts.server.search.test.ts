/**
 * @jest-environment node
 *
 * GQ-06 · la búsqueda de productos por proveedor usaba un `escapeIlike` propio
 * que solo quitaba `%`, `_` y `,`: un paréntesis, unas comillas o un `*` del
 * término llegaban al `or=(…)` de PostgREST como sintaxis. Ahora usa el helper
 * común de búsqueda (`productSearch`), igual que productos y contactos.
 */

jest.mock("../../../lib/supabase/route-client");
jest.mock("../../../lib/supabase/admin-client");

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { listSupplierProducts } from "./supplierProducts.server";

function mountSupabase(matchingProductIds: string[]) {
  const calls: Array<{ args: unknown[]; method: string; table: string }> = [];

  function chainFor(table: string) {
    const result =
      table === "products"
        ? { data: matchingProductIds.map((id) => ({ id })), error: null }
        : { count: 0, data: [], error: null };
    const chain: Record<string, unknown> = {};
    const record =
      (method: string) =>
      (...args: unknown[]) => {
        calls.push({ args, method, table });

        return chain;
      };

    for (const method of ["select", "eq", "in", "is", "order", "range", "limit"]) {
      chain[method] = jest.fn(record(method));
    }

    chain.or = jest.fn(record("or"));
    chain.ilike = jest.fn(record("ilike"));
    // La consulta es «thenable»: se resuelve al esperarla, tras encadenar filtros.
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);

    return chain;
  }

  (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
    from: jest.fn((table: string) => chainFor(table)),
    rpc: jest.fn(),
  });

  return (table: string, method: string) =>
    calls.filter((call) => call.table === table && call.method === method).map((call) => call.args);
}

function search(term: string) {
  return listSupplierProducts(new URLSearchParams({ search: term }), DEFAULT_STORE_ID);
}

describe("supplierProducts.server · búsqueda con el helper común (GQ-06)", () => {
  it("con productos que casan: el término con paréntesis y coma viaja entre comillas en el or", async () => {
    const calls = mountSupabase(["p-1", "p-2"]);

    await search("caja (x12), roja");

    expect(calls("products", "or")).toEqual([
      ['name.ilike."%caja (x12), roja%",sku.ilike."%caja (x12), roja%",barcode.ilike."%caja (x12), roja%"'],
    ]);
    expect(calls("supplier_products", "or")[0]).toEqual([
      'supplier_sku.ilike."%caja (x12), roja%",product_id.in.("p-1","p-2")',
    ]);
  });

  it("comodines, comillas y barras del término no llegan como sintaxis: se cambian por `_`", async () => {
    const calls = mountSupabase(["p-1"]);

    await search('a*b"c\\d%e');

    expect(calls("products", "or")).toEqual([
      ["name.ilike.%a_b_c_d_e%,sku.ilike.%a_b_c_d_e%,barcode.ilike.%a_b_c_d_e%"],
    ]);
    expect(calls("supplier_products", "or")[0]).toEqual([
      'supplier_sku.ilike.%a_b_c_d_e%,product_id.in.("p-1")',
    ]);
  });

  it("sin productos que casen: busca solo por el SKU del proveedor, con el mismo escape", async () => {
    const calls = mountSupabase([]);

    await search('tor*nillo "m8"');

    expect(calls("supplier_products", "ilike")[0]).toEqual(["supplier_sku", "%tor_nillo _m8_%"]);
    expect(calls("supplier_products", "or")).toEqual([]);
  });

  it("sin término no filtra ni consulta productos", async () => {
    const calls = mountSupabase([]);

    await search("   ");

    expect(calls("products", "or")).toEqual([]);
    expect(calls("supplier_products", "ilike")).toEqual([]);
    expect(calls("supplier_products", "or")).toEqual([]);
  });
});
