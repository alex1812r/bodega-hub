/**
 * @jest-environment node
 */
/**
 * PRO-12 · POST /api/inventory/conversions con el reparto real de un surtido
 * (`components`): forma del cuerpo, respuesta y códigos 400 / 403 / 404 / 409.
 */

jest.mock("../../../../lib/supabase/route-client", () => ({
  createRouteSupabaseClient: jest.fn(),
}));
jest.mock("../../../../lib/supabase/admin-client", () => ({
  createAdminSupabaseClient: jest.fn(),
}));

import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { buildMockPackRecipe } from "@/modules/products/services/packConversionSummary";
import { mockProductPackConversions, mockProducts } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { POST } from "./route";

const CLIENT_REQUEST_ID = "9b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d";

function post(body: unknown, role = "almacen") {
  return POST(
    new Request("http://localhost/api/inventory/conversions", {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", "x-demo-role": role },
      method: "POST",
    }),
  );
}

function stockOf(productId: string) {
  return mockProducts.find((product) => product.id === productId)?.currentStock ?? Number.NaN;
}

const originalDataSource = process.env.API_DATA_SOURCE;

afterAll(() => {
  process.env.API_DATA_SOURCE = originalDataSource;
});

describe("/api/inventory/conversions · surtido (mock)", () => {
  beforeAll(() => {
    for (const [id, name, cost, stock] of [
      ["rt-pack", "Caja surtida", 12, 5],
      ["rt-a", "Refresco cola", 0, 0],
      ["rt-b", "Refresco naranja", 0, 0],
      ["rt-c", "Refresco uva", 0, 0],
    ] as const) {
      mockProducts.push({
        categoryId: "cat-tools",
        currentCostRef: cost,
        currentStock: stock,
        id,
        isActive: true,
        minStock: 0,
        name,
        salePriceRef: 3,
        sku: id,
        storeId: DEFAULT_STORE_ID,
      });
    }

    mockProductPackConversions.push(
      buildMockPackRecipe({
        components: ["rt-a", "rt-b", "rt-c"].map((unitProductId) => ({
          costWeight: 1,
          unitProductId,
          unitsPerPack: 2,
        })),
        id: "rt-recipe",
        isActive: true,
        packProductId: "rt-pack",
        storeId: DEFAULT_STORE_ID,
        totalUnits: 6,
      }),
    );
  });

  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
  });

  it("201 con el reparto real: la respuesta conserva la forma de siempre y suma components", async () => {
    const response = await post({
      components: [
        { unitProductId: "rt-a", units: 3 },
        { unitProductId: "rt-b", units: 1 },
        { unitProductId: "rt-c", units: 2 },
      ],
      packProductId: "rt-pack",
      packQuantity: 1,
    });
    const { data } = await response.json();

    expect(response.status).toBe(201);
    expect(data).toMatchObject({ packQuantity: 1, totalUnits: 6, unitCostRef: 2, unitQuantity: 6, unitsPerPack: 6 });
    expect(data.packMovement).toMatchObject({ conversionId: data.conversionId, type: "conversion_salida" });
    expect(data.unitMovement).toMatchObject({ conversionId: data.conversionId, productId: "rt-a", type: "conversion_entrada" });
    expect(data.components).toEqual([
      expect.objectContaining({ allocatedValueRef: 6, costWeight: 1, isActive: true, newCostRef: 2, unitCostRef: 2, unitProductId: "rt-a", units: 3 }),
      expect.objectContaining({ allocatedValueRef: 2, unitProductId: "rt-b", units: 1 }),
      expect.objectContaining({ allocatedValueRef: 4, unitProductId: "rt-c", units: 2 }),
    ]);
    expect(data.components[1].movement).toMatchObject({
      conversionId: data.conversionId,
      productId: "rt-b",
      quantityDelta: 1,
      type: "conversion_entrada",
    });
    expect([stockOf("rt-a"), stockOf("rt-b"), stockOf("rt-c"), stockOf("rt-pack")]).toEqual([3, 1, 2, 4]);
  });

  it("400 con mensaje claro si el reparto no suma, y no mueve stock", async () => {
    const packBefore = stockOf("rt-pack");
    const response = await post({
      components: [
        { unitProductId: "rt-a", units: 3 },
        { unitProductId: "rt-b", units: 1 },
      ],
      packProductId: "rt-pack",
      packQuantity: 1,
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatchObject({
      code: "BAD_REQUEST",
      message: "El reparto debe sumar 6 unidades (1 empaques × 6) y suma 4.",
    });
    expect(stockOf("rt-pack")).toBe(packBefore);
  });

  it.each([
    ["unidades negativas", [{ unitProductId: "rt-a", units: -1 }], "Las unidades del reparto deben ser enteros mayores o iguales a cero."],
    ["unidades con decimales", [{ unitProductId: "rt-a", units: 1.5 }], "Las unidades del reparto deben ser enteros mayores o iguales a cero."],
    [
      "un componente repetido",
      [{ unitProductId: "rt-a", units: 3 }, { unitProductId: "rt-a", units: 3 }],
      "El reparto repite un componente de la receta.",
    ],
    ["una lista vacía", [], "El reparto debe traer al menos un componente."],
  ])("400 por la forma del reparto: %s", async (_caso, components, message) => {
    const response = await post({ components, packProductId: "rt-pack", packQuantity: 1 });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.issues.map((issue: { message: string }) => issue.message)).toContain(message);
  });

  it("400 si un producto del reparto no es componente de la receta", async () => {
    const response = await post({
      components: [{ unitProductId: "prod-cable", units: 6 }],
      packProductId: "rt-pack",
      packQuantity: 1,
    });

    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toBe(
      "Un producto del reparto no es componente de la receta del empaque.",
    );
  });

  it("403 para un rol sin inventory.manage", async () => {
    const response = await post({ packProductId: "rt-pack", packQuantity: 1 }, "vendedor");

    expect(response.status).toBe(403);
  });

  it("409 si la misma clave llega con otro reparto; con el mismo, la conversión original", async () => {
    const body = {
      clientRequestId: CLIENT_REQUEST_ID,
      components: [{ unitProductId: "rt-c", units: 6 }],
      packProductId: "rt-pack",
      packQuantity: 1,
    };
    const packBefore = stockOf("rt-pack");

    const first = await post(body);
    const second = await post(body);
    const other = await post({ ...body, components: [{ unitProductId: "rt-a", units: 6 }] });

    expect([first.status, second.status, other.status]).toEqual([201, 201, 409]);
    expect((await second.json()).data.conversionId).toBe((await first.json()).data.conversionId);
    expect((await other.json()).error.code).toBe("CONFLICT");
    expect(stockOf("rt-pack")).toBe(packBefore - 1);
  });
});

describe("/api/inventory/conversions · rechazos de la RPC (supabase)", () => {
  const PACK = "22222222-2222-4222-8222-222222222222";
  const UNIT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

  function mountRpc(rpc: jest.Mock) {
    const recipeQuery: Record<string, jest.Mock> = {
      eq: jest.fn(),
      maybeSingle: jest.fn().mockResolvedValue({
        data: { components: [{ unit_product_id: UNIT }], total_units: 6 },
        error: null,
      }),
      select: jest.fn(),
    };

    recipeQuery.eq.mockReturnValue(recipeQuery);
    recipeQuery.select.mockReturnValue(recipeQuery);
    (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ from: jest.fn(() => recipeQuery), rpc });
  }

  beforeEach(() => {
    process.env.API_DATA_SOURCE = "supabase";
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

  it.each([
    ["PT400", 400, "BAD_REQUEST", "La distribucion repite un componente de la receta"],
    ["PT403", 403, "FORBIDDEN", "No autorizado para convertir empaque a unidad"],
    ["PT404", 404, "NOT_FOUND", "El producto no tiene conversion de empaque a unidad activa"],
    ["PT409", 409, "CONFLICT", "Stock insuficiente de empaque"],
  ])("%s → %i con el mensaje de la base", async (sqlState, status, code, message) => {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: { code: sqlState, message } });
    mountRpc(rpc);

    const response = await post({
      clientRequestId: CLIENT_REQUEST_ID,
      components: [{ unitProductId: UNIT, units: 6 }],
      packProductId: PACK,
      packQuantity: 1,
    });

    expect(response.status).toBe(status);
    expect((await response.json()).error).toMatchObject({ code, message });
    expect(rpc).toHaveBeenCalledWith("convert_pack_to_units", {
      p_client_request_id: CLIENT_REQUEST_ID,
      p_components: [{ unit_product_id: UNIT, units: 6 }],
      p_pack_product_id: PACK,
      p_pack_quantity: 1,
      p_reason: null,
    });
  });

  it("400 temprano si el reparto no suma: la RPC no se llama", async () => {
    const rpc = jest.fn();
    mountRpc(rpc);

    const response = await post({
      components: [{ unitProductId: UNIT, units: 5 }],
      packProductId: PACK,
      packQuantity: 1,
    });

    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
});
