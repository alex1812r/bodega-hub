/**
 * @jest-environment node
 *
 * PRO-F10 · medios de CAOS en el servicio real de productos:
 * - M3/M4: la categoría de un alta o de un cambio de categoría existe, es de la
 *   tienda del servidor y está activa; no se puede dejar vacía.
 * - M5: el PATCH no escribe `sale_price_ref`; un precio distinto pasa por la RPC
 *   `update_product_price` (historial e instantánea).
 * - M6: la búsqueda del listado se recorta.
 */

jest.mock("../../../lib/supabase/route-client");
jest.mock("../../../lib/supabase/admin-client");

import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { createProduct, listProducts, updateProduct } from "./products.server";

type Row = Record<string, unknown>;
type SupabaseError = { code: string; message: string };

const PRODUCT_ID = "55555555-5555-4555-8555-555555555555";
const OWN_CATEGORY = "11111111-1111-4111-8111-111111111111";
const OTHER_OWN_CATEGORY = "22222222-2222-4222-8222-222222222222";
const INACTIVE_CATEGORY = "33333333-3333-4333-8333-333333333333";
const FOREIGN_CATEGORY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_STORE_ID = "00000000-0000-4000-8000-000000000002";

const CATEGORY_MESSAGE = "La categoría no existe o no pertenece a esta tienda.";

const categories: Row[] = [
  { id: OWN_CATEGORY, is_active: true, store_id: DEFAULT_STORE_ID },
  { id: OTHER_OWN_CATEGORY, is_active: true, store_id: DEFAULT_STORE_ID },
  { id: INACTIVE_CATEGORY, is_active: false, store_id: DEFAULT_STORE_ID },
  { id: FOREIGN_CATEGORY, is_active: true, store_id: OTHER_STORE_ID },
];

type InstallOptions = {
  product?: Row;
  rpcError?: SupabaseError | null;
  updateError?: SupabaseError | null;
};

/**
 * Cliente Supabase mínimo: `products` es una sola fila en memoria, `categories`
 * se filtra por los `eq` recibidos y la RPC `update_product_price` cambia el
 * precio de la fila. `log` guarda el orden de las escrituras.
 */
function installSupabase(options: InstallOptions = {}) {
  const log: string[] = [];
  const inserts: Row[] = [];
  const updates: Row[] = [];
  const categoryReads: Row[] = [];
  let productRow: Row = {
    category_id: OWN_CATEGORY,
    current_cost_ref: 8,
    id: PRODUCT_ID,
    is_active: true,
    name: "Guardado",
    sale_price_ref: 10,
    sku: "guardado",
    ...options.product,
  };

  function builder(table: string) {
    const filters: Row = {};
    let writeError: SupabaseError | null = null;

    const result = async () => {
      if (writeError) {
        return { data: null, error: writeError };
      }

      if (table === "categories") {
        categoryReads.push({ ...filters });

        return {
          data: categories.find((row) => Object.entries(filters).every(([key, value]) => row[key] === value)) ?? null,
          error: null,
        };
      }

      return { data: table === "products" ? { ...productRow } : null, error: null };
    };

    const chain = {
      eq: (column: string, value: unknown) => {
        filters[column] = value;
        return chain;
      },
      insert: (row: Row) => {
        log.push("insert");
        inserts.push(row);
        productRow = { is_active: true, ...row, id: PRODUCT_ID };
        return chain;
      },
      maybeSingle: result,
      or: () => chain,
      select: () => chain,
      single: result,
      update: (row: Row) => {
        log.push("update");
        updates.push(row);
        writeError = options.updateError ?? null;
        if (!writeError) {
          productRow = { ...productRow, ...row };
        }
        return chain;
      },
    };

    return chain;
  }

  const rpc = jest.fn(async (name: string, args: Row) => {
    log.push(`rpc:${name}`);

    if (options.rpcError) {
      return { data: null, error: options.rpcError };
    }

    productRow = { ...productRow, sale_price_ref: args.p_new_sale_price_ref };

    return { data: { ...productRow }, error: null };
  });

  (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ from: builder, rpc });

  return { categoryReads, inserts, log, rpc, updates };
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

describe("products.server · categoría del producto (PRO-F10 · M3/M4)", () => {
  it("createProduct rechaza la categoría de otra tienda y no inserta nada", async () => {
    const { categoryReads, inserts } = installSupabase();

    await expect(
      createProduct(
        { categoryId: FOREIGN_CATEGORY, name: "Harina", salePriceRef: 2 },
        DEFAULT_STORE_ID,
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: CATEGORY_MESSAGE, status: 400 });

    expect(inserts).toEqual([]);
    // Una sola lectura, filtrada por la tienda del servidor.
    expect(categoryReads).toEqual([{ id: FOREIGN_CATEGORY, store_id: DEFAULT_STORE_ID }]);
  });

  it("createProduct rechaza una categoría inexistente y una inactiva", async () => {
    const { inserts } = installSupabase();

    await expect(
      createProduct(
        { categoryId: "99999999-9999-4999-8999-999999999999", name: "Harina", salePriceRef: 2 },
        DEFAULT_STORE_ID,
      ),
    ).rejects.toMatchObject({ message: CATEGORY_MESSAGE, status: 400 });
    await expect(
      createProduct(
        { categoryId: INACTIVE_CATEGORY, name: "Harina", salePriceRef: 2 },
        DEFAULT_STORE_ID,
      ),
    ).rejects.toMatchObject({ message: "La categoría está inactiva: elige otra.", status: 400 });

    expect(inserts).toEqual([]);
  });

  it("createProduct rechaza una categoría vacía con su mensaje", async () => {
    const { inserts } = installSupabase();

    await expect(
      createProduct({ categoryId: "  ", name: "Harina", salePriceRef: 2 }, DEFAULT_STORE_ID),
    ).rejects.toMatchObject({ message: "El producto necesita una categoría.", status: 400 });

    expect(inserts).toEqual([]);
  });

  it("createProduct acepta una categoría activa de la tienda", async () => {
    const { inserts } = installSupabase();

    await createProduct(
      { categoryId: OWN_CATEGORY, name: "Harina", salePriceRef: 2 },
      DEFAULT_STORE_ID,
    );

    expect(inserts).toEqual([expect.objectContaining({ category_id: OWN_CATEGORY })]);
  });

  it("createProduct sin categoría sigue creando (filas de la importación sin categoría)", async () => {
    const { categoryReads, inserts } = installSupabase();

    await createProduct({ name: "Harina", salePriceRef: 2 }, DEFAULT_STORE_ID);

    expect(inserts).toEqual([expect.objectContaining({ category_id: null })]);
    expect(categoryReads).toEqual([]);
  });

  it("updateProduct rechaza cambiar a la categoría de otra tienda y no actualiza", async () => {
    const { categoryReads, updates } = installSupabase();

    await expect(
      updateProduct(PRODUCT_ID, { categoryId: FOREIGN_CATEGORY, name: "Otro" }, DEFAULT_STORE_ID),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: CATEGORY_MESSAGE, status: 400 });

    expect(updates).toEqual([]);
    expect(categoryReads).toEqual([{ id: FOREIGN_CATEGORY, store_id: DEFAULT_STORE_ID }]);
  });

  it("updateProduct rechaza cambiar a una categoría inactiva", async () => {
    const { updates } = installSupabase();

    await expect(
      updateProduct(PRODUCT_ID, { categoryId: INACTIVE_CATEGORY }, DEFAULT_STORE_ID),
    ).rejects.toMatchObject({ message: "La categoría está inactiva: elige otra.", status: 400 });

    expect(updates).toEqual([]);
  });

  it("updateProduct deja reenviar la categoría que el producto ya tiene aunque esté inactiva", async () => {
    const { updates } = installSupabase({ product: { category_id: INACTIVE_CATEGORY } });

    await updateProduct(
      PRODUCT_ID,
      { categoryId: INACTIVE_CATEGORY, name: "Otro" },
      DEFAULT_STORE_ID,
    );

    expect(updates).toEqual([{ category_id: INACTIVE_CATEGORY, name: "Otro" }]);
  });

  it("updateProduct cambia a otra categoría activa de la tienda", async () => {
    const { updates } = installSupabase();

    await updateProduct(PRODUCT_ID, { categoryId: OTHER_OWN_CATEGORY }, DEFAULT_STORE_ID);

    expect(updates).toEqual([{ category_id: OTHER_OWN_CATEGORY }]);
  });

  it("updateProduct no deja quitar la categoría", async () => {
    const { updates } = installSupabase();

    await expect(
      updateProduct(PRODUCT_ID, { categoryId: "" }, DEFAULT_STORE_ID),
    ).rejects.toMatchObject({ message: "El producto necesita una categoría.", status: 400 });

    expect(updates).toEqual([]);
  });

  it("updateProduct de un producto antiguo sin categoría no la exige", async () => {
    const { categoryReads, updates } = installSupabase({ product: { category_id: null } });

    await updateProduct(PRODUCT_ID, { name: "Otro" }, DEFAULT_STORE_ID);

    expect(updates).toEqual([{ name: "Otro" }]);
    expect(categoryReads).toEqual([]);
  });
});

describe("products.server updateProduct · precio (PRO-F10 · M5)", () => {
  it("un precio distinto no se escribe en el update: pasa por update_product_price, después del resto", async () => {
    const { log, rpc, updates } = installSupabase();

    const updated = await updateProduct(
      PRODUCT_ID,
      { currentCostRef: 9, name: "Otro", salePriceRef: 12.5 },
      DEFAULT_STORE_ID,
    );

    expect(updates).toEqual([{ current_cost_ref: 9, name: "Otro" }]);
    expect(rpc.mock.calls).toEqual([
      [
        "update_product_price",
        {
          p_new_sale_price_ref: 12.5,
          p_product_id: PRODUCT_ID,
          p_reason: "Edición del producto",
        },
      ],
    ]);
    // El costo nuevo ya está guardado cuando la RPC toma la instantánea.
    expect(log).toEqual(["update", "rpc:update_product_price"]);
    expect(updated.salePriceRef).toBe(12.5);
  });

  it("solo el precio: no hay update de la fila, solo la RPC", async () => {
    const { log } = installSupabase();

    await updateProduct(PRODUCT_ID, { salePriceRef: 98 }, DEFAULT_STORE_ID);

    expect(log).toEqual(["rpc:update_product_price"]);
  });

  it.each([10, 10.004])("el mismo precio (%s) se ignora: ni RPC ni columna", async (salePriceRef) => {
    const { rpc, updates } = installSupabase();

    await updateProduct(PRODUCT_ID, { name: "Otro", salePriceRef }, DEFAULT_STORE_ID);

    expect(updates).toEqual([{ name: "Otro" }]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("si la RPC del precio falla, el error dice que el resto se guardó y el precio no", async () => {
    const { log } = installSupabase({
      rpcError: { code: "PT403", message: "Solo admin o almacén pueden cambiar precios." },
    });

    await expect(
      updateProduct(PRODUCT_ID, { name: "Otro", salePriceRef: 12 }, DEFAULT_STORE_ID),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message:
        "Solo admin o almacén pueden cambiar precios. Los demás cambios del producto se guardaron; el precio no cambió.",
      status: 403,
    });

    expect(log).toEqual(["update", "rpc:update_product_price"]);
  });

  it("si solo venía el precio y la RPC falla, el error es el de la RPC sin más", async () => {
    installSupabase({ rpcError: { code: "PT403", message: "Sin permiso." } });

    await expect(
      updateProduct(PRODUCT_ID, { salePriceRef: 12 }, DEFAULT_STORE_ID),
    ).rejects.toMatchObject({ message: "Sin permiso.", status: 403 });
  });

  it("si el update del resto falla, el precio no se toca", async () => {
    const { rpc } = installSupabase({
      updateError: { code: "23505", message: "duplicate key value" },
    });

    await expect(
      updateProduct(PRODUCT_ID, { name: "Otro", salePriceRef: 12 }, DEFAULT_STORE_ID),
    ).rejects.toMatchObject({ status: 409 });

    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("products.server listProducts · búsqueda larga (PRO-F10 · M6)", () => {
  it("recorta el término a 100 caracteres antes de filtrar", async () => {
    const chain: Record<string, jest.Mock> = {
      eq: jest.fn(),
      or: jest.fn(),
      order: jest.fn(),
      range: jest.fn().mockResolvedValue({ count: 0, data: [], error: null }),
      select: jest.fn(),
    };
    chain.eq.mockReturnValue(chain);
    chain.or.mockReturnValue(chain);
    chain.order.mockReturnValue(chain);
    chain.select.mockReturnValue(chain);
    (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ from: jest.fn(() => chain) });

    await listProducts(new URLSearchParams({ search: "a".repeat(10_000) }), DEFAULT_STORE_ID);

    expect(chain.or).toHaveBeenCalledWith(
      ["name", "sku", "barcode"].map((column) => `${column}.ilike.%${"a".repeat(100)}%`).join(","),
    );
  });

  it("un término que solo trae caracteres de control no filtra", async () => {
    const chain: Record<string, jest.Mock> = {
      eq: jest.fn(),
      or: jest.fn(),
      order: jest.fn(),
      range: jest.fn().mockResolvedValue({ count: 0, data: [], error: null }),
      select: jest.fn(),
    };
    chain.eq.mockReturnValue(chain);
    chain.or.mockReturnValue(chain);
    chain.order.mockReturnValue(chain);
    chain.select.mockReturnValue(chain);
    (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ from: jest.fn(() => chain) });

    await listProducts(new URLSearchParams({ search: "\u0000\u0000" }), DEFAULT_STORE_ID);

    expect(chain.or).not.toHaveBeenCalled();
  });
});
