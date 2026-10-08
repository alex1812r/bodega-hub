/**
 * @jest-environment node
 */
/**
 * PRO-12 · receta de empaque con N componentes (parche 20261009d), lado BFF con
 * Supabase simulado: lecturas (un vínculo, surtido, unidad en varias recetas) y
 * escritura de la receta en el orden que exige la base, con su compensación.
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
  op: "delete" | "insert" | "select" | "update";
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

  (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ from });

  return { calls };
}

const PACK = "pack-1";
const OLD_RECIPE = "recipe-old";
const DRAFT = "recipe-draft";

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

describe("packConversion.server · guardar la receta", () => {
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

  const singleExisting = {
    components: [{ cost_weight: 1, unit_product_id: "unit-cola", units_per_pack: 10 }],
    id: OLD_RECIPE,
    label: null,
    total_units: 10,
    unit_product_id: "unit-cola",
  };

  const assortedExisting = {
    components: [
      { cost_weight: 1, unit_product_id: "unit-cola", units_per_pack: 2 },
      { cost_weight: "1.5", unit_product_id: "unit-naranja", units_per_pack: 2 },
      { cost_weight: 1, unit_product_id: "unit-uva", units_per_pack: 2 },
    ],
    id: OLD_RECIPE,
    label: "Surtido 6",
    total_units: 6,
    unit_product_id: null,
  };

  /**
   * Base simulada: los productos existen, ninguno es empaque, `existing` es la
   * receta activa del empaque y `fail` decide qué escritura falla.
   */
  function mountStore(options: {
    existing?: typeof singleExisting | typeof assortedExisting | null;
    fail?: (call: Call) => boolean;
    knownProducts?: string[];
    /** Nombres de los empaques de cuyas recetas ACTIVAS sale el empaque que se guarda. */
    packIsComponentOf?: (string | null)[];
    packsAmongComponents?: string[];
  } = {}) {
    const failure = { code: "PT400", message: "Los componentes de la receta suman 5 unidades y el empaque declara 6" };

    return mountSupabase((call) => {
      if (options.fail?.(call)) {
        return { error: failure };
      }

      if (call.table === "products" && call.op === "select") {
        return {
          data: (options.knownProducts ?? ["unit-cola", "unit-naranja", "unit-uva"]).map((id) => ({ id })),
        };
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
        if (call.select === "pack_product_id") {
          return { data: (options.packsAmongComponents ?? []).map((id) => ({ pack_product_id: id })) };
        }

        if (call.select === "id") {
          return { data: null };
        }

        return { data: options.existing ?? null };
      }

      if (call.table === "product_pack_conversions" && call.op === "insert") {
        return { data: { id: DRAFT } };
      }

      return {};
    });
  }

  const draftHeader = {
    is_active: false,
    label: "Surtido 6",
    pack_product_id: PACK,
    store_id: DEFAULT_STORE_ID,
    total_units: 6,
  };
  const draftComponents = [
    { conversion_id: DRAFT, cost_weight: 1, store_id: DEFAULT_STORE_ID, unit_product_id: "unit-cola", units_per_pack: 2 },
    { conversion_id: DRAFT, cost_weight: 1.5, store_id: DEFAULT_STORE_ID, unit_product_id: "unit-naranja", units_per_pack: 2 },
    { conversion_id: DRAFT, cost_weight: 1, store_id: DEFAULT_STORE_ID, unit_product_id: "unit-uva", units_per_pack: 2 },
  ];

  it("surtido nuevo: cabecera inactiva → componentes → activar", async () => {
    const { calls } = mountStore();

    await upsertPackConversionForPackProduct(PACK, DEFAULT_STORE_ID, assortedInput);

    expect(writes(calls)).toEqual([
      ["product_pack_conversions", "insert", draftHeader],
      ["product_pack_components", "insert", draftComponents],
      ["product_pack_conversions", "update", { is_active: true }],
    ]);
    const activation = calls[calls.length - 1];
    expect(hasFilter(activation, "eq", "id", DRAFT)).toBe(true);
  });

  it("de 1 a 1 a surtido: receta nueva y la anterior se desactiva justo antes de activar (no se editan sus componentes)", async () => {
    const { calls } = mountStore({ existing: singleExisting });

    await upsertPackConversionForPackProduct(PACK, DEFAULT_STORE_ID, assortedInput);

    expect(writes(calls)).toEqual([
      ["product_pack_conversions", "insert", draftHeader],
      ["product_pack_components", "insert", draftComponents],
      ["product_pack_conversions", "update", { is_active: false }],
      ["product_pack_conversions", "update", { is_active: true }],
    ]);
    const [deactivate, activate] = calls.filter((call) => call.op === "update");
    expect(hasFilter(deactivate, "eq", "id", OLD_RECIPE)).toBe(true);
    expect(hasFilter(activate, "eq", "id", DRAFT)).toBe(true);
    expect(calls.some((call) => call.op === "delete")).toBe(false);
  });

  it("editar un surtido (otras unidades) también crea receta nueva", async () => {
    const { calls } = mountStore({
      existing: { ...assortedExisting, components: assortedExisting.components.slice(0, 2), total_units: 4 },
    });

    await upsertPackConversionForPackProduct(PACK, DEFAULT_STORE_ID, assortedInput);

    expect(writes(calls).map(([table, op]) => `${table}:${op}`)).toEqual([
      "product_pack_conversions:insert",
      "product_pack_components:insert",
      "product_pack_conversions:update",
      "product_pack_conversions:update",
    ]);
  });

  it("la misma receta no escribe nada; si solo cambia el nombre, solo el nombre", async () => {
    const same = mountStore({ existing: assortedExisting });
    await upsertPackConversionForPackProduct(PACK, DEFAULT_STORE_ID, assortedInput);
    expect(writes(same.calls)).toEqual([]);

    const renamed = mountStore({ existing: { ...assortedExisting, label: "Otro nombre" } });
    await upsertPackConversionForPackProduct(PACK, DEFAULT_STORE_ID, assortedInput);
    expect(writes(renamed.calls)).toEqual([["product_pack_conversions", "update", { label: "Surtido 6" }]]);
  });

  it("compensa si fallan los componentes: borra el borrador y la receta anterior sigue activa", async () => {
    const { calls } = mountStore({
      existing: singleExisting,
      fail: (call) => call.table === "product_pack_components" && call.op === "insert",
    });

    await expect(
      upsertPackConversionForPackProduct(PACK, DEFAULT_STORE_ID, assortedInput),
    ).rejects.toMatchObject({ status: 400 });

    expect(writes(calls).map(([table, op]) => `${table}:${op}`)).toEqual([
      "product_pack_conversions:insert",
      "product_pack_components:insert",
      "product_pack_conversions:delete",
    ]);
    const discard = calls[calls.length - 1];
    expect(hasFilter(discard, "eq", "id", DRAFT)).toBe(true);
    expect(hasFilter(discard, "eq", "store_id", DEFAULT_STORE_ID)).toBe(true);
    // Nunca borra una receta en uso.
    expect(hasFilter(discard, "eq", "is_active", false)).toBe(true);
  });

  it("compensa si falla desactivar la anterior: borra el borrador y no activa nada", async () => {
    const { calls } = mountStore({
      existing: singleExisting,
      fail: (call) => call.op === "update" && hasFilter(call, "eq", "id", OLD_RECIPE),
    });

    await expect(
      upsertPackConversionForPackProduct(PACK, DEFAULT_STORE_ID, assortedInput),
    ).rejects.toMatchObject({ status: 400 });

    expect(writes(calls).map(([, op, payload]) => [op, payload])).toEqual([
      ["insert", draftHeader],
      ["insert", draftComponents],
      ["update", { is_active: false }],
      ["delete", undefined],
    ]);
  });

  it("compensa si falla la activación: reactiva la anterior y borra el borrador", async () => {
    const { calls } = mountStore({
      existing: singleExisting,
      fail: (call) =>
        call.op === "update" &&
        hasFilter(call, "eq", "id", DRAFT) &&
        (call.payload as { is_active?: boolean }).is_active === true,
    });

    await expect(
      upsertPackConversionForPackProduct(PACK, DEFAULT_STORE_ID, assortedInput),
    ).rejects.toMatchObject({
      message: "Los componentes de la receta suman 5 unidades y el empaque declara 6",
      status: 400,
    });

    const tail = calls.slice(-3);
    expect(tail.map((call) => [call.op, call.payload])).toEqual([
      ["update", { is_active: true }],
      ["update", { is_active: true }],
      ["delete", undefined],
    ]);
    expect(hasFilter(tail[0], "eq", "id", DRAFT)).toBe(true);
    expect(hasFilter(tail[1], "eq", "id", OLD_RECIPE)).toBe(true);
    expect(hasFilter(tail[2], "eq", "id", DRAFT)).toBe(true);
  });

  it("si tampoco se puede restaurar la anterior, el error lo dice", async () => {
    mountStore({
      existing: singleExisting,
      fail: (call) =>
        call.op === "update" && (call.payload as { is_active?: boolean }).is_active === true,
    });

    await expect(
      upsertPackConversionForPackProduct(PACK, DEFAULT_STORE_ID, assortedInput),
    ).rejects.toMatchObject({
      message: expect.stringContaining("el empaque quedó sin receta activa"),
      status: 400,
    });
  });

  it("rechaza antes de escribir: el empaque como componente (400), componente inexistente (404), componente que es empaque (409)", async () => {
    const self = mountStore();
    await expect(
      upsertPackConversionForPackProduct("unit-cola", DEFAULT_STORE_ID, assortedInput),
    ).rejects.toMatchObject({ message: "El empaque no puede ser componente de sí mismo.", status: 400 });
    expect(self.calls).toEqual([]);

    const missing = mountStore({ knownProducts: ["unit-cola", "unit-uva"] });
    await expect(
      upsertPackConversionForPackProduct(PACK, DEFAULT_STORE_ID, assortedInput),
    ).rejects.toMatchObject({ status: 404 });
    expect(writes(missing.calls)).toEqual([]);

    const chained = mountStore({ packsAmongComponents: ["unit-uva"] });
    await expect(
      upsertPackConversionForPackProduct(PACK, DEFAULT_STORE_ID, assortedInput),
    ).rejects.toMatchObject({ status: 409 });
    expect(writes(chained.calls)).toEqual([]);
    const packsCall = chained.calls.find((call) => call.select === "pack_product_id");
    expect(hasFilter(packsCall!, "in", "pack_product_id", ["unit-cola", "unit-naranja", "unit-uva"])).toBe(true);
    expect(hasFilter(packsCall!, "eq", "is_active", true)).toBe(true);
  });

  const linkInput = packConversionInputSchema.parse({
    enabled: true,
    mode: "link_existing",
    unitProductId: "unit-cola",
    unitsPerPack: 12,
  });

  it("1 a 1 nuevo: el mismo insert de siempre", async () => {
    const { calls } = mountStore();

    await upsertPackConversionForPackProduct(PACK, DEFAULT_STORE_ID, linkInput);

    expect(writes(calls)).toEqual([
      [
        "product_pack_conversions",
        "insert",
        {
          is_active: true,
          pack_product_id: PACK,
          store_id: DEFAULT_STORE_ID,
          unit_product_id: "unit-cola",
          units_per_pack: 12,
        },
      ],
    ]);
  });

  it("1 a 1 con la misma unidad: el mismo update en sitio de siempre", async () => {
    const { calls } = mountStore({ existing: singleExisting });

    await upsertPackConversionForPackProduct(PACK, DEFAULT_STORE_ID, linkInput);

    expect(writes(calls)).toEqual([
      ["product_pack_conversions", "update", { unit_product_id: "unit-cola", units_per_pack: 12 }],
    ]);
    expect(hasFilter(calls[calls.length - 1], "eq", "id", OLD_RECIPE)).toBe(true);
  });

  it("una unidad que ya sale de otro empaque se acepta; una que es empaque, no (409)", async () => {
    const { calls } = mountStore();
    await upsertPackConversionForPackProduct(PACK, DEFAULT_STORE_ID, linkInput);
    const availability = calls.find((call) => call.select === "id" && call.table === "product_pack_conversions");
    // Solo se mira si la unidad es EMPAQUE de una receta activa, no si es componente de otra.
    expect(availability?.filters).toEqual([
      ["eq", "store_id", DEFAULT_STORE_ID],
      ["eq", "is_active", true],
      ["eq", "pack_product_id", "unit-cola"],
    ]);

    const asPack = mountSupabase((call) =>
      call.table === "product_pack_conversions" && call.select === "id" ? { data: { id: "recipe-x" } } : {},
    );
    await expect(
      upsertPackConversionForPackProduct(PACK, DEFAULT_STORE_ID, linkInput),
    ).rejects.toMatchObject({ status: 409 });
    expect(writes(asPack.calls)).toEqual([]);
  });

  it("de surtido a 1 a 1 (y 1 a 1 con otra unidad): desactiva la anterior e inserta la nueva", async () => {
    for (const existing of [assortedExisting, { ...singleExisting, unit_product_id: "unit-uva" }]) {
      const { calls } = mountStore({ existing });

      await upsertPackConversionForPackProduct(PACK, DEFAULT_STORE_ID, linkInput);

      expect(writes(calls)).toEqual([
        ["product_pack_conversions", "update", { is_active: false }],
        [
          "product_pack_conversions",
          "insert",
          {
            is_active: true,
            pack_product_id: PACK,
            store_id: DEFAULT_STORE_ID,
            unit_product_id: "unit-cola",
            units_per_pack: 12,
          },
        ],
      ]);
    }
  });

  it("si falla el insert de la receta 1 a 1 nueva, reactiva la anterior", async () => {
    const { calls } = mountStore({
      existing: assortedExisting,
      fail: (call) => call.table === "product_pack_conversions" && call.op === "insert",
    });

    await expect(
      upsertPackConversionForPackProduct(PACK, DEFAULT_STORE_ID, linkInput),
    ).rejects.toMatchObject({ status: 400 });

    const last = calls[calls.length - 1];
    expect([last.op, last.payload]).toEqual(["update", { is_active: true }]);
    expect(hasFilter(last, "eq", "id", OLD_RECIPE)).toBe(true);
  });

  it("desactivar: apaga la receta activa del empaque, sea par o surtido", async () => {
    const { calls } = mountStore({ existing: assortedExisting });

    await upsertPackConversionForPackProduct(PACK, DEFAULT_STORE_ID, { enabled: false });

    expect(writes(calls)).toEqual([["product_pack_conversions", "update", { is_active: false }]]);
    expect(calls[0].filters).toEqual([
      ["eq", "store_id", DEFAULT_STORE_ID],
      ["eq", "pack_product_id", PACK],
      ["eq", "is_active", true],
    ]);
  });

  /**
   * PRO-F8 · la regla de cadenas en los dos sentidos: un producto que ya sale de
   * un empaque (componente de una receta activa) no puede estrenar receta propia.
   */
  describe("un componente de una receta activa no puede pasar a ser empaque (PRO-F8)", () => {
    const CHAIN_MESSAGE =
      "Este producto ya es unidad de Caja surtida; no puede ser a la vez un empaque.";
    const createUnitInput = packConversionInputSchema.parse({
      enabled: true,
      mode: "create_unit",
      unitProduct: { name: "Unidad suelta", salePriceRef: 1 },
      unitsPerPack: 6,
    });

    it.each([
      ["1 a 1 con unidad existente", linkInput],
      ["1 a 1 creando la unidad", createUnitInput],
      ["surtido", assortedInput],
    ])("%s: 409 con el nombre del empaque del que sale, sin escribir nada", async (_case, input) => {
      const { calls } = mountStore({ packIsComponentOf: ["Caja surtida"] });

      await expect(
        upsertPackConversionForPackProduct(PACK, DEFAULT_STORE_ID, input, { name: "Bulto" }),
      ).rejects.toMatchObject({ code: "CONFLICT", message: CHAIN_MESSAGE, status: 409 });

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
        upsertPackConversionForPackProduct(PACK, DEFAULT_STORE_ID, linkInput),
      ).rejects.toMatchObject({
        message: "Este producto ya es unidad de otro empaque; no puede ser a la vez un empaque.",
        status: 409,
      });
    });

    it("un producto que no sale de ningún empaque estrena receta como siempre", async () => {
      const { calls } = mountStore({ packIsComponentOf: [] });

      await upsertPackConversionForPackProduct(PACK, DEFAULT_STORE_ID, linkInput);

      expect(writes(calls)).toHaveLength(1);
    });

    it.each([
      ["editar unidades en sitio", singleExisting, linkInput, 1],
      ["cambiar a surtido", singleExisting, assortedInput, 4],
      ["cambiar de surtido a 1 a 1", assortedExisting, linkInput, 2],
    ])(
      "datos anteriores (ya era empaque y componente): %s sigue permitido",
      async (_case, existing, input, expectedWrites) => {
        const { calls } = mountStore({ existing, packIsComponentOf: ["Caja surtida"] });

        await upsertPackConversionForPackProduct(PACK, DEFAULT_STORE_ID, input);

        expect(writes(calls)).toHaveLength(expectedWrites);
      },
    );

    it("desactivar la receta no consulta la regla", async () => {
      const { calls } = mountStore({ existing: singleExisting, packIsComponentOf: ["Caja surtida"] });

      await upsertPackConversionForPackProduct(PACK, DEFAULT_STORE_ID, { enabled: false });

      expect(calls.some((call) => call.table === "product_pack_components")).toBe(false);
    });
  });
});
