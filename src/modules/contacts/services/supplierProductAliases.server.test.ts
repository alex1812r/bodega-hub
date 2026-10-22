/**
 * @jest-environment node
 */

jest.mock("../../../lib/supabase/route-client");

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { listSupplierProductAliases, removeSupplierProductAlias } from "./supplierProductAliases.server";

const SUPPLIER = "33333333-3333-4333-8333-333333333333";
const ALIAS = "55555555-5555-4555-8555-555555555555";
const PRODUCT_A = "11111111-1111-4111-8111-111111111111";
const PRODUCT_B = "22222222-2222-4222-8222-222222222222";

/** Builder encadenable de PostgREST que resuelve con `result` al final. */
function chain(result: { data: unknown; error: unknown }) {
  const builder: Record<string, jest.Mock> = {};
  const self = () => builder;

  for (const method of ["select", "eq", "order", "in"]) {
    builder[method] = jest.fn(self);
  }
  builder.limit = jest.fn().mockResolvedValue(result);
  // Una página con las filas y después la vacía que cierra la lectura paginada.
  builder.range = jest.fn().mockResolvedValueOnce(result).mockResolvedValue({ data: [], error: null });
  builder.maybeSingle = jest.fn().mockResolvedValue(result);
  (builder as unknown as { then: unknown }).then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve(result).then(resolve);

  return builder;
}

function routeClient(tables: Record<string, ReturnType<typeof chain>>, rpc = jest.fn()) {
  const from = jest.fn((table: string) => tables[table]);

  (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ from, rpc });

  return { from, rpc };
}

describe("supplierProductAliases.server", () => {
  beforeEach(() => jest.clearAllMocks());

  it("lista por tienda y proveedor, mapea producto y marca si está en supplier_products", async () => {
    const aliases = chain({
      data: [
        {
          alias_norm: "harina pan 1kg",
          hits: 3,
          id: ALIAS,
          last_seen_at: "2026-10-14T12:00:00+00:00",
          pack_label: "Bulto",
          product_id: PRODUCT_A,
          products: { name: "Harina PAN" },
          units_per_pack: 20,
        },
        {
          alias_norm: "arroz",
          hits: 1,
          id: "66666666-6666-4666-8666-666666666666",
          last_seen_at: "2026-10-13T12:00:00+00:00",
          pack_label: null,
          product_id: PRODUCT_B,
          products: null,
          units_per_pack: null,
        },
      ],
      error: null,
    });
    const links = chain({ data: [{ product_id: PRODUCT_A }], error: null });
    routeClient({ supplier_product_aliases: aliases, supplier_products: links });

    const result = await listSupplierProductAliases(SUPPLIER, DEFAULT_STORE_ID);

    expect(aliases.eq).toHaveBeenCalledWith("store_id", DEFAULT_STORE_ID);
    expect(aliases.eq).toHaveBeenCalledWith("supplier_id", SUPPLIER);
    expect(links.in).toHaveBeenCalledWith("product_id", [PRODUCT_A, PRODUCT_B]);
    expect(result.items).toEqual([
      {
        aliasNorm: "harina pan 1kg",
        hits: 3,
        id: ALIAS,
        inSupplierProducts: true,
        lastSeenAt: "2026-10-14T12:00:00+00:00",
        packLabel: "Bulto",
        productId: PRODUCT_A,
        productName: "Harina PAN",
        unitsPerPack: 20,
      },
      expect.objectContaining({ inSupplierProducts: false, productId: PRODUCT_B, productName: null }),
    ]);
  });

  it("proveedor con id no uuid → lista vacía sin consultar", async () => {
    const { from } = routeClient({});

    await expect(listSupplierProductAliases("cont-x", DEFAULT_STORE_ID)).resolves.toEqual({ items: [] });
    expect(from).not.toHaveBeenCalled();
  });

  it("quita con la RPC si el alias es del proveedor y la tienda", async () => {
    const owned = chain({ data: { id: ALIAS }, error: null });
    const rpc = jest.fn().mockResolvedValue({ data: ALIAS, error: null });
    routeClient({ supplier_product_aliases: owned }, rpc);

    await expect(removeSupplierProductAlias(SUPPLIER, ALIAS, DEFAULT_STORE_ID)).resolves.toEqual({ id: ALIAS });
    expect(owned.eq).toHaveBeenCalledWith("supplier_id", SUPPLIER);
    expect(rpc).toHaveBeenCalledWith("remove_supplier_product_alias", { p_alias_id: ALIAS });
  });

  it("alias de otro proveedor o tienda → 404 sin llamar a la RPC", async () => {
    const rpc = jest.fn();
    routeClient({ supplier_product_aliases: chain({ data: null, error: null }) }, rpc);

    await expect(removeSupplierProductAlias(SUPPLIER, ALIAS, DEFAULT_STORE_ID)).rejects.toMatchObject({ status: 404 });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("id no uuid → 404; PT404 / PT403 de la RPC → 404 / 403", async () => {
    await expect(removeSupplierProductAlias(SUPPLIER, "x", DEFAULT_STORE_ID)).rejects.toMatchObject({ status: 404 });

    for (const [code, status] of [
      ["PT404", 404],
      ["PT403", 403],
    ] as const) {
      routeClient(
        { supplier_product_aliases: chain({ data: { id: ALIAS }, error: null }) },
        jest.fn().mockResolvedValue({ data: null, error: { code, message: "x" } }),
      );
      await expect(removeSupplierProductAlias(SUPPLIER, ALIAS, DEFAULT_STORE_ID)).rejects.toMatchObject({ status });
    }
  });
});
