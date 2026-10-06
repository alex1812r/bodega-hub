/**
 * @jest-environment node
 */
/**
 * STK-517 · R4 (lado BFF): una devolucion por ajuste puede ligarse a su venta o
 * compra (`p_sale_id` / `p_purchase_id`) para que `adjust_stock` aplique el tope
 * "vendido − ya devuelto" (C15). Si la base no conoce esos parametros (PGRST202)
 * NO se reintenta sin ellos: quitar el vinculo reabre el duplicado.
 */

jest.mock("../../../lib/supabase/route-client");
jest.mock("../../../lib/supabase/admin-client");

import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { createStockAdjustment } from "./inventory.server";

const CLIENT_REQUEST_ID = "6f1a2b3c-4d5e-4f60-8a71-92b3c4d5e6f7";
const PRODUCT_ID = "22222222-2222-4222-8222-222222222222";
const SALE_ID = "44444444-4444-4444-8444-444444444444";
const PURCHASE_ID = "55555555-5555-4555-8555-555555555555";

const movementRow = {
  created_at: "2026-05-18T10:00:00.000Z",
  id: "11111111-1111-4111-8111-111111111111",
  product_id: PRODUCT_ID,
  quantity_delta: 2,
  reason: null,
  sale_id: SALE_ID,
  stock_after: 20,
  type: "devolucion_cliente" as const,
};

const missingSignatureError = {
  code: "PGRST202",
  message:
    "Could not find the function public.adjust_stock(p_product_id, p_quantity_delta, p_reason, p_sale_id, p_type) in the schema cache",
};

const customerReturn = {
  productId: PRODUCT_ID,
  quantityDelta: 2,
  saleId: SALE_ID,
  type: "devolucion_cliente" as const,
};

const customerReturnArgs = {
  p_product_id: PRODUCT_ID,
  p_quantity_delta: 2,
  p_reason: null,
  p_type: "devolucion_cliente",
};

function mountRpc(rpc: jest.Mock) {
  (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ rpc });
}

describe("inventory.server · devolucion ligada a su documento (R4)", () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
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

  afterEach(() => {
    warn.mockRestore();
  });

  it("pasa saleId a adjust_stock como p_sale_id (con la clave de idempotencia)", async () => {
    const rpc = jest.fn().mockResolvedValue({ data: movementRow, error: null });
    mountRpc(rpc);

    const result = await createStockAdjustment(
      { ...customerReturn, clientRequestId: CLIENT_REQUEST_ID },
      DEFAULT_STORE_ID,
    );

    expect(result.saleId).toBe(SALE_ID);
    expect(rpc.mock.calls).toEqual([
      [
        "adjust_stock",
        { ...customerReturnArgs, p_client_request_id: CLIENT_REQUEST_ID, p_sale_id: SALE_ID },
      ],
    ]);
  });

  it("pasa purchaseId a adjust_stock como p_purchase_id (sin clave)", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: { ...movementRow, purchase_id: PURCHASE_ID, quantity_delta: -2, sale_id: null, type: "devolucion_proveedor" },
      error: null,
    });
    mountRpc(rpc);

    await createStockAdjustment(
      { productId: PRODUCT_ID, purchaseId: PURCHASE_ID, quantityDelta: -2, type: "devolucion_proveedor" },
      DEFAULT_STORE_ID,
    );

    expect(rpc.mock.calls).toEqual([
      [
        "adjust_stock",
        {
          p_product_id: PRODUCT_ID,
          p_purchase_id: PURCHASE_ID,
          p_quantity_delta: -2,
          p_reason: null,
          p_type: "devolucion_proveedor",
        },
      ],
    ]);
  });

  it("sin vinculo la llamada no lleva p_sale_id ni p_purchase_id", async () => {
    const rpc = jest.fn().mockResolvedValue({ data: movementRow, error: null });
    mountRpc(rpc);

    await createStockAdjustment(
      { productId: PRODUCT_ID, quantityDelta: 2, type: "devolucion_cliente" },
      DEFAULT_STORE_ID,
    );

    expect(rpc.mock.calls).toEqual([["adjust_stock", customerReturnArgs]]);
  });

  it.each([
    ["con clave", { ...customerReturn, clientRequestId: CLIENT_REQUEST_ID }],
    ["sin clave", customerReturn],
  ])(
    "si la base no conoce el vinculo (PGRST202, %s) responde 409 y NO reintenta sin el",
    async (_caso, input) => {
      const rpc = jest.fn().mockResolvedValue({ data: null, error: missingSignatureError });
      mountRpc(rpc);

      const error = await createStockAdjustment(input, DEFAULT_STORE_ID).catch(
        (caught: unknown) => caught,
      );

      expect(error).toMatchObject({ code: "CONFLICT", status: 409 });
      expect((error as Error).message).toMatch(/aun no admite devoluciones ligadas/i);
      expect((error as Error).message).not.toMatch(/schema cache|adjust_stock/i);
      expect(rpc).toHaveBeenCalledTimes(1);
    },
  );

  it("el tope de la RPC (PT409) llega como 409 con su mensaje", async () => {
    const message = "La devolucion supera lo vendido en la venta V-000001: vendido 5, ya devuelto 4";
    const rpc = jest.fn().mockResolvedValue({ data: null, error: { code: "PT409", message } });
    mountRpc(rpc);

    await expect(createStockAdjustment(customerReturn, DEFAULT_STORE_ID)).rejects.toMatchObject({
      code: "CONFLICT",
      message,
      status: 409,
    });
  });
});
