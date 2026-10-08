/**
 * @jest-environment node
 */
/**
 * PRO-12 · `convertPackToUnits` contra `convert_pack_to_units(…, p_components)`
 * (parche 20261009d) con Supabase simulado: la llamada 1 a 1 no cambia, el
 * reparto viaja como `p_components`, se rechaza temprano lo que no cuadra y la
 * respuesta trae los componentes que devuelve la RPC.
 */

jest.mock("../../../lib/supabase/route-client");
jest.mock("../../../lib/supabase/admin-client");

import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { convertPackToUnits } from "./inventory.server";

const CLIENT_REQUEST_ID = "6f1a2b3c-4d5e-4f60-8a71-92b3c4d5e6f7";
const PACK = "22222222-2222-4222-8222-222222222222";
const COLA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NARANJA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const UVA = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CONVERSION = "33333333-3333-4333-8333-333333333333";

function movement(productId: string, quantityDelta: number, type: "conversion_entrada" | "conversion_salida") {
  return {
    conversion_id: CONVERSION,
    created_at: "2026-10-08T14:00:00.000Z",
    id: `mov-${productId.slice(0, 4)}`,
    product_id: productId,
    quantity_delta: quantityDelta,
    reason: null,
    stock_after: Math.abs(quantityDelta),
    type,
  };
}

function component(
  unitProductId: string,
  units: number,
  allocatedValueRef: number | string,
  extra: Record<string, number | string> = {},
) {
  return {
    allocatedValueRef,
    costWeight: 1,
    isActive: true,
    movement: movement(unitProductId, units, "conversion_entrada"),
    newCostRef: 2,
    unitCostRef: 2,
    unitProductId,
    units,
    ...extra,
  };
}

/** Lo que devuelve la RPC al abrir un surtido 2-2-2 de costo 12. */
function assortedPayload(components: ReturnType<typeof component>[]) {
  return {
    components,
    conversionId: CONVERSION,
    packMovement: movement(PACK, -1, "conversion_salida"),
    packQuantity: 1,
    totalUnits: 6,
    unitCostRef: 2,
    unitMovement: components[0].movement,
    unitQuantity: 6,
    unitsPerPack: 6,
  };
}

const recipeRow = {
  components: [{ unit_product_id: COLA }, { unit_product_id: NARANJA }, { unit_product_id: UVA }],
  total_units: 6,
};

function mount(options: { recipe?: typeof recipeRow | null; recipeError?: unknown; rpc: jest.Mock }) {
  const maybeSingle = jest.fn().mockResolvedValue({
    data: options.recipe === undefined ? recipeRow : options.recipe,
    error: options.recipeError ?? null,
  });
  const recipeQuery: Record<string, jest.Mock> = { eq: jest.fn(), maybeSingle, select: jest.fn() };

  recipeQuery.eq.mockReturnValue(recipeQuery);
  recipeQuery.select.mockReturnValue(recipeQuery);

  const from = jest.fn(() => recipeQuery);

  (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ from, rpc: options.rpc });

  return { from, recipeQuery };
}

beforeEach(() => {
  jest.clearAllMocks();
  (createAdminSupabaseClient as jest.Mock).mockReturnValue({
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          maybeSingle: jest.fn().mockResolvedValue({ data: { store_id: DEFAULT_STORE_ID }, error: null }),
        })),
      })),
    })),
  });
});

describe("inventory.server · convertPackToUnits con receta de N componentes", () => {
  it("receta 2-2-2 sin reparto: la llamada de siempre (sin p_components ni lectura previa) y los 3 componentes en la respuesta", async () => {
    const payload = assortedPayload([component(COLA, 2, 4), component(NARANJA, 2, 4), component(UVA, 2, 4)]);
    const rpc = jest.fn().mockResolvedValue({ data: payload, error: null });
    const { from } = mount({ rpc });

    const result = await convertPackToUnits({ packProductId: PACK, packQuantity: 1 }, DEFAULT_STORE_ID);

    expect(rpc.mock.calls).toEqual([
      ["convert_pack_to_units", { p_pack_product_id: PACK, p_pack_quantity: 1, p_reason: null }],
    ]);
    expect(from).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      conversionId: CONVERSION,
      packQuantity: 1,
      totalUnits: 6,
      unitCostRef: 2,
      unitQuantity: 6,
      unitsPerPack: 6,
    });
    expect(result.packMovement).toMatchObject({ productId: PACK, quantityDelta: -1, type: "conversion_salida" });
    expect(result.unitMovement).toMatchObject({ productId: COLA, type: "conversion_entrada" });
    expect(result.components).toEqual(
      [COLA, NARANJA, UVA].map((unitProductId) => ({
        allocatedValueRef: 4,
        costWeight: 1,
        isActive: true,
        movement: expect.objectContaining({
          conversionId: CONVERSION,
          productId: unitProductId,
          quantityDelta: 2,
          type: "conversion_entrada",
        }),
        newCostRef: 2,
        unitCostRef: 2,
        unitProductId,
        units: 2,
      })),
    );
  });

  it("reparto real 3-1-2: viaja como p_components tal cual llega, con la clave de idempotencia", async () => {
    const payload = assortedPayload([component(COLA, 3, 6), component(NARANJA, 1, 2), component(UVA, 2, 4)]);
    const rpc = jest.fn().mockResolvedValue({ data: payload, error: null });
    const { recipeQuery } = mount({ rpc });

    const result = await convertPackToUnits(
      {
        clientRequestId: CLIENT_REQUEST_ID,
        components: [
          { unitProductId: UVA, units: 2 },
          { unitProductId: COLA, units: 3 },
          { unitProductId: NARANJA, units: 1 },
        ],
        packProductId: PACK,
        packQuantity: 1,
        reason: "Caja abierta",
      },
      DEFAULT_STORE_ID,
    );

    expect(rpc.mock.calls).toEqual([
      [
        "convert_pack_to_units",
        {
          p_client_request_id: CLIENT_REQUEST_ID,
          p_components: [
            { unit_product_id: UVA, units: 2 },
            { unit_product_id: COLA, units: 3 },
            { unit_product_id: NARANJA, units: 1 },
          ],
          p_pack_product_id: PACK,
          p_pack_quantity: 1,
          p_reason: "Caja abierta",
        },
      ],
    ]);
    // La lectura previa es la de la receta activa de ESE empaque en la tienda.
    expect(recipeQuery.eq.mock.calls).toEqual([
      ["store_id", DEFAULT_STORE_ID],
      ["pack_product_id", PACK],
      ["is_active", true],
    ]);
    expect(result.components.map((item) => [item.unitProductId, item.units])).toEqual([
      [COLA, 3],
      [NARANJA, 1],
      [UVA, 2],
    ]);
  });

  it.each([
    ["suma incorrecta", [{ unitProductId: COLA, units: 3 }, { unitProductId: UVA, units: 2 }], "debe sumar 6 unidades"],
    ["un producto que no es de la receta", [{ unitProductId: PACK, units: 6 }], "no es componente de la receta"],
    [
      "un componente repetido",
      [{ unitProductId: COLA, units: 3 }, { unitProductId: COLA, units: 3 }],
      "repite un componente",
    ],
  ])("%s: 400 antes de llamar a la RPC", async (_caso, components, message) => {
    const rpc = jest.fn();
    mount({ rpc });

    await expect(
      convertPackToUnits({ components, packProductId: PACK, packQuantity: 1 }, DEFAULT_STORE_ID),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining(message), status: 400 });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("la suma esperada es unidades de la receta x empaques", async () => {
    const rpc = jest.fn().mockResolvedValue({ data: assortedPayload([component(COLA, 12, 24)]), error: null });
    mount({ rpc });

    await expect(
      convertPackToUnits(
        { components: [{ unitProductId: COLA, units: 6 }], packProductId: PACK, packQuantity: 2 },
        DEFAULT_STORE_ID,
      ),
    ).rejects.toMatchObject({ message: expect.stringContaining("debe sumar 12 unidades"), status: 400 });

    await convertPackToUnits(
      { components: [{ unitProductId: COLA, units: 12 }], packProductId: PACK, packQuantity: 2 },
      DEFAULT_STORE_ID,
    );
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("pesos de costo distintos: la respuesta conserva el reparto de la RPC (suma asignada = valor transferido)", async () => {
    const payload = assortedPayload([
      component(COLA, 6, "5.0050", { costWeight: "1", newCostRef: 0.83, unitCostRef: 0.83 }),
      component(NARANJA, 6, "10.0100", { costWeight: "2", newCostRef: 1.67, unitCostRef: 1.67 }),
      component(UVA, 6, "15.0150", { costWeight: "3", newCostRef: 2.5, unitCostRef: 2.5 }),
    ]);
    mount({ rpc: jest.fn().mockResolvedValue({ data: payload, error: null }) });

    const result = await convertPackToUnits({ packProductId: PACK, packQuantity: 3 }, DEFAULT_STORE_ID);

    expect(result.components.map((item) => item.allocatedValueRef)).toEqual([5.005, 10.01, 15.015]);
    expect(result.components.map((item) => item.costWeight)).toEqual([1, 2, 3]);
    expect(
      result.components.reduce((total, item) => total + Math.round(item.allocatedValueRef * 10000), 0),
    ).toBe(300300);
  });

  it("sin receta activa (o si no se puede leer) decide la RPC", async () => {
    const notFound = { code: "PT404", message: "El producto no tiene conversion de empaque a unidad activa" };
    const input = { components: [{ unitProductId: COLA, units: 6 }], packProductId: PACK, packQuantity: 1 };

    for (const options of [{ recipe: null }, { recipe: null, recipeError: { code: "PGRST205", message: "x" } }]) {
      const rpc = jest.fn().mockResolvedValue({ data: null, error: notFound });
      mount({ ...options, rpc });

      await expect(convertPackToUnits(input, DEFAULT_STORE_ID)).rejects.toMatchObject({
        message: notFound.message,
        status: 404,
      });
      expect(rpc).toHaveBeenCalledTimes(1);
    }
  });

  it.each([
    ["PT400", 400, "BAD_REQUEST", "La distribucion debe sumar 6 unidades (1 empaques x 6) y suma 5"],
    ["PT403", 403, "FORBIDDEN", "No autorizado para convertir empaque a unidad"],
    ["PT404", 404, "NOT_FOUND", "El producto no tiene conversion de empaque a unidad activa"],
    ["PT409", 409, "CONFLICT", "Stock insuficiente de empaque"],
  ])("un rechazo %s de la RPC sale como %i con su mensaje", async (sqlState, status, code, message) => {
    mount({ rpc: jest.fn().mockResolvedValue({ data: null, error: { code: sqlState, message } }) });

    await expect(
      convertPackToUnits({ packProductId: PACK, packQuantity: 1 }, DEFAULT_STORE_ID),
    ).rejects.toMatchObject({ code, message, status });
  });

  it("si la base no conoce p_components (PGRST202) responde 409 y NO repite la apertura sin el reparto", async () => {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: { code: "PGRST202", message: "x" } });
    mount({ rpc });

    await expect(
      convertPackToUnits(
        {
          clientRequestId: CLIENT_REQUEST_ID,
          components: [{ unitProductId: COLA, units: 6 }],
          packProductId: PACK,
          packQuantity: 1,
        },
        DEFAULT_STORE_ID,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("una base sin el parche (respuesta sin components ni totalUnits) sigue respondiendo la forma de siempre", async () => {
    const legacy = {
      conversionId: CONVERSION,
      packMovement: movement(PACK, -1, "conversion_salida"),
      packQuantity: 1,
      unitCostRef: 1.25,
      unitMovement: movement(COLA, 10, "conversion_entrada"),
      unitQuantity: 10,
      unitsPerPack: 10,
    };
    mount({ rpc: jest.fn().mockResolvedValue({ data: legacy, error: null }) });

    const result = await convertPackToUnits({ packProductId: PACK, packQuantity: 1 }, DEFAULT_STORE_ID);

    expect(result).toMatchObject({
      components: [],
      conversionId: CONVERSION,
      packQuantity: 1,
      totalUnits: 10,
      unitCostRef: 1.25,
      unitQuantity: 10,
      unitsPerPack: 10,
    });
    expect(result.unitMovement).toMatchObject({ productId: COLA, quantityDelta: 10 });
  });
});
