/**
 * @jest-environment node
 */

jest.mock("../../../lib/supabase/route-client");

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { createFakePostgrest } from "@/modules/reports/services/testing/fakePostgrest";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { listSupplierProductAliases } from "./supplierProductAliases.server";

/**
 * REP6-05 (patrón C6-M3): la lista de alias del proveedor no puede depender del
 * corte de 1000 filas de PostgREST ni de un tope propio que corte en silencio, y
 * el filtro `in` de vínculos no puede pasar del largo de URL que acepta el servidor.
 */
const SUPPLIER = "33333333-3333-4333-8333-333333333333";
const ALIAS_COUNT = 1200;
const PRODUCT_COUNT = 400;

function uuid(prefix: string, index: number) {
  return `${prefix}-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function aliasRows() {
  return Array.from({ length: ALIAS_COUNT }, (_, index) => ({
    alias_norm: `alias ${index}`,
    hits: 1,
    id: uuid("aaaaaaaa", index),
    // Varios alias comparten fecha: el orden necesita desempate estable.
    last_seen_at: `2026-10-${String(1 + (index % 20)).padStart(2, "0")}T12:00:00+00:00`,
    pack_label: null,
    product_id: uuid("bbbbbbbb", index % PRODUCT_COUNT),
    "products(name)": null,
    store_id: DEFAULT_STORE_ID,
    supplier_id: SUPPLIER,
    units_per_pack: null,
  }));
}

function linkRows() {
  return Array.from({ length: PRODUCT_COUNT }, (_, index) => ({
    product_id: uuid("bbbbbbbb", index),
    store_id: DEFAULT_STORE_ID,
    supplier_id: SUPPLIER,
  }));
}

describe("listSupplierProductAliases · más de 1000 alias (REP6-05)", () => {
  it("devuelve todos los alias, sin repetir, y marca los vínculos de los 400 productos", async () => {
    const fake = createFakePostgrest({
      supplier_product_aliases: aliasRows(),
      supplier_products: linkRows(),
    });
    (createRouteSupabaseClient as jest.Mock).mockResolvedValue(fake.client);

    const { items } = await listSupplierProductAliases(SUPPLIER, DEFAULT_STORE_ID);

    expect(items).toHaveLength(ALIAS_COUNT);
    expect(new Set(items.map((item) => item.id)).size).toBe(ALIAS_COUNT);
    expect(items.every((item) => item.inSupplierProducts)).toBe(true);
    // Del más reciente al más antiguo.
    expect(items[0].lastSeenAt >= items[items.length - 1].lastSeenAt).toBe(true);
    // Ninguna petición devolvió "URI too long".
    expect(fake.requests.every((request) => request.urlLength <= 8000)).toBe(true);
  });
});
