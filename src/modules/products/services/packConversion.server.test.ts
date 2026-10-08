/**
 * @jest-environment node
 */
/**
 * PRO-12 · receta de empaque con N componentes (parche 20261009d), lado BFF con
 * Supabase simulado: lecturas (un vínculo, surtido, unidad en varias recetas) y
 * escritura de la receta con la RPC `save_pack_recipe` (INV-09, parche
 * 20261011c): una transacción en la base, sin compensación en el BFF.
 */

jest.mock("../../../lib/supabase/route-client");
jest.mock("../../../lib/supabase/admin-client");

import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import {
  getPackConversionForProduct,
  listPackConversions,
  upsertPackConversionForPackProduct,
} from "./packConversion.server";
import { packConversionInputSchema } from "./packConversionSchemas";

type Call = {
  filters: unknown[][];
  op: "delete" | "insert" | "rpc" | "select" | "update";
  payload?: unknown;
  select?: string;
  table: string;
};

type Reply = { data?: unknown; error?: unknown };

/** Cliente de Supabase simulado: registra cada petición y responde con `respond`. */
function mountSupabase(respond: (call: Call) => Reply | undefined) {
  const calls: Call[] = [];

  const from = jest.fn((table: string) => {
    const call: Call = { filters: [], op: "select", table };
    const settle = () => {
      calls.push(call);

      return Promise.resolve({ data: null, error: null, ...respond(call) });
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
      select: (columns: string) => {
        call.select = columns;
        return builder;
      },
      single: settle,
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        settle().then(resolve, reject),
      update: (payload: unknown) => {
        call.op = "update";
        call.payload = payload;
        return builder;
      },
    };

    for (const name of ["eq", "in", "order"]) {
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

    return Promise.resolve({ data: null, error: null, ...respond(call) });
  });

  (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ from, rpc });

  return { calls };
}

const PACK = "pack-1";
const OLD_RECIPE = "recipe-old";

function product(id: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    current_cost_ref: 1.5,
    current_stock: 4,
    id,
    is_active: true,
    name,
    sale_price_ref: 2,
    sku: `sku-${id}`,
    ...extra,
  };
}

function recipe(
  id: string,
  pack: ReturnType<typeof product>,
  components: [ReturnType<typeof product>, number, number?][],
  label: string | null = null,
) {
  return {
    components: components.map(([unit, units, weight]) => ({
      cost_weight: weight ?? 1,
      unit_product: unit,
      unit_product_id: unit.id,
      units_per_pack: units,
    })),
    id,
    label,
    pack_product: pack,
    pack_product_id: pack.id,
    total_units: components.reduce((total, [, units]) => total + units, 0),
  };
}

const cola = product("unit-cola", "Refresco cola");
const naranja = product("unit-naranja", "Refresco naranja", { is_active: false });
const uva = product("unit-uva", "Refresco uva");
const caja = product(PACK, "Caja surtida");

function hasFilter(call: Call, ...filter: unknown[]) {
  return call.filters.some((item) => JSON.stringify(item) === JSON.stringify(filter));
}

function writes(calls: Call[]) {
  return calls.filter((call) => call.op !== "select").map((call) => [call.table, call.op, call.payload]);
}

beforeEach(() => {
  jest.clearAllMocks();
  (createAdminSupabaseClient as jest.Mock).mockReturnValue({
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          maybeSingle: jest.fn().mockResolvedValue({
            data: { store_id: DEFAULT_STORE_ID },
            error: null,
          }),
        })),
      })),
    })),
  });
});

describe("packConversion.server · lecturas", () => {
  it("un vínculo de siempre conserva sus campos y gana los de receta", async () => {
    mountSupabase((call) =>
      call.table === "product_pack_conversions"
        ? { data: recipe("recipe-1", caja, [[cola, 10]]) }
        : { data: [] },
    );

    expect(await getPackConversionForProduct(PACK, DEFAULT_STORE_ID)).toEqual({
      components: [
        {
          costWeight: 1,
          currentStock: 4,
          isActive: true,
          name: "Refresco cola",
          sku: "sku-unit-cola",
          unitProductId: "unit-cola",
          unitsPerPack: 10,
        },
      ],
      id: "recipe-1",
      kind: "single",
      label: null,
      linkedProduct: {
        currentCostRef: 1.5,
        currentStock: 4,
        id: "unit-cola",
        name: "Refresco cola",
        salePriceRef: 2,
        sku: "sku-unit-cola",
      },
      role: "pack",
      sources: [],
      totalUnits: 10,
      unitsPerPack: 10,
    });
  });

  it("un surtido expone sus componentes por nombre y el primero como linkedProduct", async () => {
    mountSupabase((call) =>
      call.table === "product_pack_conversions"
        ? { data: recipe("recipe-1", caja, [[uva, 2], [cola, 3, 2], [naranja, 1]], "Surtido 6") }
        : { data: [] },
    );

    const summary = await getPackConversionForProduct(PACK, DEFAULT_STORE_ID);

    expect(summary).toMatchObject({
      kind: "assorted",
      label: "Surtido 6",
      linkedProduct: { id: "unit-cola" },
      role: "pack",
      totalUnits: 6,
      unitsPerPack: 6,
    });
    expect(summary?.components).toEqual([
      expect.objectContaining({ costWeight: 2, isActive: true, unitProductId: "unit-cola", unitsPerPack: 3 }),
      expect.objectContaining({ costWeight: 1, isActive: false, unitProductId: "unit-naranja", unitsPerPack: 1 }),
      expect.objectContaining({ costWeight: 1, isActive: true, unitProductId: "unit-uva", unitsPerPack: 2 }),
    ]);
  });

  it("una unidad que sale de dos recetas las trae todas en sources, sin maybeSingle sobre varias filas", async () => {
    const cajaB = product("pack-b", "Caja B de cola");
    const cajaA = product("pack-a", "Caja A surtida");
    const { calls } = mountSupabase((call) =>
      call.table === "product_pack_components"
        ? {
            data: [
              { conversion: recipe("recipe-b", cajaB, [[cola, 12]]) },
              { conversion: recipe("recipe-a", cajaA, [[cola, 2], [uva, 4]]) },
            ],
          }
        : { data: null },
    );

    const summary = await getPackConversionForProduct("unit-cola", DEFAULT_STORE_ID);

    expect(summary).toMatchObject({
      id: "recipe-a",
      kind: "assorted",
      linkedProduct: { id: "pack-a", name: "Caja A surtida" },
      role: "unit",
      totalUnits: 6,
      unitsPerPack: 2,
    });
    expect(summary?.sources).toEqual([
      { conversionId: "recipe-a", packName: "Caja A surtida", packProductId: "pack-a", totalUnits: 6, unitsPerPack: 2 },
      { conversionId: "recipe-b", packName: "Caja B de cola", packProductId: "pack-b", totalUnits: 12, unitsPerPack: 12 },
    ]);

    // Dos lecturas, sea cual sea el número de recetas.
    expect(calls).toHaveLength(2);
    const sourcesCall = calls.find((call) => call.table === "product_pack_components");
    expect(sourcesCall?.select).toContain("conversion:product_pack_conversions!inner(");
    expect(hasFilter(sourcesCall!, "eq", "unit_product_id", "unit-cola")).toBe(true);
    expect(hasFilter(sourcesCall!, "eq", "conversion.is_active", true)).toBe(true);
    expect(hasFilter(sourcesCall!, "eq", "store_id", DEFAULT_STORE_ID)).toBe(true);
    const packCall = calls.find((call) => call.table === "product_pack_conversions");
    expect(hasFilter(packCall!, "eq", "pack_product_id", "unit-cola")).toBe(true);
  });

  it("un empaque que además sale de otra receta se informa como pack, con sources", async () => {
    const master = product("pack-master", "Bulto");
    mountSupabase((call) =>
      call.table === "product_pack_conversions"
        ? { data: recipe("recipe-1", caja, [[cola, 10]]) }
        : { data: [{ conversion: recipe("recipe-master", master, [[caja, 4]]) }] },
    );

    const summary = await getPackConversionForProduct(PACK, DEFAULT_STORE_ID);

    expect(summary).toMatchObject({ id: "recipe-1", linkedProduct: { id: "unit-cola" }, role: "pack" });
    expect(summary?.sources).toEqual([
      { conversionId: "recipe-master", packName: "Bulto", packProductId: "pack-master", totalUnits: 4, unitsPerPack: 4 },
    ]);
  });

  it("sin recetas no hay vínculo", async () => {
    mountSupabase((call) => (call.table === "product_pack_components" ? { data: [] } : { data: null }));

    expect(await getPackConversionForProduct("unit-cola", DEFAULT_STORE_ID)).toBeUndefined();
  });

  it("listPackConversions trae pares y surtidos en una sola lectura", async () => {
    const cajaCola = product("pack-cola", "Caja cola");
    const { calls } = mountSupabase(() => ({
      data: [
        recipe("recipe-s", caja, [[uva, 2], [cola, 2], [naranja, 2]]),
        recipe("recipe-c", cajaCola, [[cola, 12]]),
      ],
    }));

    const items = await listPackConversions(DEFAULT_STORE_ID);

    expect(calls).toHaveLength(1);
    expect(items).toEqual([
      expect.objectContaining({
        id: "recipe-s",
        kind: "assorted",
        linkedProduct: expect.objectContaining({ id: "unit-cola" }),
        packProduct: expect.objectContaining({ id: PACK, name: "Caja surtida" }),
        role: "pack",
        unitsPerPack: 6,
      }),
      expect.objectContaining({
        id: "recipe-c",
        kind: "single",
        linkedProduct: expect.objectContaining({ id: "unit-cola" }),
        packProduct: expect.objectContaining({ id: "pack-cola" }),
        unitsPerPack: 12,
      }),
    ]);
    expect(items[0].components).toHaveLength(3);
  });
});

describe("packConversion.server · guardar la receta (INV-09: RPC `save_pack_recipe`)", () => {
  const assortedInput = packConversionInputSchema.parse({
    components: [
      { unitProductId: "unit-cola", unitsPerPack: 2 },
      { costWeight: 1.5, unitProductId: "unit-naranja", unitsPerPack: 2 },
      { unitProductId: "unit-uva", unitsPerPack: 2 },
    ],
    enabled: true,
    label: "  Surtido 6  ",
    mode: "assorted",
    totalUnits: 6,
  });

  const assortedArgs = {
    p_components: [
      { cost_weight: 1, unit_product_id: "unit-cola", units_per_pack: 2 },
      { cost_weight: 1.5, unit_product_id: "unit-naranja", units_per_pack: 2 },
      { cost_weight: 1, unit_product_id: "unit-uva", units_per_pack: 2 },
    ],
    p_enabled: true,
    p_label: "Surtido 6",
    p_pack_product_id: PACK,
    p_total_units: 6,
  };

  const linkInput = packConversionInputSchema.parse({
    enabled: true,
    mode: "link_existing",
    unitProductId: "unit-cola",
    unitsPerPack: 12,
  });

  const createUnitInput = packConversionInputSchema.parse({
    enabled: true,
    mode: "create_unit",
    unitProduct: { name: "Unidad suelta", salePriceRef: 1 },
    unitsPerPack: 6,
  });

  function singleArgs(unitProductId: string, units: number) {
    return {
      p_components: [{ cost_weight: 1, unit_product_id: unitProductId, units_per_pack: units }],
      p_enabled: true,
      p_label: null,
      p_pack_product_id: PACK,
      p_total_units: units,
    };
  }

  /**
   * Base simulada: la RPC responde `rpcError` (o va bien), el alta de la unidad
   * devuelve `unit-new`, `hasActiveRecipe` dice si el empaque ya tiene receta y
   * `packIsComponentOf` nombra los empaques de cuyas recetas activas sale.
   */
  function mountStore(options: {
    hasActiveRecipe?: boolean;
    packIsComponentOf?: (string | null)[];
    rpcError?: { code: string; message: string };
  } = {}) {
    return mountSupabase((call) => {
      if (call.op === "rpc") {
        return options.rpcError ? { error: options.rpcError } : { data: { action: "created" } };
      }

      if (call.table === "products" && call.op === "insert") {
        return { data: { id: "unit-new" } };
      }

      if (call.table === "product_pack_components" && call.op === "select") {
        return {
          data: (options.packIsComponentOf ?? []).map((name) => ({
            conversion: { pack_product: name === null ? null : { name } },
          })),
        };
      }

      if (call.table === "product_pack_conversions" && call.op === "select") {
        return { data: options.hasActiveRecipe ? { id: OLD_RECIPE } : null };
      }

      return {};
    });
  }

  function rpcCalls(calls: Call[]) {
    return calls.filter((call) => call.op === "rpc").map((call) => [call.table, call.payload]);
  }

  /** Escrituras por tabla sobre la receta: tras INV-09 no debe haber ninguna. */
  function recipeTableWrites(calls: Call[]) {
    return calls.filter(
      (call) =>
        (call.op === "insert" || call.op === "update" || call.op === "delete") &&
        (call.table === "product_pack_conversions" || call.table === "product_pack_components"),
    );
  }

  it("surtido: una sola llamada a la RPC con la receta completa, sin lecturas ni escrituras por tabla", async () => {
    const { calls } = mountStore();

    await upsertPackConversionForPackProduct(PACK, DEFAULT_STORE_ID, assortedInput);

    expect(calls.map((call) => [call.op, call.table, call.payload])).toEqual([
      ["rpc", "save_pack_recipe", assortedArgs],
    ]);
  });

  it("surtido sin nombre (o solo espacios): `p_label` null", async () => {
    const { calls } = mountStore();

    await upsertPackConversionForPackProduct(
      PACK,
      DEFAULT_STORE_ID,
      packConversionInputSchema.parse({ ...assortedInput, label: "   " }),
    );

    expect(rpcCalls(calls)).toEqual([["save_pack_recipe", { ...assortedArgs, p_label: null }]]);
  });

  it("1 a 1 con unidad existente: la misma RPC con un componente de peso 1 y sin nombre", async () => {
    const { calls } = mountStore();

    await upsertPackConversionForPackProduct(PACK, DEFAULT_STORE_ID, linkInput);

    expect(calls.map((call) => [call.op, call.table, call.payload])).toEqual([
      ["rpc", "save_pack_recipe", singleArgs("unit-cola", 12)],
    ]);
  });

  it("desactivar: la RPC con `p_enabled` false, sea par o surtido", async () => {
    const { calls } = mountStore({ hasActiveRecipe: true, packIsComponentOf: ["Caja surtida"] });

    await upsertPackConversionForPackProduct(PACK, DEFAULT_STORE_ID, { enabled: false });

    expect(calls.map((call) => [call.op, call.table, call.payload])).toEqual([
      [
        "rpc",
        "save_pack_recipe",
        {
          p_components: null,
          p_enabled: false,
          p_label: null,
          p_pack_product_id: PACK,
          p_total_units: null,
        },
      ],
    ]);
  });

  it.each([
    [
      "PT400 · el empaque como componente",
      { code: "PT400", message: "El empaque no puede ser componente de sí mismo." },
      { code: "BAD_REQUEST", status: 400 },
    ],
    [
      "PT404 · componente inexistente o de otra tienda",
      { code: "PT404", message: "Producto componente no encontrado." },
      { code: "NOT_FOUND", status: 404 },
    ],
    [
      "PT409 · un componente es empaque con receta activa",
      { code: "PT409", message: "Un componente es un empaque con receta activa: no puede salir de otro empaque." },
      { code: "CONFLICT", status: 409 },
    ],
    [
      "PT409 · el empaque ya sale de otro empaque",
      { code: "PT409", message: "Este producto ya es unidad de Caja surtida; no puede ser a la vez un empaque." },
      { code: "CONFLICT", status: 409 },
    ],
    [
      "PT403 · rol sin permiso",
      { code: "PT403", message: "No autorizado para guardar la receta de un empaque" },
      { code: "FORBIDDEN", status: 403 },
    ],
  ])("el rechazo de la base llega con su código y su mensaje: %s", async (_case, rpcError, expected) => {
    const { calls } = mountStore({ rpcError });

    await expect(
      upsertPackConversionForPackProduct(PACK, DEFAULT_STORE_ID, assortedInput),
    ).rejects.toMatchObject({ ...expected, message: rpcError.message });

    // Nada que compensar: la RPC es una transacción.
    expect(calls).toHaveLength(1);
  });

  it("un interbloqueo de la base es un 409 reintentable, sin compensación", async () => {
    const { calls } = mountStore({ rpcError: { code: "40P01", message: "deadlock detected" } });

    await expect(
      upsertPackConversionForPackProduct(PACK, DEFAULT_STORE_ID, linkInput),
    ).rejects.toMatchObject({
      message: "La operacion choco con otra en curso y no se aplico. Intenta de nuevo.",
      status: 409,
    });

    expect(calls).toHaveLength(1);
  });

  it.each([
    ["surtido", assortedInput],
    ["1 a 1", linkInput],
    ["desactivar", { enabled: false as const }],
  ])("base sin el parche (PGRST202) · %s: 409 claro y ningún camino alternativo por tabla", async (_case, input) => {
    const { calls } = mountStore({
      rpcError: { code: "PGRST202", message: "Could not find the function public.save_pack_recipe" },
    });

    await expect(
      upsertPackConversionForPackProduct(PACK, DEFAULT_STORE_ID, input),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message:
        "Esta base aún no admite guardar la receta de un empaque de forma segura. No se guardó la receta.",
      status: 409,
    });

    expect(recipeTableWrites(calls)).toEqual([]);
    expect(calls.filter((call) => call.op === "rpc")).toHaveLength(1);
  });

  it("ningún fallo deja el mensaje de «quedó sin receta activa»: ya no hay pasos intermedios", async () => {
    mountStore({ rpcError: { code: "PT400", message: "Los componentes suman 5 unidades y el empaque declara 6." } });

    const failure = await upsertPackConversionForPackProduct(PACK, DEFAULT_STORE_ID, assortedInput).catch(
      (error: unknown) => error,
    );

    expect(failure).toMatchObject({
      message: "Los componentes suman 5 unidades y el empaque declara 6.",
      status: 400,
    });
    expect((failure as Error).message).not.toContain("sin receta activa");
  });

  describe("«crear unidad»", () => {
    it("crea el producto unidad y guarda la receta con la RPC", async () => {
      const { calls } = mountStore();

      await upsertPackConversionForPackProduct(PACK, DEFAULT_STORE_ID, createUnitInput, {
        currentCostRef: 12,
        name: "Bulto",
      });

      expect(writes(calls).map(([table, op]) => `${table}:${op}`)).toEqual([
        "products:insert",
        "save_pack_recipe:rpc",
      ]);
      expect(rpcCalls(calls)).toEqual([["save_pack_recipe", singleArgs("unit-new", 6)]]);
      expect(recipeTableWrites(calls)).toEqual([]);
    });

    it("el empaque ya sale de otro empaque: 409 con su nombre, sin crear la unidad ni llamar a la RPC", async () => {
      const { calls } = mountStore({ packIsComponentOf: ["Caja surtida"] });

      await expect(
        upsertPackConversionForPackProduct(PACK, DEFAULT_STORE_ID, createUnitInput, { name: "Bulto" }),
      ).rejects.toMatchObject({
        code: "CONFLICT",
        message: "Este producto ya es unidad de Caja surtida; no puede ser a la vez un empaque.",
        status: 409,
      });

      expect(writes(calls)).toEqual([]);
      const chainCall = calls.find((call) => call.table === "product_pack_components");
      expect(chainCall?.filters).toEqual([
        ["eq", "store_id", DEFAULT_STORE_ID],
        ["eq", "unit_product_id", PACK],
        ["eq", "conversion.is_active", true],
      ]);
    });

    it("sin poder leer el nombre del empaque, el mensaje no queda cortado", async () => {
      mountStore({ packIsComponentOf: [null] });

      await expect(
        upsertPackConversionForPackProduct(PACK, DEFAULT_STORE_ID, createUnitInput),
      ).rejects.toMatchObject({
        message: "Este producto ya es unidad de otro empaque; no puede ser a la vez un empaque.",
        status: 409,
      });
    });

    it("datos anteriores (ya era empaque y componente): no consulta la regla y guarda", async () => {
      const { calls } = mountStore({ hasActiveRecipe: true, packIsComponentOf: ["Caja surtida"] });

      await upsertPackConversionForPackProduct(PACK, DEFAULT_STORE_ID, createUnitInput);

      expect(calls.some((call) => call.table === "product_pack_components")).toBe(false);
      expect(rpcCalls(calls)).toHaveLength(1);
    });

    it.each([
      ["la base rechaza la receta", { code: "PT409", message: "Este producto ya es unidad de Caja surtida; no puede ser a la vez un empaque." }],
      ["la base no tiene el parche", { code: "PGRST202", message: "Could not find the function" }],
    ])("si %s, borra la unidad recién creada y devuelve ese error", async (_case, rpcError) => {
      const { calls } = mountStore({ rpcError });

      await expect(
        upsertPackConversionForPackProduct(PACK, DEFAULT_STORE_ID, createUnitInput),
      ).rejects.toMatchObject({ status: 409 });

      const last = calls[calls.length - 1];
      expect([last.table, last.op]).toEqual(["products", "delete"]);
      expect(hasFilter(last, "eq", "id", "unit-new")).toBe(true);
      expect(hasFilter(last, "eq", "store_id", DEFAULT_STORE_ID)).toBe(true);
    });
  });
});
