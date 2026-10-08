/**
 * @jest-environment node
 */
/**
 * COM-14 · preferencia «Desarmar siempre al recibir compras» de la receta
 * (`product_pack_conversions.always_disassemble_on_receive`, parche 20261010e),
 * lado BFF con Supabase simulado: se lee con la receta y se escribe por la misma
 * vía (tabla directa). Ausente en la petición = no cambia.
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

  (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ from });

  return { calls };
}

const PACK = "pack-1";
const OLD_RECIPE = "recipe-old";
const DRAFT = "recipe-draft";

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

type ExistingRecipe = {
  always_disassemble_on_receive?: boolean;
  components: { cost_weight: number; unit_product_id: string; units_per_pack: number }[];
  id: string;
  label: string | null;
  total_units: number;
  unit_product_id: string | null;
};

const singleExisting: ExistingRecipe = {
  components: [{ cost_weight: 1, unit_product_id: "unit-cola", units_per_pack: 10 }],
  id: OLD_RECIPE,
  label: null,
  total_units: 10,
  unit_product_id: "unit-cola",
};

const assortedExisting: ExistingRecipe = {
  components: [
    { cost_weight: 1, unit_product_id: "unit-cola", units_per_pack: 2 },
    { cost_weight: 1, unit_product_id: "unit-naranja", units_per_pack: 2 },
    { cost_weight: 1, unit_product_id: "unit-uva", units_per_pack: 2 },
  ],
  id: OLD_RECIPE,
  label: null,
  total_units: 6,
  unit_product_id: null,
};

/** Base simulada: los productos existen, ninguno es empaque y `existing` es la receta activa. */
function mountStore(existing: ExistingRecipe | null) {
  return mountSupabase((call) => {
    if (call.table === "products" && call.op === "select") {
      return { data: ["unit-cola", "unit-naranja", "unit-uva"].map((id) => ({ id })) };
    }

    if (call.table === "product_pack_components" && call.op === "select") {
      return { data: [] };
    }

    if (call.table === "product_pack_conversions" && call.op === "select") {
      if (call.select === "pack_product_id") {
        return { data: [] };
      }

      return { data: call.select === "id" ? null : existing };
    }

    if (call.table === "product_pack_conversions" && call.op === "insert") {
      return { data: { id: DRAFT } };
    }

    return {};
  });
}

/** Escrituras sobre la cabecera de la receta, en orden. */
function headerWrites(calls: Call[]) {
  return calls
    .filter((call) => call.table === "product_pack_conversions" && call.op !== "select")
    .map((call) => [call.op, call.payload]);
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

describe("packConversion.server · guardar la preferencia", () => {
  it("receta 1 a 1 nueva con la preferencia: el insert de la cabecera la lleva en true", async () => {
    const { calls } = mountStore(null);

    await save(link("unit-cola", 12, { alwaysDisassembleOnReceive: true }));

    expect(headerWrites(calls)).toEqual([
      [
        "insert",
        {
          always_disassemble_on_receive: true,
          is_active: true,
          pack_product_id: PACK,
          store_id: DEFAULT_STORE_ID,
          unit_product_id: "unit-cola",
          units_per_pack: 12,
        },
      ],
    ]);
  });

  it("receta nueva sin la preferencia (o en false): el insert de siempre, sin nombrar la columna", async () => {
    for (const extra of [{}, { alwaysDisassembleOnReceive: false }]) {
      const { calls } = mountStore(null);

      await save(link("unit-cola", 12, extra));

      expect(headerWrites(calls)).toEqual([
        [
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

  it("1 a 1 con la misma unidad: la preferencia viaja en el mismo update en sitio; sin ella, el update de siempre", async () => {
    const withPreference = mountStore(singleExisting);

    await save(link("unit-cola", 10, { alwaysDisassembleOnReceive: true }));

    expect(headerWrites(withPreference.calls)).toEqual([
      [
        "update",
        { always_disassemble_on_receive: true, unit_product_id: "unit-cola", units_per_pack: 10 },
      ],
    ]);

    const without = mountStore({ ...singleExisting, always_disassemble_on_receive: true });

    await save(link("unit-cola", 24));

    expect(headerWrites(without.calls)).toEqual([
      ["update", { unit_product_id: "unit-cola", units_per_pack: 24 }],
    ]);
  });

  it("quitar la preferencia de una receta que la tenía: el update la deja en false", async () => {
    const { calls } = mountStore({ ...singleExisting, always_disassemble_on_receive: true });

    await save(link("unit-cola", 10, { alwaysDisassembleOnReceive: false }));

    expect(headerWrites(calls)).toEqual([
      [
        "update",
        { always_disassemble_on_receive: false, unit_product_id: "unit-cola", units_per_pack: 10 },
      ],
    ]);
  });

  it("el mismo surtido: solo se escribe la preferencia si cambia", async () => {
    const changed = mountStore(assortedExisting);

    await save(assorted([2, 2, 2], { alwaysDisassembleOnReceive: true }));

    expect(headerWrites(changed.calls)).toEqual([
      ["update", { always_disassemble_on_receive: true }],
    ]);

    const same = mountStore({ ...assortedExisting, always_disassemble_on_receive: true });

    await save(assorted([2, 2, 2], { alwaysDisassembleOnReceive: true }));
    await save(assorted([2, 2, 2]));

    expect(headerWrites(same.calls)).toEqual([]);
  });

  it("receta reemplazada sin nombrar la preferencia: la cabecera nueva conserva la de la anterior", async () => {
    const assortedReplaced = mountStore({ ...assortedExisting, always_disassemble_on_receive: true });

    await save(assorted([3, 2, 1]));

    expect(headerWrites(assortedReplaced.calls)[0]).toEqual([
      "insert",
      {
        always_disassemble_on_receive: true,
        is_active: false,
        label: null,
        pack_product_id: PACK,
        store_id: DEFAULT_STORE_ID,
        total_units: 6,
      },
    ]);

    const otherUnit = mountStore({ ...singleExisting, always_disassemble_on_receive: true });

    await save(link("unit-uva", 10));

    expect(headerWrites(otherUnit.calls)).toEqual([
      ["update", { is_active: false }],
      [
        "insert",
        {
          always_disassemble_on_receive: true,
          is_active: true,
          pack_product_id: PACK,
          store_id: DEFAULT_STORE_ID,
          unit_product_id: "unit-uva",
          units_per_pack: 10,
        },
      ],
    ]);
  });

  it("receta reemplazada con la preferencia en false: la cabecera nueva nace sin ella", async () => {
    const { calls } = mountStore({ ...assortedExisting, always_disassemble_on_receive: true });

    await save(assorted([3, 2, 1], { alwaysDisassembleOnReceive: false }));

    expect(headerWrites(calls)[0]).toEqual([
      "insert",
      {
        is_active: false,
        label: null,
        pack_product_id: PACK,
        store_id: DEFAULT_STORE_ID,
        total_units: 6,
      },
    ]);
  });
});
