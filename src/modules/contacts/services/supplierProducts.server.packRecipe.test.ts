/**
 * @jest-environment node
 */

jest.mock("../../../lib/supabase/route-client");
jest.mock("../../../lib/supabase/admin-client");

import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { createSupplierProductPackUnit, updateSupplierProductPackUnit } from "./supplierProducts.server";

type Result = { data: unknown; error: unknown };

const productId = "22222222-2222-4222-8222-222222222222";
const supplierProductId = "44444444-4444-4444-8444-444444444444";
const packUnitId = "55555555-5555-4555-8555-555555555555";

/** Cadena thenable: cualquier filtro devuelve la misma cadena y al final resuelve `result`. */
function chain(result: Result, listResult: Result = result) {
  const target: Record<string, unknown> = {
    then: (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(listResult).then(resolve, reject),
  };
  for (const method of ["select", "eq", "neq", "in", "order", "range", "insert", "update"]) {
    target[method] = jest.fn(() => target);
  }
  target.single = jest.fn(() => Promise.resolve(result));
  target.maybeSingle = jest.fn(() => Promise.resolve(result));
  return target;
}

function setup(recipes: { components?: unknown[]; packs?: unknown[] }) {
  const writes = chain({
    data: { id: packUnitId, label: "Caja", supplier_product_id: supplierProductId, units_per_pack: 10 },
    error: null,
  }, { data: [], error: null });
  const tables: Record<string, () => Record<string, unknown>> = {
    product_pack_components: () => chain({ data: recipes.components ?? [], error: null }),
    product_pack_conversions: () => chain({ data: recipes.packs ?? [], error: null }),
    supplier_product_pack_units: () => writes,
    supplier_product_price_history: () => chain({ data: [], error: null }),
    supplier_products: () =>
      chain({ data: { id: supplierProductId, last_cost_ref: 0, product_id: productId }, error: null }),
  };
  const from = jest.fn((table: string) => tables[table]());
  (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ from, rpc: jest.fn() });
  return { from, writes };
}

const componentOf = (size: number, total = size) => ({
  conversion: { is_active: true, total_units: total },
  units_per_pack: size,
});

describe("supplierProducts.server pack units vs product recipe (D9)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (createAdminSupabaseClient as jest.Mock).mockReturnValue({
      from: jest.fn(() => chain({ data: { store_id: DEFAULT_STORE_ID }, error: null })),
    });
  });

  it("rejects a create whose size matches no component recipe", async () => {
    const { from, writes } = setup({ components: [componentOf(12), componentOf(6), componentOf(4, 12)] });

    await expect(
      createSupplierProductPackUnit(supplierProductId, { label: "Caja", unitsPerPack: 10 }, DEFAULT_STORE_ID),
    ).rejects.toMatchObject({
      message: "Este producto se arma en empaques de 6 o 12 unidades; 10 no coincide con ninguna receta.",
      status: 400,
    });
    expect(writes.insert).not.toHaveBeenCalled();
    expect(from).toHaveBeenCalledWith("product_pack_components");
  });

  it("rejects a create on a pack product with another size than its recipe", async () => {
    setup({ packs: [{ total_units: "36" }] });

    await expect(
      createSupplierProductPackUnit(supplierProductId, { label: "Caja", unitsPerPack: 24 }, DEFAULT_STORE_ID),
    ).rejects.toMatchObject({
      message: "Este producto es un empaque de 36 unidades según su receta; 24 no coincide con la receta.",
      status: 400,
    });
  });

  it("creates when the size matches a recipe or the product has none", async () => {
    const withRecipe = setup({ components: [componentOf(10)] });
    await createSupplierProductPackUnit(supplierProductId, { label: "Caja", unitsPerPack: 10 }, DEFAULT_STORE_ID);
    expect(withRecipe.writes.insert).toHaveBeenCalledWith(expect.objectContaining({ units_per_pack: 10 }));

    const withoutRecipe = setup({});
    await createSupplierProductPackUnit(supplierProductId, { label: "Caja", unitsPerPack: 7 }, DEFAULT_STORE_ID);
    expect(withoutRecipe.writes.insert).toHaveBeenCalledWith(expect.objectContaining({ units_per_pack: 7 }));
  });

  it("rejects a size change or reactivation that matches no recipe, but not a rename", async () => {
    const { writes } = setup({ components: [componentOf(6)] });

    await expect(
      updateSupplierProductPackUnit(supplierProductId, packUnitId, { unitsPerPack: 8 }, DEFAULT_STORE_ID),
    ).rejects.toMatchObject({ status: 400 });
    // El empaque guardado es de 10: reactivarlo también choca con la receta de 6.
    await expect(
      updateSupplierProductPackUnit(supplierProductId, packUnitId, { isActive: true }, DEFAULT_STORE_ID),
    ).rejects.toMatchObject({
      message: "Este producto se arma en empaques de 6 unidades; 10 no coincide con la receta.",
    });
    expect(writes.update).not.toHaveBeenCalled();

    await updateSupplierProductPackUnit(supplierProductId, packUnitId, { label: "Caja vieja" }, DEFAULT_STORE_ID);
    expect(writes.update).toHaveBeenCalledWith({ label: "Caja vieja" });
  });
});
