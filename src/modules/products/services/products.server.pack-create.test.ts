/**
 * @jest-environment node
 */
/**
 * PRO-F7 · QA PRO-12 hallazgos 1 y 2, con Supabase simulado.
 *
 * 1. `POST /api/products` con una receta de empaque inválida respondía 404/409
 *    pero dejaba el producto creado sin receta: el usuario reintentaba y
 *    duplicaba (o chocaba con su propio SKU).
 * 2. `PATCH /api/products/{id}` solo con `packConversion` respondía 404
 *    "Producto no encontrado." (update de `products` sin columnas).
 *
 * Orden del alta con receta: validar receta → producto → stock inicial → receta.
 */

jest.mock("../../../lib/supabase/route-client");
jest.mock("../../../lib/supabase/admin-client");

import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { packConversionInputSchema } from "./packConversionSchemas";
import { createProduct, updateProduct } from "./products.server";

type Call = {
  filters: unknown[][];
  op: "delete" | "insert" | "rpc" | "select" | "update";
  payload?: unknown;
  table: string;
};

type Reply = { data?: unknown; error?: unknown };

const NEW_PRODUCT = "prod-new";
const OTHER_STORE_ID = "00000000-0000-4000-8000-000000000002";

const productRow = {
  category_id: null,
  current_cost_ref: 12,
  current_stock: 0,
  id: NEW_PRODUCT,
  is_active: true,
  min_stock: 5,
  name: "Surtido A",
  sale_price_ref: 18,
  sku: "surtido-a",
};

function hasFilter(call: Call, ...filter: unknown[]) {
  return call.filters.some((item) => JSON.stringify(item) === JSON.stringify(filter));
}

/**
 * Supabase simulado: registra cada petición (también `rpc`) en orden y responde
 * con `respond`; sin respuesta propia, lo plausible para un alta que va bien.
 */
function mountSupabase(respond: (call: Call) => Reply | undefined = () => undefined) {
  const calls: Call[] = [];

  function defaultReply(call: Call): Reply {
    if (call.table === "products" && call.op === "insert") {
      return { data: { ...productRow } };
    }

    if (call.table === "products" && call.op === "delete") {
      return { data: [{ id: NEW_PRODUCT }] };
    }

    if (call.table === "products" && call.op === "select" && hasFilter(call, "eq", "id", NEW_PRODUCT)) {
      return { data: { ...productRow } };
    }

    return {};
  }

  const from = jest.fn((table: string) => {
    const call: Call = { filters: [], op: "select", table };
    const settle = () => {
      calls.push(call);

      return Promise.resolve({ data: null, error: null, ...defaultReply(call), ...respond(call) });
    };
    const builder: Record<string, unknown> = {
      delete: () => {
        call.op = "delete";
        return builder;
      },
      insert: (payload: unknown) => {
        call.op = "insert";
        call.payload = payload;
        return builder;
      },
      maybeSingle: settle,
      select: () => builder,
      single: settle,
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        settle().then(resolve, reject),
      update: (payload: unknown) => {
        call.op = "update";
        call.payload = payload;
        return builder;
      },
    };

    for (const name of ["eq", "in", "order", "limit"]) {
      builder[name] = (...args: unknown[]) => {
        call.filters.push([name, ...args]);
        return builder;
      };
    }

    return builder;
  });

  const rpc = jest.fn((name: string, args: unknown) => {
    const call: Call = { filters: [], op: "rpc", payload: args, table: name };

    calls.push(call);

    return Promise.resolve({ data: { id: NEW_PRODUCT }, error: null, ...respond(call) });
  });

  (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ from, rpc });

  return { calls };
}

/** `assertSupabaseStoreResource`: tienda de cada producto por id (`undefined` = no existe). */
function mountStoreLookup(storeByProductId: Record<string, string | undefined> = {}) {
  (createAdminSupabaseClient as jest.Mock).mockReturnValue({
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn((_column: string, id: string) => ({
          maybeSingle: jest.fn().mockResolvedValue({
            data: id in storeByProductId
              ? storeByProductId[id] === undefined
                ? null
                : { store_id: storeByProductId[id] }
              : { store_id: DEFAULT_STORE_ID },
            error: null,
          }),
        })),
      })),
    })),
  });
}

function assorted(unitProductIds: string[]) {
  return packConversionInputSchema.parse({
    components: unitProductIds.map((unitProductId) => ({ unitProductId, unitsPerPack: 2 })),
    enabled: true,
    mode: "assorted",
    totalUnits: unitProductIds.length * 2,
  });
}

function link(unitProductId: string) {
  return packConversionInputSchema.parse({
    enabled: true,
    mode: "link_existing",
    unitProductId,
    unitsPerPack: 6,
  });
}

function createUnit(sku?: string) {
  return packConversionInputSchema.parse({
    enabled: true,
    mode: "create_unit",
    unitProduct: { salePriceRef: 3, sku },
    unitsPerPack: 6,
  });
}

const baseInput = { currentCostRef: 12, name: "Surtido A", salePriceRef: 18, sku: "surtido-a" };

/** Los dos componentes existen en la tienda (lectura `in("id", …)` de `products`). */
function componentsExist(call: Call, ids: string[]): Reply | undefined {
  return call.table === "products" && call.op === "select" && hasFilter(call, "in", "id", ids)
    ? { data: ids.map((id) => ({ id })) }
    : undefined;
}

function productWrites(calls: Call[]) {
  return calls.filter((call) => call.table === "products" && call.op !== "select").map((call) => call.op);
}

/** Escrituras de la receta: la RPC `save_pack_recipe` (INV-09) y, si las hubiera, por tabla. */
function recipeWrites(calls: Call[]) {
  return calls.filter(
    (call) =>
      call.op !== "select" &&
      (call.table === "save_pack_recipe" ||
        call.table === "product_pack_conversions" ||
        call.table === "product_pack_components"),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mountStoreLookup();
});

describe("createProduct · receta inválida: no se crea el producto (PRO-F7)", () => {
  it("surtido con un componente que no existe: 404 y ningún insert en `products`", async () => {
    const { calls } = mountSupabase((call) =>
      call.table === "products" && call.op === "select" && hasFilter(call, "in", "id", ["cola", "fantasma"])
        ? { data: [{ id: "cola" }] }
        : undefined,
    );

    await expect(
      createProduct({ ...baseInput, packConversion: assorted(["cola", "fantasma"]) }, DEFAULT_STORE_ID),
    ).rejects.toMatchObject({ message: "Producto componente no encontrado.", status: 404 });

    expect(productWrites(calls)).toEqual([]);
    expect(recipeWrites(calls)).toEqual([]);
  });

  it("surtido con un componente que es empaque con receta activa: 409 y ningún insert", async () => {
    const { calls } = mountSupabase(
      (call) =>
        componentsExist(call, ["cola", "caja"]) ??
        (call.table === "product_pack_conversions" && call.op === "select"
          ? { data: [{ pack_product_id: "caja" }] }
          : undefined),
    );

    await expect(
      createProduct({ ...baseInput, packConversion: assorted(["cola", "caja"]) }, DEFAULT_STORE_ID),
    ).rejects.toMatchObject({
      message: "Un componente es un empaque con receta activa: no puede salir de otro empaque.",
      status: 409,
    });

    expect(productWrites(calls)).toEqual([]);
  });

  it("1 a 1 con una unidad que no existe: 404 y ningún insert", async () => {
    mountStoreLookup({ fantasma: undefined });
    const { calls } = mountSupabase();

    await expect(
      createProduct({ ...baseInput, packConversion: link("fantasma") }, DEFAULT_STORE_ID),
    ).rejects.toMatchObject({ message: "Producto unidad no encontrado.", status: 404 });

    expect(productWrites(calls)).toEqual([]);
  });

  it("1 a 1 con una unidad de otra tienda: 403 y ningún insert", async () => {
    mountStoreLookup({ ajena: OTHER_STORE_ID });
    const { calls } = mountSupabase();

    await expect(
      createProduct({ ...baseInput, packConversion: link("ajena") }, DEFAULT_STORE_ID),
    ).rejects.toMatchObject({ status: 403 });

    expect(productWrites(calls)).toEqual([]);
  });

  it("1 a 1 con una unidad que es empaque con receta activa: 409 y ningún insert", async () => {
    const { calls } = mountSupabase((call) =>
      call.table === "product_pack_conversions" &&
      call.op === "select" &&
      hasFilter(call, "eq", "pack_product_id", "caja")
        ? { data: { id: "recipe-caja" } }
        : undefined,
    );

    await expect(
      createProduct({ ...baseInput, packConversion: link("caja") }, DEFAULT_STORE_ID),
    ).rejects.toMatchObject({
      message: "El producto unidad es un empaque con receta activa: no puede salir de otro empaque.",
      status: 409,
    });

    expect(productWrites(calls)).toEqual([]);
  });

  it("«crear unidad» con un SKU de unidad ya usado en la tienda: 409 y ningún insert", async () => {
    const { calls } = mountSupabase((call) =>
      call.table === "products" && call.op === "select" && hasFilter(call, "eq", "sku", "cola-suelta")
        ? { data: { id: "prod-otro" } }
        : undefined,
    );

    await expect(
      createProduct({ ...baseInput, packConversion: createUnit("cola-suelta") }, DEFAULT_STORE_ID),
    ).rejects.toMatchObject({ message: "Ya existe un producto con este SKU de unidad.", status: 409 });

    expect(productWrites(calls)).toEqual([]);
  });

  it("«crear unidad» con el mismo SKU que el empaque: 409 y ningún insert", async () => {
    const { calls } = mountSupabase();

    await expect(
      createProduct({ ...baseInput, packConversion: createUnit("surtido-a") }, DEFAULT_STORE_ID),
    ).rejects.toMatchObject({ message: "Ya existe un producto con este SKU de unidad.", status: 409 });

    expect(productWrites(calls)).toEqual([]);
  });
});

describe("createProduct · orden del alta con receta (PRO-F7)", () => {
  it("valida la receta, crea el producto, registra el stock inicial y por último guarda la receta", async () => {
    const { calls } = mountSupabase((call) => componentsExist(call, ["cola", "uva"]));

    const created = await createProduct(
      { ...baseInput, currentStock: 4, packConversion: assorted(["cola", "uva"]) },
      DEFAULT_STORE_ID,
    );

    expect(created.id).toBe(NEW_PRODUCT);

    const firstValidation = calls.findIndex(
      (call) => call.table === "products" && hasFilter(call, "in", "id", ["cola", "uva"]),
    );
    const productInsert = calls.findIndex((call) => call.table === "products" && call.op === "insert");
    const initialStock = calls.findIndex((call) => call.op === "rpc" && call.table === "adjust_stock");
    const recipeInsert = calls.findIndex(
      (call) => call.op === "rpc" && call.table === "save_pack_recipe",
    );

    expect(firstValidation).toBeGreaterThanOrEqual(0);
    expect(firstValidation).toBeLessThan(productInsert);
    expect(productInsert).toBeLessThan(initialStock);
    expect(initialStock).toBeLessThan(recipeInsert);
    expect(calls[initialStock]?.payload).toMatchObject({
      p_product_id: NEW_PRODUCT,
      p_quantity_delta: 4,
      p_type: "inventario_inicial",
    });
    expect(productWrites(calls)).toEqual(["insert"]);
  });
});

describe("createProduct · la receta falla después de crear el producto (PRO-F7)", () => {
  const recipeFailure = { code: "40001", message: "could not serialize access" };

  function failingRecipe(call: Call): Reply | undefined {
    return (
      componentsExist(call, ["cola", "uva"]) ??
      (call.op === "rpc" && call.table === "save_pack_recipe"
        ? { data: null, error: recipeFailure }
        : undefined)
    );
  }

  it("sin stock inicial: borra el producto recién creado y devuelve el error de la receta", async () => {
    const { calls } = mountSupabase(failingRecipe);

    await expect(
      createProduct({ ...baseInput, packConversion: assorted(["cola", "uva"]) }, DEFAULT_STORE_ID),
    ).rejects.toMatchObject({
      message: "La operacion choco con otra en curso y no se aplico. Intenta de nuevo.",
      status: 409,
    });

    const deletion = calls.find((call) => call.table === "products" && call.op === "delete");

    expect(productWrites(calls)).toEqual(["insert", "delete"]);
    expect(deletion && hasFilter(deletion, "eq", "id", NEW_PRODUCT)).toBe(true);
    expect(deletion && hasFilter(deletion, "eq", "store_id", DEFAULT_STORE_ID)).toBe(true);
  });

  it("con stock inicial (ya hay un movimiento `inventario_inicial`): no borra y el error dice qué pasó", async () => {
    const { calls } = mountSupabase(failingRecipe);

    await expect(
      createProduct(
        { ...baseInput, currentStock: 4, packConversion: assorted(["cola", "uva"]) },
        DEFAULT_STORE_ID,
      ),
    ).rejects.toMatchObject({
      message:
        "El producto se creó pero el empaque no se pudo guardar: La operacion choco con otra en curso y no se aplico. Intenta de nuevo. Edítalo para completar el empaque.",
      status: 409,
    });

    expect(productWrites(calls)).toEqual(["insert"]);
  });

  it.each([
    ["el borrado devuelve error", { data: null, error: { message: "permission denied" } }],
    ["el borrado no afecta ninguna fila", { data: [], error: null }],
  ])("sin stock inicial, si %s, el error dice que el producto quedó creado", async (_, deleteReply) => {
    mountSupabase(
      (call) =>
        failingRecipe(call) ??
        (call.table === "products" && call.op === "delete" ? deleteReply : undefined),
    );

    await expect(
      createProduct({ ...baseInput, packConversion: assorted(["cola", "uva"]) }, DEFAULT_STORE_ID),
    ).rejects.toMatchObject({
      message: expect.stringMatching(
        /^El producto se creó pero el empaque no se pudo guardar: .+ Edítalo para completar el empaque\.$/,
      ),
      status: 409,
    });
  });

  it("«crear unidad»: si la receta no se guarda, también borra la unidad recién creada", async () => {
    const { calls } = mountSupabase((call) => {
      if (call.table === "products" && call.op === "insert") {
        const payload = call.payload as { sku: string };

        return { data: { ...productRow, id: payload.sku === "surtido-a" ? NEW_PRODUCT : "unit-new" } };
      }

      if (call.table === "products" && call.op === "delete") {
        return { data: [{ id: "x" }] };
      }

      return call.op === "rpc" && call.table === "save_pack_recipe"
        ? { data: null, error: recipeFailure }
        : undefined;
    });

    await expect(
      createProduct({ ...baseInput, packConversion: createUnit("cola-suelta") }, DEFAULT_STORE_ID),
    ).rejects.toMatchObject({ status: 409 });

    const deletedIds = calls
      .filter((call) => call.table === "products" && call.op === "delete")
      .map((call) => call.filters.find((filter) => filter[1] === "id")?.[2]);

    expect(deletedIds).toEqual(["unit-new", NEW_PRODUCT]);
  });
});

describe("updateProduct · solo `packConversion` (PRO-F7)", () => {
  it("aplica la receta sin hacer update de `products` y devuelve el producto", async () => {
    const { calls } = mountSupabase((call) => componentsExist(call, ["cola", "uva"]));

    const updated = await updateProduct(
      NEW_PRODUCT,
      { packConversion: assorted(["cola", "uva"]) },
      DEFAULT_STORE_ID,
    );

    expect(updated.id).toBe(NEW_PRODUCT);
    expect(productWrites(calls)).toEqual([]);
    expect(recipeWrites(calls).map((call) => [call.table, call.op])).toEqual([["save_pack_recipe", "rpc"]]);
  });

  it("con campos de producto sigue haciendo su update", async () => {
    const { calls } = mountSupabase((call) =>
      call.table === "products" && call.op === "update" ? { data: { ...productRow, name: "Otro" } } : undefined,
    );

    await updateProduct(NEW_PRODUCT, { name: "Otro" }, DEFAULT_STORE_ID);

    expect(productWrites(calls)).toEqual(["update"]);
  });
});
