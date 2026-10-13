/**
 * @jest-environment node
 */
/**
 * COM-14 · preferencia «Desarmar siempre al recibir compras» de la receta
 * (`product_pack_conversions.always_disassemble_on_receive`, parche 20261010e),
 * lado BFF con Supabase simulado: se lee con la receta (tabla, solo `select`) y
 * se ESCRIBE por la RPC `save_pack_recipe` (parche 20261012a, INT-02): desde
 * 20261011d el BFF no puede escribir `product_pack_conversions` ni
 * `product_pack_components` por tabla. Ausente en la petición = no cambia.
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
    const call: Call = { op: "select", table };
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
      builder[name] = () => builder;
    }

    return builder;
  });

  const rpc = jest.fn((name: string, args: unknown) => {
    const call: Call = { op: "rpc", payload: args, table: name };

    calls.push(call);

    return Promise.resolve({ data: null, error: null, ...respond(call) });
  });

  (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ from, rpc });

  return { calls };
}

const PACK = "pack-1";

function product(id: string, name: string) {
  return {
    current_cost_ref: 1.5,
    current_stock: 4,
    id,
    is_active: true,
    name,
    sale_price_ref: 2,
    sku: `sku-${id}`,
  };
}

/** Base simulada: los productos existen y ninguno es empaque; la RPC responde `rpcReply`. */
function mountStore(rpcReply: Reply = {}) {
  return mountSupabase((call) => {
    if (call.op === "rpc") {
      return rpcReply;
    }

    if (call.table === "products" && call.op === "select") {
      return { data: ["unit-cola", "unit-naranja", "unit-uva"].map((id) => ({ id })) };
    }

    if (call.table === "products" && call.op === "insert") {
      return { data: { id: "unit-new" } };
    }

    if (call.op === "select") {
      return { data: call.select === "id" || call.select === "pack_product_id" ? null : [] };
    }

    return {};
  });
}

/** Escrituras DIRECTAS sobre las tablas de la receta (prohibidas desde 20261011d). */
function recipeTableWrites(calls: Call[]) {
  return calls.filter(
    (call) =>
      (call.table === "product_pack_conversions" || call.table === "product_pack_components") &&
      (call.op === "insert" || call.op === "update" || call.op === "delete"),
  );
}

/** Argumentos de cada llamada a `save_pack_recipe`, en orden. */
function recipeRpcArgs(calls: Call[]) {
  return calls
    .filter((call) => call.op === "rpc" && call.table === "save_pack_recipe")
    .map((call) => call.payload as Record<string, unknown>);
}

function assorted(units: [number, number, number], extra: Record<string, unknown> = {}) {
  return packConversionInputSchema.parse({
    components: [
      { unitProductId: "unit-cola", unitsPerPack: units[0] },
      { unitProductId: "unit-naranja", unitsPerPack: units[1] },
      { unitProductId: "unit-uva", unitsPerPack: units[2] },
    ],
    enabled: true,
    mode: "assorted",
    totalUnits: units[0] + units[1] + units[2],
    ...extra,
  });
}

function link(unitProductId: string, unitsPerPack: number, extra: Record<string, unknown> = {}) {
  return packConversionInputSchema.parse({
    enabled: true,
    mode: "link_existing",
    unitProductId,
    unitsPerPack,
    ...extra,
  });
}

function save(input: ReturnType<typeof link>) {
  return upsertPackConversionForPackProduct(PACK, DEFAULT_STORE_ID, input);
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

describe("packConversion.server · leer la preferencia «Desarmar siempre al recibir compras»", () => {
  const cola = product("unit-cola", "Refresco cola");
  const caja = product(PACK, "Caja de cola");
  const row = (always: boolean | undefined) => ({
    ...(always === undefined ? {} : { always_disassemble_on_receive: always }),
    components: [{ cost_weight: 1, unit_product: cola, unit_product_id: cola.id, units_per_pack: 12 }],
    id: "recipe-1",
    label: null,
    pack_product: caja,
    pack_product_id: caja.id,
    total_units: 12,
  });

  it("la lectura de la receta pide la columna de la cabecera", async () => {
    const { calls } = mountSupabase(() => ({ data: [] }));

    await listPackConversions(DEFAULT_STORE_ID);

    expect(calls[0]?.select).toContain("always_disassemble_on_receive");
  });

  it("listPackConversions: viaja como alwaysDisassembleOnReceive solo cuando la receta la tiene", async () => {
    mountSupabase(() => ({
      data: [row(true), { ...row(false), id: "recipe-2" }, { ...row(undefined), id: "recipe-3" }],
    }));

    const items = await listPackConversions(DEFAULT_STORE_ID);

    expect(items.map((item) => [item.id, item.alwaysDisassembleOnReceive])).toEqual([
      ["recipe-1", true],
      ["recipe-2", undefined],
      ["recipe-3", undefined],
    ]);
    expect(items.map((item) => "alwaysDisassembleOnReceive" in item)).toEqual([true, false, false]);
  });

  it("el detalle del empaque la trae en su packConversion", async () => {
    mountSupabase((call) =>
      call.table === "product_pack_conversions" ? { data: row(true) } : { data: [] },
    );

    const summary = await getPackConversionForProduct(PACK, DEFAULT_STORE_ID);

    expect(summary).toMatchObject({ alwaysDisassembleOnReceive: true, id: "recipe-1", role: "pack" });
  });
});

describe("packConversion.server · guardar la preferencia por save_pack_recipe (INT-02)", () => {
  it("1 a 1 con la preferencia: una sola llamada a la RPC con p_always_disassemble_on_receive y NINGUNA escritura por tabla", async () => {
    const { calls } = mountStore();

    await save(link("unit-cola", 12, { alwaysDisassembleOnReceive: true }));

    expect(recipeTableWrites(calls)).toEqual([]);
    expect(recipeRpcArgs(calls)).toEqual([
      {
        p_always_disassemble_on_receive: true,
        p_components: [{ cost_weight: 1, unit_product_id: "unit-cola", units_per_pack: 12 }],
        p_enabled: true,
        p_label: null,
        p_pack_product_id: PACK,
        p_total_units: 12,
      },
    ]);
  });

  it("quitar la preferencia: viaja en false (no se omite)", async () => {
    const { calls } = mountStore();

    await save(link("unit-cola", 10, { alwaysDisassembleOnReceive: false }));

    expect(recipeTableWrites(calls)).toEqual([]);
    expect(recipeRpcArgs(calls).map((args) => args.p_always_disassemble_on_receive)).toEqual([
      false,
    ]);
  });

  it("surtido con la preferencia: misma RPC, mismo argumento", async () => {
    const { calls } = mountStore();

    await save(assorted([3, 2, 1], { alwaysDisassembleOnReceive: true, label: "Surtido" }));

    expect(recipeTableWrites(calls)).toEqual([]);
    expect(recipeRpcArgs(calls)).toEqual([
      {
        p_always_disassemble_on_receive: true,
        p_components: [
          { cost_weight: 1, unit_product_id: "unit-cola", units_per_pack: 3 },
          { cost_weight: 1, unit_product_id: "unit-naranja", units_per_pack: 2 },
          { cost_weight: 1, unit_product_id: "unit-uva", units_per_pack: 1 },
        ],
        p_enabled: true,
        p_label: "Surtido",
        p_pack_product_id: PACK,
        p_total_units: 6,
      },
    ]);
  });

  it("create_unit con la preferencia: la unidad se crea y la receta va por la RPC con el argumento", async () => {
    const { calls } = mountStore();

    await save(
      packConversionInputSchema.parse({
        alwaysDisassembleOnReceive: true,
        enabled: true,
        mode: "create_unit",
        unitProduct: { salePriceRef: 1 },
        unitsPerPack: 6,
      }),
    );

    expect(recipeTableWrites(calls)).toEqual([]);
    expect(recipeRpcArgs(calls)).toEqual([
      {
        p_always_disassemble_on_receive: true,
        p_components: [{ cost_weight: 1, unit_product_id: "unit-new", units_per_pack: 6 }],
        p_enabled: true,
        p_label: null,
        p_pack_product_id: PACK,
        p_total_units: 6,
      },
    ]);
  });

  it("sin la preferencia en la petición: el argumento NO se envía (la base conserva o hereda la que hubiera; sirve sobre una base sin 20261012a)", async () => {
    for (const input of [link("unit-cola", 24), assorted([2, 2, 2])]) {
      const { calls } = mountStore();

      await save(input);

      expect(recipeTableWrites(calls)).toEqual([]);
      expect(recipeRpcArgs(calls)).toHaveLength(1);
      expect("p_always_disassemble_on_receive" in recipeRpcArgs(calls)[0]).toBe(false);
    }
  });

  it("desactivar la receta: no nombra la preferencia aunque la petición la traiga", async () => {
    const { calls } = mountStore();

    await save(packConversionInputSchema.parse({ alwaysDisassembleOnReceive: true, enabled: false }));

    expect(recipeTableWrites(calls)).toEqual([]);
    expect(recipeRpcArgs(calls)).toEqual([
      {
        p_components: null,
        p_enabled: false,
        p_label: null,
        p_pack_product_id: PACK,
        p_total_units: null,
      },
    ]);
  });

  it("base sin 20261012a (PGRST202) al guardar la preferencia: 409 y nada escrito por tabla", async () => {
    const { calls } = mountStore({
      error: {
        code: "PGRST202",
        message: "Could not find the function public.save_pack_recipe(...) in the schema cache",
      },
    });

    await expect(
      save(link("unit-cola", 12, { alwaysDisassembleOnReceive: true })),
    ).rejects.toMatchObject({ status: 409 });
    expect(recipeTableWrites(calls)).toEqual([]);
  });
});
