/**
 * @jest-environment node
 *
 * PRO-F13 · el servicio real escribe `products.description`: en el insert del
 * alta (`null` sin ella), en el update de la edición solo si viaja, y la huella
 * de idempotencia del alta la incluye.
 */

jest.mock("../../../lib/supabase/route-client");
jest.mock("../../../lib/supabase/admin-client");

import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { createProduct, updateProduct } from "./products.server";

type Row = Record<string, unknown>;

const PRODUCT_ID = "55555555-5555-4555-8555-555555555555";
const CATEGORY_ID = "11111111-1111-4111-8111-111111111111";

/** Cliente Supabase mínimo: una fila de `products` en memoria y una categoría activa. */
function installSupabase() {
  const inserts: Row[] = [];
  const updates: Row[] = [];
  let productRow: Row = {
    category_id: CATEGORY_ID,
    description: "Guardada",
    id: PRODUCT_ID,
    is_active: true,
    name: "Guardado",
    sale_price_ref: 10,
    sku: "guardado",
  };

  function builder(table: string) {
    const filters: Row = {};

    const result = async () => {
      if (table === "categories") {
        return { data: { id: CATEGORY_ID, is_active: true }, error: null };
      }

      // Antes del insert no hay ningún producto con la clave de idempotencia.
      if ("client_request_id" in filters && inserts.length === 0) {
        return { data: null, error: null };
      }

      return { data: table === "products" ? { ...productRow } : null, error: null };
    };

    const chain = {
      eq: (column: string, value: unknown) => {
        filters[column] = value;
        return chain;
      },
      insert: (row: Row) => {
        inserts.push(row);
        productRow = { is_active: true, ...row, id: PRODUCT_ID };
        return chain;
      },
      maybeSingle: result,
      select: () => chain,
      single: result,
      update: (row: Row) => {
        updates.push(row);
        productRow = { ...productRow, ...row };
        return chain;
      },
    };

    return chain;
  }

  (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ from: builder, rpc: jest.fn() });

  return { inserts, updates };
}

beforeEach(() => {
  jest.clearAllMocks();
  (createAdminSupabaseClient as jest.Mock).mockReturnValue({
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          maybeSingle: jest
            .fn()
            .mockResolvedValue({ data: { store_id: DEFAULT_STORE_ID }, error: null }),
        })),
      })),
    })),
  });
});

const base = { categoryId: CATEGORY_ID, name: "Harina", salePriceRef: 2 };

describe("products.server · descripción (PRO-F13)", () => {
  it("createProduct inserta la descripción y la devuelve", async () => {
    const { inserts } = installSupabase();

    const created = await createProduct({ ...base, description: "Harina fina" }, DEFAULT_STORE_ID);

    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({ description: "Harina fina", name: "Harina" });
    expect(created.description).toBe("Harina fina");
  });

  it("createProduct sin descripción inserta `null`", async () => {
    const { inserts } = installSupabase();

    await createProduct(base, DEFAULT_STORE_ID);

    expect(inserts[0]).toHaveProperty("description", null);
  });

  it("updateProduct escribe el cambio, `null` al vaciarla y nada si no viaja", async () => {
    const { updates } = installSupabase();

    await updateProduct(PRODUCT_ID, { description: "Nueva" }, DEFAULT_STORE_ID);
    await updateProduct(PRODUCT_ID, { description: null }, DEFAULT_STORE_ID);
    await updateProduct(PRODUCT_ID, { minStock: 3 }, DEFAULT_STORE_ID);

    expect(updates).toEqual([{ description: "Nueva" }, { description: null }, { min_stock: 3 }]);
  });

  it("la huella de idempotencia del alta cambia con la descripción y se repite con el mismo cuerpo", async () => {
    const clientRequestId = "f13f13f1-3f13-4f13-8f13-f13f13f13f13";
    const hashOf = async (description?: string) => {
      const { inserts } = installSupabase();

      await createProduct(
        { ...base, clientRequestId, ...(description ? { description } : {}) },
        DEFAULT_STORE_ID,
      );

      return inserts[0].client_request_hash;
    };

    const withDescription = await hashOf("Harina fina");

    expect(withDescription).toEqual(expect.stringMatching(/^[0-9a-f]{64}$/));
    expect(await hashOf("Harina fina")).toBe(withDescription);
    expect(await hashOf("Otra")).not.toBe(withDescription);
    expect(await hashOf()).not.toBe(withDescription);
  });
});
