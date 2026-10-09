/**
 * @jest-environment node
 */
/**
 * COM-14 · lado BFF de «Desarmar al recibir»: `receivePurchase` llama a la RPC
 * atómica `receive_purchase_and_disassemble`, `createPurchase` envía la marca de
 * la línea solo cuando es `true` y el detalle expone lo que la confirmación de
 * recepción necesita (id de línea, marca, desarmada y receta del empaque).
 */

jest.mock("../../../lib/supabase/route-client");
jest.mock("../../../lib/supabase/admin-client");

import { ApiError } from "@/lib/api/apiError";
import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { createPurchase, getPurchaseById, receivePurchase } from "./purchases.server";

const PURCHASE_ID = "11111111-1111-1111-1111-111111111111";
const ITEM_ID = "55555555-5555-5555-5555-555555555555";
const PACK_ID = "44444444-4444-4444-4444-444444444444";
const UNIT_ID = "66666666-6666-6666-6666-666666666666";
const KEY = "6f1a2b3c-4d5e-4f60-8a71-92b3c4d5e6f7";

const purchaseRow = {
  created_at: "2026-05-17T16:00:00.000Z",
  discount_ref: 0,
  id: PURCHASE_ID,
  paid_ves: 0,
  purchase_number: "C-000001",
  ref_rate_ves: 510,
  status: "pedido" as const,
  subtotal_ref: 27,
  supplier_id: "22222222-2222-2222-2222-222222222222",
  tax_ref: 0,
  total_ref: 27,
  total_ves: 13770,
  updated_at: "2026-05-17T16:00:00.000Z",
  user_id: "33333333-3333-3333-3333-333333333333",
};

const itemRow = {
  cost_currency: "ref",
  disassemble_on_receive: true,
  disassembled_conversion_id: null as string | null,
  entry_mode: "unit",
  id: ITEM_ID,
  product_id: PACK_ID,
  purchase_id: PURCHASE_ID,
  quantity: 3,
  subtotal_ref: 27,
  subtotal_ves: 13770,
  tax_rate: 0,
  tax_rate_code: "exento",
  tax_ref: 0,
  tax_ves: 0,
  unit_cost_ref: 9,
  unit_cost_ves: 4590,
};

const recipeRow = {
  components: [
    {
      unit_product: { current_stock: 4, is_active: true, name: "Refresco 355 ml" },
      unit_product_id: UNIT_ID,
      units_per_pack: 6,
    },
  ],
  id: "77777777-7777-7777-7777-777777777777",
  pack_product_id: PACK_ID,
  total_units: 6,
};

type Tables = {
  detail: { data: unknown; error: unknown };
  recipes?: { data: unknown; error: unknown };
};

/** Cliente de ruta simulado: detalle de compra, pagos y recetas, más las RPC. */
function mockRouteClient(tables: Tables, rpc: jest.Mock = jest.fn()) {
  const recipes = {
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockResolvedValue(tables.recipes ?? { data: [], error: null }),
    select: jest.fn().mockReturnThis(),
  };
  const detail = {
    eq: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(tables.detail),
    select: jest.fn().mockReturnThis(),
  };
  const payments = {
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockResolvedValue({ data: [], error: null }),
    select: jest.fn().mockReturnThis(),
  };
  const from = jest.fn((table: string) =>
    table === "payments" ? payments : table === "product_pack_conversions" ? recipes : detail,
  );

  (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ from, rpc });

  return { detail, from, recipes, rpc };
}

function detailOf(status: "pedido" | "recibido", item = itemRow) {
  return { data: { ...purchaseRow, purchase_items: [item], status, supplier: null }, error: null };
}

beforeEach(() => {
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

describe("purchases.server · detalle de compra con desarme (COM-14)", () => {
  it("pedido: cada línea lleva su id, la marca y la receta activa de su producto con el stock de los componentes", async () => {
    const client = mockRouteClient({ detail: detailOf("pedido"), recipes: { data: [recipeRow], error: null } });

    const purchase = await getPurchaseById(PURCHASE_ID, DEFAULT_STORE_ID);

    expect(purchase.items[0]).toMatchObject({
      disassembled: false,
      disassembleOnReceive: true,
      id: ITEM_ID,
      packRecipe: {
        components: [
          { currentStock: 4, isActive: true, name: "Refresco 355 ml", unitProductId: UNIT_ID, unitsPerPack: 6 },
        ],
        conversionId: recipeRow.id,
        totalUnits: 6,
      },
    });
    expect(client.detail.select.mock.calls[0][0]).toEqual(
      expect.stringMatching(/purchase_items\(\s*id,\s*disassemble_on_receive,\s*disassembled_conversion_id,/),
    );
    // Recetas de la tienda de la sesión, activas y solo de los productos de la compra.
    expect(client.recipes.eq.mock.calls).toEqual([
      ["store_id", DEFAULT_STORE_ID],
      ["is_active", true],
    ]);
    expect(client.recipes.in).toHaveBeenCalledWith("pack_product_id", [PACK_ID]);
  });

  it("pedido de un producto sin receta: la línea no lleva packRecipe", async () => {
    mockRouteClient({ detail: detailOf("pedido", { ...itemRow, disassemble_on_receive: false }) });

    const purchase = await getPurchaseById(PURCHASE_ID, DEFAULT_STORE_ID);

    expect(purchase.items[0]).toMatchObject({ disassembled: false, disassembleOnReceive: false, id: ITEM_ID });
    expect(purchase.items[0]).not.toHaveProperty("packRecipe");
  });

  it("compra recibida y desarmada: marca «desarmada» y no consulta recetas", async () => {
    const client = mockRouteClient({
      detail: detailOf("recibido", { ...itemRow, disassembled_conversion_id: "88888888-8888-8888-8888-888888888888" }),
    });

    const purchase = await getPurchaseById(PURCHASE_ID, DEFAULT_STORE_ID);

    expect(purchase.items[0]).toMatchObject({ disassembled: true, disassembleOnReceive: true });
    expect(client.from).not.toHaveBeenCalledWith("product_pack_conversions");
  });
});

describe("purchases.server · recibir con desarme (COM-14)", () => {
  it("sin opciones llama a la RPC atómica solo con la compra: mandan las marcas del pedido", async () => {
    const rpc = jest.fn().mockResolvedValue({ data: { ...purchaseRow, status: "recibido" }, error: null });
    mockRouteClient({ detail: detailOf("recibido") }, rpc);

    const result = await receivePurchase(PURCHASE_ID, DEFAULT_STORE_ID);

    expect(rpc.mock.calls).toEqual([["receive_purchase_and_disassemble", { p_purchase_id: PURCHASE_ID }]]);
    expect(result.status).toBe("recibido");
  });

  it("envía la lista de líneas a desarmar, el reparto y la clave de idempotencia; la tienda no viaja", async () => {
    const rpc = jest.fn().mockResolvedValue({ data: { ...purchaseRow, status: "recibido" }, error: null });
    mockRouteClient({ detail: detailOf("recibido") }, rpc);

    await receivePurchase(PURCHASE_ID, DEFAULT_STORE_ID, {
      clientRequestId: KEY,
      disassemble: [
        { distribution: [{ unitProductId: UNIT_ID, units: 18 }], purchaseItemId: ITEM_ID },
        { purchaseItemId: "99999999-9999-9999-9999-999999999999" },
      ],
    });

    expect(rpc.mock.calls).toEqual([
      [
        "receive_purchase_and_disassemble",
        {
          p_client_request_id: KEY,
          p_disassemble: [
            { components: [{ unit_product_id: UNIT_ID, units: 18 }], purchase_item_id: ITEM_ID },
            { purchase_item_id: "99999999-9999-9999-9999-999999999999" },
          ],
          p_purchase_id: PURCHASE_ID,
        },
      ],
    ]);
  });

  it("la lista vacía viaja como []: no desarmar ninguna línea", async () => {
    const rpc = jest.fn().mockResolvedValue({ data: { ...purchaseRow, status: "recibido" }, error: null });
    mockRouteClient({ detail: detailOf("recibido") }, rpc);

    await receivePurchase(PURCHASE_ID, DEFAULT_STORE_ID, { disassemble: [] });

    expect(rpc.mock.calls[0][1]).toEqual({ p_disassemble: [], p_purchase_id: PURCHASE_ID });
  });

  it("un rechazo de la base (PT409) llega tal cual: 409 con su mensaje", async () => {
    const message =
      "Sin receta de apertura activa: Caja de refrescos. Desmarca «Desarmar al recibir» en esas líneas o activa su receta";
    const rpc = jest.fn().mockResolvedValue({ data: null, error: { code: "PT409", message } });
    mockRouteClient({ detail: detailOf("pedido") }, rpc);

    await expect(receivePurchase(PURCHASE_ID, DEFAULT_STORE_ID)).rejects.toMatchObject({ message, status: 409 });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  describe("base sin el parche 20261010d (PGRST202: la RPC no existe y no ejecutó nada)", () => {
    const missing = { data: null, error: { code: "PGRST202", message: "Could not find the function" } };

    it("sin líneas a desarmar se recibe con receive_purchase, como siempre", async () => {
      jest.spyOn(console, "warn").mockImplementation(() => undefined);
      const rpc = jest
        .fn()
        .mockResolvedValueOnce(missing)
        .mockResolvedValueOnce({ data: { ...purchaseRow, status: "recibido" }, error: null });
      mockRouteClient({ detail: detailOf("recibido") }, rpc);

      const result = await receivePurchase(PURCHASE_ID, DEFAULT_STORE_ID, { clientRequestId: KEY, disassemble: [] });

      expect(rpc.mock.calls[1]).toEqual(["receive_purchase", { p_purchase_id: PURCHASE_ID }]);
      expect(result.status).toBe("recibido");
    });

    it("con líneas a desarmar NO se recibe: 409 en español y ninguna otra llamada", async () => {
      const rpc = jest.fn().mockResolvedValue(missing);
      mockRouteClient({ detail: detailOf("pedido") }, rpc);

      const error = await receivePurchase(PURCHASE_ID, DEFAULT_STORE_ID, {
        disassemble: [{ purchaseItemId: ITEM_ID }],
      }).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({
        message: "Esta base aún no admite desarmar al recibir. No se recibió la compra.",
        status: 409,
      });
      expect(rpc).toHaveBeenCalledTimes(1);
    });
  });
});

describe("purchases.server · crear con la marca de la línea (COM-14)", () => {
  const line = {
    costCurrency: "ref" as const,
    entryMode: "unit" as const,
    productId: PACK_ID,
    quantity: 3,
    subtotalRef: 27,
    subtotalVes: 13770,
    taxRate: 0,
    taxRef: 0,
    taxVes: 0,
    unitCostRef: 9,
    unitCostVes: 4590,
  };
  const input = {
    discountRef: 0,
    discountVes: 0,
    refRateVes: 510,
    status: "recibido" as const,
    subtotalRef: 27,
    subtotalVes: 13770,
    supplierId: purchaseRow.supplier_id,
    taxRef: 0,
    taxVes: 0,
  };

  it("la línea marcada envía disassemble_on_receive: true; sin marca o con false la clave no viaja (misma huella de siempre)", async () => {
    const rpc = jest.fn().mockResolvedValue({ data: { ...purchaseRow, status: "recibido" }, error: null });
    mockRouteClient({ detail: detailOf("recibido") }, rpc);

    await createPurchase(
      {
        ...input,
        items: [{ ...line, disassembleOnReceive: true }, line, { ...line, disassembleOnReceive: false }],
      },
      DEFAULT_STORE_ID,
    );

    const [name, args] = rpc.mock.calls[0] as [string, { p_items: Array<Record<string, unknown>> }];

    expect(name).toBe("create_purchase");
    expect(args.p_items.map((item) => item.disassemble_on_receive)).toEqual([true, undefined, undefined]);
    expect(args.p_items.map((item) => "disassemble_on_receive" in item)).toEqual([true, false, false]);
  });
});
