/**
 * @jest-environment node
 */
/** PRO-05 · el SKU del alta lo genera el servidor cuando llega vacío. */

jest.mock("../../../lib/supabase/route-client");
jest.mock("../../../lib/supabase/admin-client");

import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { GENERATED_SKU_MAX_ATTEMPTS } from "./productSku";
import { createProduct, updateProduct } from "./products.server";

type Row = Record<string, unknown>;
type SupabaseError = { code: string; details?: string; message: string };

const PRODUCT_ID = "55555555-5555-4555-8555-555555555555";

const SKU_TAKEN: SupabaseError = {
  code: "23505",
  details: "Key (store_id, sku)=(…) already exists.",
  message: 'duplicate key value violates unique constraint "products_store_sku_unique"',
};
const BARCODE_TAKEN: SupabaseError = {
  code: "23505",
  details: "Key (store_id, barcode)=(…) already exists.",
  message: 'duplicate key value violates unique constraint "products_store_barcode_unique"',
};

/**
 * Cliente Supabase mínimo: registra cada `insert`/`update` de `products` y
 * responde a los `insert` con los errores de `insertErrors`, en orden.
 */
function installSupabase(insertErrors: Array<SupabaseError | null> = []) {
  const inserts: Row[] = [];
  const updates: Row[] = [];
  let productRow: Row = { id: PRODUCT_ID, is_active: true, name: "Guardado", sku: "guardado" };

  function builder(table: string) {
    let insertError: SupabaseError | null = null;
    const result = async () => ({
      data: table === "products" && !insertError ? { ...productRow } : null,
      error: insertError,
    });
    const chain = {
      eq: () => chain,
      insert: (row: Row) => {
        inserts.push(row);
        insertError = insertErrors.shift() ?? null;
        if (!insertError) {
          productRow = { is_active: true, ...row, id: PRODUCT_ID };
        }
        return chain;
      },
      maybeSingle: result,
      or: () => chain,
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

  (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ from: builder });

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

describe("products.server createProduct: sku generado (PRO-05)", () => {
  it.each([{ sku: undefined }, { sku: "" }, { sku: "   " }])(
    "sin SKU ($sku) lo deriva del nombre, sin tildes ni ñ",
    async ({ sku }) => {
      const { inserts } = installSupabase();

      const created = await createProduct(
        { name: "Piñón Añejo Café", salePriceRef: 2, sku },
        DEFAULT_STORE_ID,
      );

      expect(inserts).toHaveLength(1);
      expect(inserts[0]).toMatchObject({ sku: "pino-anej-cafe", store_id: DEFAULT_STORE_ID });
      expect(created.sku).toBe("pino-anej-cafe");
    },
  );

  it("respeta el SKU escrito, normalizado, y no lo sustituye", async () => {
    const { inserts } = installSupabase();

    await createProduct({ name: "Harina PAN", salePriceRef: 2, sku: "  MI-SKU " }, DEFAULT_STORE_ID);

    expect(inserts.map((row) => row.sku)).toEqual(["mi-sku"]);
  });

  it("si el SKU generado choca en la tienda reintenta con sufijo hasta que entra", async () => {
    const { inserts } = installSupabase([SKU_TAKEN, SKU_TAKEN, null]);

    const created = await createProduct({ name: "Harina PAN", salePriceRef: 2 }, DEFAULT_STORE_ID);

    expect(inserts).toHaveLength(3);
    expect(inserts[0].sku).toBe("hari-pan");
    expect(inserts[1].sku).toMatch(/^hari-pan-[0-9a-f]{4}$/);
    expect(inserts[2].sku).toMatch(/^hari-pan-[0-9a-f]{4}$/);
    expect(created.sku).toBe(inserts[2].sku);
  });

  it("el reintento es acotado: agotado responde 409 y no 500", async () => {
    const { inserts } = installSupabase(
      Array.from({ length: GENERATED_SKU_MAX_ATTEMPTS + 3 }, () => SKU_TAKEN),
    );

    await expect(
      createProduct({ name: "Harina PAN", salePriceRef: 2 }, DEFAULT_STORE_ID),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "No se pudo generar un SKU único para este producto. Escribe uno e intenta de nuevo.",
      status: 409,
    });
    expect(inserts).toHaveLength(GENERATED_SKU_MAX_ATTEMPTS);
  });

  it("un SKU escrito que ya existe no se reintenta ni se cambia: 409", async () => {
    const { inserts } = installSupabase([SKU_TAKEN, null]);

    await expect(
      createProduct({ name: "Harina PAN", salePriceRef: 2, sku: "hari-pan" }, DEFAULT_STORE_ID),
    ).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    expect(inserts).toHaveLength(1);
  });

  it("un código de barras duplicado no se confunde con el SKU: 409 sin reintento", async () => {
    const { inserts } = installSupabase([BARCODE_TAKEN, null]);

    await expect(
      createProduct({ barcode: "7591", name: "Harina PAN", salePriceRef: 2 }, DEFAULT_STORE_ID),
    ).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    expect(inserts).toHaveLength(1);
  });

  it.each(["🍕🍕", "***", "---"])(
    "un nombre sin letras ni dígitos (%s) recibe un SKU de respaldo válido",
    async (name) => {
      const { inserts } = installSupabase([SKU_TAKEN, null]);

      await createProduct({ name, salePriceRef: 2 }, DEFAULT_STORE_ID);

      expect(inserts[0].sku).toBe("producto");
      expect(inserts[1].sku).toMatch(/^producto-[0-9a-f]{4}$/);
    },
  );
});

describe("products.server updateProduct: sku vacío (PRO-05)", () => {
  it.each([{ sku: undefined }, { sku: "" }, { sku: "  " }])(
    "con SKU vacío ($sku) no lo escribe: se conserva el actual",
    async ({ sku }) => {
      const { inserts, updates } = installSupabase();

      const updated = await updateProduct(PRODUCT_ID, { name: "Otro nombre", sku }, DEFAULT_STORE_ID);

      expect(updates).toEqual([{ name: "Otro nombre" }]);
      expect(inserts).toEqual([]);
      expect(updated.sku).toBe("guardado");
    },
  );

  it("con SKU escrito lo actualiza normalizado", async () => {
    const { updates } = installSupabase();

    await updateProduct(PRODUCT_ID, { sku: " NUEVO-01 " }, DEFAULT_STORE_ID);

    expect(updates).toEqual([{ sku: "nuevo-01" }]);
  });
});
